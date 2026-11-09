import * as oidc from 'openid-client'

import { config } from '#/config/config.js'
import {
  entraFingerprint,
  isEntra,
  signInEntra
} from '#/server/plugins/auth.js'
import { safeNext } from './controller.js'
import { CleanseApiError } from '#/server/common/helpers/cleanse/client.js'
import { createWebIdentityTokenSource } from '#/server/common/helpers/web-identity-token.js'

/** The app roles defined on the app registration. The ID token lists the ones a user holds. */
const entraRoles = { user: 'cleanse-user', admin: 'cleanse-admin' }

const transactionKey = 'entraTransaction'
const transactionTtl = 10 * 60 * 1000
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const failureMessages = {
  400: 'Your sign-in could not be completed. Try again or ask the application owner to check your access.',
  403: 'Your account does not have access to this service. Ask the application owner to give you access.',
  503: 'The sign-in service is unavailable. Try again.'
}

/** The kind of failure, never its message: Entra's OAuth error code, or a local error's code or type. */
function failureReason(error) {
  const reason = String(
    (error instanceof oidc.ResponseBodyError
      ? error.error
      : (error?.code ?? error?.cause?.name ?? error?.name)) ?? 'unknown'
  )
  // Only an identifier is logged: free text could carry personal data.
  return /^[\w.-]{1,64}$/.test(reason) ? reason : 'unknown'
}

/** A claim the backend may use, or undefined when it is absent or could not be an address. */
const optionalClaim = (value) =>
  typeof value === 'string' && value.trim() && value.length <= 320
    ? value.trim()
    : undefined

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
  if (settings.clientAuth === 'federated') {
    if (!settings.federatedAudience.trim()) {
      throw new Error(
        'ENTRA_FEDERATED_AUDIENCE is required when ENTRA_CLIENT_AUTH is federated'
      )
    }
  } else if (!settings.clientSecret.trim()) {
    throw new Error(
      'ENTRA_CLIENT_SECRET is required when ENTRA_CLIENT_AUTH is secret'
    )
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

/**
 * Client authentication with a CDP STS token in place of a secret: the app registration's
 * federated credential trusts this service's IAM role, for this audience only.
 */
function federatedClientAuth(audience) {
  const token = createWebIdentityTokenSource({ audience })

  return async (_as, client, body) => {
    body.set('client_id', client.client_id)
    body.set(
      'client_assertion_type',
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
    )
    body.set('client_assertion', await token())
  }
}

export function createEntraHandlers() {
  let discovered
  let discoveredFor

  async function client() {
    const fingerprint = entraFingerprint()
    if (!discovered || discoveredFor !== fingerprint) {
      const {
        tenantId,
        clientId,
        clientAuth,
        clientSecret,
        federatedAudience
      } = config.get('auth.entra')
      const federated = clientAuth === 'federated'
      discoveredFor = fingerprint
      discovered = oidc.discovery(
        new URL(`https://login.microsoftonline.com/${tenantId}/v2.0`),
        clientId,
        federated ? undefined : clientSecret,
        federated ? federatedClientAuth(federatedAudience) : undefined,
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

  function failure(request, h, status, reason) {
    // OIDC errors may contain codes, tokens or profile data. Log only the outcome and its kind.
    request.logger.warn(
      {
        event: {
          category: 'authentication',
          action: 'entra-login',
          outcome: 'failure',
          ...(reason ? { reason } : {})
        }
      },
      'Entra sign-in did not complete'
    )
    return h
      .view('login/entra-error', {
        pageTitle: 'Could not sign in',
        message: failureMessages[status]
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
          scope: 'openid profile email',
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
        const roles = Array.isArray(claims.roles) ? claims.roles : []
        const admin = roles.includes(entraRoles.admin)
        if (!admin && !roles.includes(entraRoles.user)) {
          return failure(request, h, 403, 'no-cleanse-role')
        }
        const user = await request.cleanse.recordLogin({
          issuer: claims.iss,
          subject: claims.sub,
          tenantId: claims.tid,
          objectId: claims.oid,
          clientId: settings.clientId,
          fullName: claims.name,
          // Either may match an address an admin added before this person's first sign-in.
          email: optionalClaim(claims.email),
          preferredUsername: optionalClaim(claims.preferred_username)
        })
        if (typeof user.id !== 'string' || !guid.test(user.id)) {
          throw new Error('Invalid user record response')
        }
        signInEntra(request, user, { admin })
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
        return failure(
          request,
          h,
          error instanceof CleanseApiError ? 503 : 400,
          failureReason(error)
        )
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
