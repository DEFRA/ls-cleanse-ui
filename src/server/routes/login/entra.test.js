import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { vi } from 'vitest'
import { GetWebIdentityTokenCommand } from '@aws-sdk/client-sts'

import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { createBrowser } from '#/test-helpers/sign-in.js'
import { isSignedInTo } from '#/server/plugins/auth.js'
import { validateEntraConfig } from './entra.js'

const { stsSend } = vi.hoisted(() => ({ stsSend: vi.fn() }))

// Plain functions, not arrows: both are invoked with `new` by the code under test.
vi.mock('@aws-sdk/client-sts', () => ({
  STSClient: class {
    send = stsSend
  },
  GetWebIdentityTokenCommand: vi.fn(function GetWebIdentityTokenCommand(input) {
    this.input = input
  })
}))

const tenantId = randomUUID()
const clientId = randomUUID()
const clientSecret = randomUUID()
const objectId = randomUUID()
const userId = randomUUID()
const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048
})
const key = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'test-key',
  use: 'sig',
  alg: 'RS256'
}
const adminPassword = randomUUID()
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

describe('Entra sign-in', () => {
  let server
  let browser
  let authorize
  let claimsOverride
  let backendFailure
  let tokenRedeemed
  let invalidSignature
  let loginBody
  let tokenRequest
  let failureReasons
  const old = {
    mode: config.get('auth.mode'),
    entra: config.get('auth.entra'),
    adminPassword: config.get('auth.adminPassword'),
    cookiePassword: config.get('session.cookie.password')
  }

  beforeEach(async () => {
    config.set('auth.mode', 'entra')
    config.set('auth.adminPassword', adminPassword)
    config.set('session.cookie.password', randomUUID())
    config.set('auth.entra', {
      tenantId,
      clientId,
      clientAuth: 'secret',
      federatedAudience: 'api://AzureADTokenExchange',
      clientSecret,
      redirectUri: 'http://localhost:3000/auth/entra/callback',
      postLogoutRedirectUri: 'http://localhost:3000/login'
    })
    claimsOverride = {}
    backendFailure = false
    tokenRedeemed = false
    invalidSignature = false
    loginBody = null
    tokenRequest = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
      const url = String(input)
      if (url.includes('.well-known/openid-configuration')) {
        return json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/keys`,
          end_session_endpoint: `${issuer}/logout`,
          response_types_supported: ['code'],
          subject_types_supported: ['pairwise'],
          id_token_signing_alg_values_supported: ['RS256']
        })
      }
      if (url.endsWith('/keys')) {
        return json({ keys: [key] })
      }
      if (url.endsWith('/token')) {
        tokenRequest = new URLSearchParams(options.body)
        if (tokenRedeemed) {
          return json({ error: 'invalid_grant' }, 400)
        }
        tokenRedeemed = true
        const now = Math.floor(Date.now() / 1000)
        const claims = {
          iss: issuer,
          aud: clientId,
          sub: 'pairwise-subject',
          tid: tenantId,
          oid: objectId,
          name: 'Test Person',
          roles: ['cleanse-user'],
          iat: now,
          exp: now + 3600,
          nonce: authorize.searchParams.get('nonce'),
          ...claimsOverride
        }
        const encoded = [
          Buffer.from(JSON.stringify({ alg: 'RS256', kid: key.kid })).toString(
            'base64url'
          ),
          Buffer.from(JSON.stringify(claims)).toString('base64url')
        ].join('.')
        const signature = sign('RSA-SHA256', Buffer.from(encoded), privateKey)
        if (invalidSignature) {
          signature[0] ^= 1
        }
        return json({
          token_type: 'Bearer',
          access_token: 'unused',
          id_token: `${encoded}.${signature.toString('base64url')}`
        })
      }
      if (url.endsWith('/v1/users/logins')) {
        loginBody = JSON.parse(options.body)
        return backendFailure
          ? json({ title: 'Unavailable' }, 503)
          : json({ id: userId })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    server = await createServer()
    server.route({
      method: 'GET',
      path: '/test/identity',
      handler: (request) => ({
        service: isSignedInTo(request, 'service'),
        admin: isSignedInTo(request, 'admin')
      })
    })
    failureReasons = []
    server.ext('onPreHandler', (request, h) => {
      const warn = request.logger.warn.bind(request.logger)
      request.logger.warn = (details, ...rest) => {
        failureReasons.push(details?.event?.reason)
        return warn(details, ...rest)
      }
      return h.continue
    })
    await server.initialize()
    browser = createBrowser(server)
  })

  afterEach(async () => {
    await server?.stop({ timeout: 0 })
    config.set('auth.mode', old.mode)
    config.set('auth.entra', old.entra)
    config.set('auth.adminPassword', old.adminPassword)
    config.set('session.cookie.password', old.cookiePassword)
    vi.restoreAllMocks()
  })

  async function begin(next = '/test/identity') {
    const response = await browser.get(
      `/auth/entra/login?${new URLSearchParams({ next })}`
    )
    expect(response.statusCode).toBe(302)
    authorize = new URL(response.headers.location)
    return authorize
  }

  async function finish(extra = {}) {
    const query = new URLSearchParams({
      code: 'one-use-code',
      state: authorize.searchParams.get('state'),
      ...extra
    })
    return browser.get(`/auth/entra/callback?${query}`)
  }

  test('uses code flow with PKCE and persists only a validated user', async () => {
    await begin()
    expect(authorize.searchParams.get('scope')).toBe('openid profile email')
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorize.searchParams.has('client_secret')).toBe(false)
    const result = await finish()
    expect(result.statusCode).toBe(302)
    expect(result.headers.location).toBe('/test/identity')
    expect(tokenRequest.get('client_secret')).toBe(clientSecret)
    expect(tokenRequest.has('client_assertion')).toBe(false)
    expect(loginBody).toEqual({
      issuer,
      subject: 'pairwise-subject',
      tenantId,
      objectId,
      clientId,
      fullName: 'Test Person'
    })
    expect((await browser.get('/test/identity')).result).toEqual({
      service: true,
      admin: false
    })
    expect((await finish()).statusCode).toBe(400)
  })

  test('passes the email claims that let a first sign-in claim an added user', async () => {
    claimsOverride = {
      email: ' Test.Person@example.test ',
      preferred_username: 'test.person@example.test'
    }
    await begin()
    expect((await finish()).statusCode).toBe(302)
    expect(loginBody).toMatchObject({
      email: 'Test.Person@example.test',
      preferredUsername: 'test.person@example.test'
    })
  })

  test('opens the admin area with the cleanse-admin role, never the admin password', async () => {
    await begin()
    await finish()
    const refused = await browser.submit('/admin/login', {
      password: adminPassword
    })
    expect(refused.statusCode).toBe(405)
    expect((await browser.get('/admin')).headers.location).toBe(
      '/admin/login?next=%2Fadmin'
    )
    const denied = await browser.get('/admin/login?next=%2Fadmin')
    expect(denied.statusCode).toBe(403)
    expect(denied.result).toContain('You cannot use the admin area')

    claimsOverride = { roles: ['cleanse-admin'] }
    tokenRedeemed = false
    await begin()
    await finish()
    expect((await browser.get('/test/identity')).result).toEqual({
      service: true,
      admin: true
    })
    expect(
      (await browser.get('/admin/login?next=%2Fadmin%2Fstatus')).headers
        .location
    ).toBe('/admin/status')
  })

  test.each([
    ['no roles claim', { roles: undefined }],
    ['no roles', { roles: [] }],
    ['only another role', { roles: ['some-other-app-role'] }]
  ])(
    'refuses a user with %s without recording them',
    async (_label, override) => {
      claimsOverride = override
      await begin()
      const result = await finish()
      expect(result.statusCode).toBe(403)
      expect(result.result).toContain('does not have access')
      expect(failureReasons).toEqual(['no-cleanse-role'])
      expect(loginBody).toBeNull()
      expect((await browser.get('/test/identity')).statusCode).toBe(302)
    }
  )

  test('authenticates to Entra with a CDP web identity token when federated', async () => {
    config.set('auth.entra.clientAuth', 'federated')
    config.set('auth.entra.clientSecret', '')
    stsSend.mockResolvedValue({ WebIdentityToken: 'aws.signed.jwt' })
    await begin()
    expect((await finish()).statusCode).toBe(302)
    const input = GetWebIdentityTokenCommand.mock.calls.at(-1)[0]
    expect(input.Audience).toEqual(['api://AzureADTokenExchange'])
    expect(input.SigningAlgorithm).toBe('RS256')
    expect(tokenRequest.get('client_id')).toBe(clientId)
    expect(tokenRequest.get('client_assertion_type')).toBe(
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
    )
    expect(tokenRequest.get('client_assertion')).toBe('aws.signed.jwt')
    expect(tokenRequest.has('client_secret')).toBe(false)
    expect((await browser.get('/test/identity')).result.service).toBe(true)
  })

  test('shows a failed sign-in when Entra refuses the federated token request', async () => {
    config.set('auth.entra.clientAuth', 'federated')
    stsSend.mockResolvedValue({ WebIdentityToken: 'aws.signed.jwt' })
    tokenRedeemed = true
    await begin()
    expect((await finish()).statusCode).toBe(400)
    expect(failureReasons).toEqual(['invalid_grant'])
    expect(loginBody).toBeNull()
  })

  test.each([
    ['AccessDenied', 'AccessDenied'],
    ['Refused for someone@example.com', 'unknown']
  ])(
    'logs the kind of a local failure, %s, only as an identifier',
    async (name, reason) => {
      config.set('auth.entra.clientAuth', 'federated')
      stsSend.mockRejectedValue(
        Object.assign(new Error('Not authorized'), { name })
      )
      await begin()
      expect((await finish()).statusCode).toBe(400)
      expect(failureReasons).toEqual([reason])
      expect(loginBody).toBeNull()
    }
  )

  test.each([
    ['wrong tenant', { tid: randomUUID() }],
    ['wrong audience', { aud: randomUUID() }],
    ['wrong issuer', { iss: 'https://other.invalid' }],
    ['wrong nonce', { nonce: 'wrong' }],
    ['expired token', { exp: 1 }],
    ['missing full name', { name: '' }]
  ])('rejects %s without recording a user', async (_label, override) => {
    claimsOverride = override
    await begin()
    expect((await finish()).statusCode).toBe(400)
    expect(loginBody).toBeNull()
    expect((await browser.get('/test/identity')).statusCode).toBe(302)
  })

  test('rejects a callback with wrong state or an Entra assignment denial', async () => {
    await begin()
    expect((await finish({ state: 'wrong' })).statusCode).toBe(400)
    await begin()
    expect((await finish({ error: 'access_denied' })).statusCode).toBe(400)
    expect(loginBody).toBeNull()
  })

  test('verifies the ID token signature against Entra signing keys', async () => {
    invalidSignature = true
    await begin()
    expect((await finish()).statusCode).toBe(400)
    expect(loginBody).toBeNull()
  })

  test('does not establish a session when persistence fails', async () => {
    backendFailure = true
    await begin()
    expect((await finish()).statusCode).toBe(503)
    expect((await browser.get('/test/identity')).statusCode).toBe(302)
  })

  test('rejects expired login transactions', async () => {
    await begin()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 601000)
    expect((await finish()).statusCode).toBe(400)
    clock.mockRestore()
    expect(loginBody).toBeNull()
  })

  test('rejects unsafe return paths and logs out both gates', async () => {
    claimsOverride = { roles: ['cleanse-user', 'cleanse-admin'] }
    await begin('//example.com')
    expect((await finish()).headers.location).toBe('/')
    expect((await browser.get('/test/identity')).result).toEqual({
      service: true,
      admin: true
    })
    const logout = await browser.get('/logout')
    expect(new URL(logout.headers.location).pathname).toContain('/logout')
    expect((await browser.get('/test/identity')).statusCode).toBe(302)
    const login = await browser.get('/login')
    expect(login.statusCode).toBe(200)
    expect(login.result).toContain('Sign in with Microsoft')
  })

  test('invalidates sessions when credentials or mode change and enforces absolute expiry', async () => {
    await begin()
    await finish()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 14400001)
    expect((await browser.get('/test/identity')).statusCode).toBe(302)
    clock.mockRestore()
    config.set('auth.mode', 'password')
    expect((await browser.get('/test/identity')).statusCode).toBe(302)
    config.set('auth.mode', 'entra')
    config.set('auth.entra.clientId', randomUUID())
    expect((await browser.get('/test/identity')).statusCode).toBe(302)
  })

  test('disables password sign-in in Entra mode', async () => {
    await begin()
    expect(
      (await browser.post('/login', { password: 'anything' })).statusCode
    ).toBe(405)
  })

  test('validates required configuration explicitly', () => {
    config.set('auth.entra.tenantId', '')
    expect(validateEntraConfig).toThrow('tenantId')
    config.set('auth.entra.tenantId', tenantId)
    config.set('auth.entra.clientSecret', '')
    expect(validateEntraConfig).toThrow('ENTRA_CLIENT_SECRET')
    config.set('auth.entra.clientAuth', 'federated')
    expect(validateEntraConfig).not.toThrow()
    config.set('auth.entra.federatedAudience', ' ')
    expect(validateEntraConfig).toThrow('ENTRA_FEDERATED_AUDIENCE')
  })

  test.each([
    'http://example.com/auth/entra/callback',
    'https://example.com/incorrect',
    'https://example.com/auth/entra/callback?next=elsewhere'
  ])('rejects unsafe callback configuration %s', (url) => {
    config.set('auth.entra.redirectUri', url)
    expect(validateEntraConfig).toThrow()
  })

  test('reports discovery failure rather than falling back to a password', async () => {
    globalThis.fetch.mockRejectedValueOnce(new Error('Discovery unavailable'))
    const response = await browser.get('/auth/entra/login')
    expect(response.statusCode).toBe(503)
    expect(response.result).not.toContain('name="password"')
  })
})
