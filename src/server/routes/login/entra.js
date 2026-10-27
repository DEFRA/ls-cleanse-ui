import * as oidc from 'openid-client'

import { config } from '#/config/config.js'
import {
  entraFingerprint,
  isEntra,
  signInEntra
} from '#/server/plugins/auth.js'
import { safeNext } from './controller.js'
import { CleanseApiError } from '#/server/common/helpers/cleanse/client.js'

const transactionKey = 'entraTransaction'
const transactionTtl = 10 * 60 * 1000
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validateEntraConfig() {
  if (!isEntra()) {
    return
  }
  const settings = config.get('auth.entra')
  if (
    config.get('session.cookie.password') ===
      'the-password-must-be-at-least-32-characters-long' ||
    config.get('session.cookie.password').length < 32
  ) {
    throw new Error(
      'Set a private SESSION_COOKIE_PASSWORD of at least 32 characters for Entra sessions'
    )
  }
  for (const name of ['tenantId', 'clientId']) {
    if (!guid.test(settings[name])) {
      throw new Error(`auth.entra.${name} must be a tenant-specific GUID`)
    }
    config.set(`auth.entra.${name}`, settings[name].toLowerCase())
  }
  if (!settings.clientSecret.trim()) {
    throw new Error('ENTRA_CLIENT_SECRET is required in Entra mode')
  }
  for (const name of ['redirectUri', 'postLogoutRedirectUri']) {
    const url = new URL(settings[name])
    if (
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && url.hostname === 'localhost'))
    ) {
      throw new Error(
        `auth.entra.${name} must be HTTPS (or local HTTP) without query or fragment`
      )
    }
  }
  if (new URL(settings.redirectUri).pathname !== '/auth/entra/callback') {
    throw new Error('ENTRA_REDIRECT_URI must end with /auth/entra/callback')
  }
  if (
    new URL(settings.redirectUri).origin !==
    new URL(settings.postLogoutRedirectUri).origin
  ) {
    throw new Error(
      'Entra callback and logout destinations must share an origin'
    )
  }
}

export function createEntraHandlers() {
  let discovered
  let discoveredFor

  async function client() {
    const fingerprint = entraFingerprint()
    if (!discovered || discoveredFor !== fingerprint) {
      const { tenantId, clientId, clientSecret } = config.get('auth.entra')
      discoveredFor = fingerprint
      discovered = oidc.discovery(
        new URL(`https://login.microsoftonline.com/${tenantId}/v2.0`),
        clientId,
        clientSecret,
        undefined,
        { execute: [oidc.enableNonRepudiationChecks], timeout: 10 }
      )
    }
    try {
      return await discovered
    } catch (error) {
      discovered = undefined
      throw error
    }
  }

  function failure(request, h, status) {
    // OIDC errors may contain codes, tokens or profile data. Log only the outcome.
    request.logger.warn(
      {
        event: {
          category: 'authentication',
          action: 'entra-login',
          outcome: 'failure'
        }
      },
      'Entra sign-in did not complete'
    )
    return h
      .view('login/entra-error', {
        pageTitle: 'Could not sign in',
        message:
          status === 503
            ? 'The sign-in service is unavailable. Try again.'
            : 'Your sign-in could not be completed. Try again or ask the application owner to check your access.'
      })
      .code(status)
  }

  return {
    async login(request, h) {
      try {
        const clientConfig = await client()
        const verifier = oidc.randomPKCECodeVerifier()
        const transaction = {
          verifier,
          state: oidc.randomState(),
          nonce: oidc.randomNonce(),
          createdAt: Date.now(),
          fingerprint: entraFingerprint(),
          next: safeNext(request.query.next, '/').slice(0, 1000)
        }
        request.yar.reset()
        request.yar.set(transactionKey, transaction)
        const url = oidc.buildAuthorizationUrl(clientConfig, {
          redirect_uri: config.get('auth.entra.redirectUri'),
          scope: 'openid profile',
          response_mode: 'query',
          code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
          code_challenge_method: 'S256',
          state: transaction.state,
          nonce: transaction.nonce
        })
        return h.redirect(url.href)
      } catch {
        return failure(request, h, 503)
      }
    },

    async callback(request, h) {
      const transaction = request.yar.get(transactionKey)
      request.yar.clear(transactionKey)
      const age = Date.now() - transaction?.createdAt
      if (
        !transaction ||
        !Number.isFinite(age) ||
        age < 0 ||
        age >= transactionTtl ||
        transaction.fingerprint !== entraFingerprint() ||
        request.query.state !== transaction.state ||
        typeof request.query.code !== 'string' ||
        request.query.error
      ) {
        return failure(request, h, 400)
      }
      try {
        const settings = config.get('auth.entra')
        const url = new URL(settings.redirectUri)
        url.search = request.url.search
        const tokens = await oidc.authorizationCodeGrant(await client(), url, {
          pkceCodeVerifier: transaction.verifier,
          expectedState: transaction.state,
          expectedNonce: transaction.nonce,
          idTokenExpected: true
        })
        const claims = tokens.claims()
        if (
          claims?.tid !== settings.tenantId ||
          !guid.test(claims.oid ?? '') ||
          typeof claims.sub !== 'string' ||
          !claims.sub.trim() ||
          claims.sub.length > 255 ||
          typeof claims.name !== 'string' ||
          !claims.name.trim() ||
          claims.name.length > 300
        ) {
          return failure(request, h, 400)
        }
        const user = await request.cleanse.recordLogin({
          issuer: claims.iss,
          subject: claims.sub,
          tenantId: claims.tid,
          objectId: claims.oid,
          clientId: settings.clientId,
          fullName: claims.name
        })
        if (typeof user.id !== 'string' || !guid.test(user.id)) {
          throw new Error('Invalid user record response')
        }
        signInEntra(request, user)
        request.logger.info(
          {
            event: {
              category: 'authentication',
              action: 'entra-login',
              outcome: 'success'
            }
          },
          'Signed in with Entra'
        )
        return h.redirect(safeNext(transaction.next, '/'))
      } catch (error) {
        return failure(request, h, error instanceof CleanseApiError ? 503 : 400)
      }
    },

    async logout(request, h) {
      try {
        const url = oidc.buildEndSessionUrl(await client(), {
          post_logout_redirect_uri: config.get(
            'auth.entra.postLogoutRedirectUri'
          ),
          client_id: config.get('auth.entra.clientId')
        })
        return h.redirect(url.href)
      } catch {
        return failure(request, h, 503)
      }
    }
  }
}
