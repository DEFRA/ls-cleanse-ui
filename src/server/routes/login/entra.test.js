import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { vi } from 'vitest'

import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { createBrowser } from '#/test-helpers/sign-in.js'
import { isSignedInTo } from '#/server/plugins/auth.js'
import { validateEntraConfig } from './entra.js'

const tenantId = randomUUID()
const clientId = randomUUID()
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
      clientSecret: randomUUID(),
      redirectUri: 'http://localhost:3000/auth/entra/callback',
      postLogoutRedirectUri: 'http://localhost:3000/login'
    })
    claimsOverride = {}
    backendFailure = false
    tokenRedeemed = false
    invalidSignature = false
    loginBody = null
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
    expect(authorize.searchParams.get('scope')).toBe('openid profile')
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorize.searchParams.has('client_secret')).toBe(false)
    const result = await finish()
    expect(result.statusCode).toBe(302)
    expect(result.headers.location).toBe('/test/identity')
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
    const elevated = await browser.submit('/admin/login', {
      password: adminPassword
    })
    expect(elevated.statusCode).toBe(302)
    expect((await browser.get('/test/identity')).result).toEqual({
      service: true,
      admin: true
    })
    expect((await finish()).statusCode).toBe(400)
  })

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
    await begin('//example.com')
    expect((await finish()).headers.location).toBe('/')
    await browser.submit('/admin/login', { password: adminPassword })
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
