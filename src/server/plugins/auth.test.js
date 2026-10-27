import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'

import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { createBrowser } from '#/test-helpers/sign-in.js'

/**
 * Generated rather than written down: a literal password in a test reads as a leaked credential
 * to secret scanning, and push protection then refuses the push.
 */
const password = randomUUID()
const adminPassword = randomUUID()

const summary = {
  groupId: 'cts-sam',
  totalIssues: 0,
  activeIssues: 0,
  inactiveIssues: 0,
  breakdown: [],
  latestRun: null
}

describe('#auth', () => {
  let server

  beforeAll(async () => {
    config.set('auth.password', password)
    config.set('auth.adminPassword', adminPassword)

    server = await createServer()

    // What someone able to read and write the session cookie could put in it.
    server.route({
      method: 'GET',
      path: '/test/forge',
      options: { auth: false },
      handler(request, h) {
        const guess = Buffer.alloc(32).toString('base64url')
        request.yar.set('signedIn', {
          signedInAt: Date.now(),
          nonce: 'chosen-by-whoever-forged-it',
          service: guess,
          admin: guess
        })
        return h.response('forged')
      }
    })

    // What they could do with a cookie they had copied: keep its proofs, but claim the sign-in
    // was made just now.
    server.route({
      method: 'GET',
      path: '/test/backdate',
      options: { auth: false },
      handler(request, h) {
        request.yar.set('signedIn', {
          ...request.yar.get('signedIn'),
          signedInAt: Date.now()
        })
        return h.response('backdated')
      }
    })

    server.route({
      method: 'GET',
      path: '/test/signed-in',
      options: { auth: false },
      handler: (request) => request.yar.get('signedIn')
    })

    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
    config.set('auth.password', '')
    config.set('auth.adminPassword', '')
  })

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(summary), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    )
  })

  afterEach(() => {
    config.set('auth.password', password)
    config.set('auth.adminPassword', adminPassword)
    vi.restoreAllMocks()
  })

  async function signedInBrowser({ admin = false } = {}) {
    const browser = createBrowser(server)
    await browser.submit('/login', { password })

    if (admin) {
      await browser.submit('/admin/login', { password: adminPassword })
    }

    return browser
  }

  describe('Before signing in', () => {
    test.each([
      ['/', '/login'],
      ['/issues?status=todo', '/login?next=%2Fissues%3Fstatus%3Dtodo'],
      [
        '/issues/2-JBSWY3DPEHPK3PXP',
        '/login?next=%2Fissues%2F2-JBSWY3DPEHPK3PXP'
      ],
      ['/admin', '/login?next=%2Fadmin'],
      ['/admin/status', '/login?next=%2Fadmin%2Fstatus']
    ])('Should send %s to sign in, remembering it', async (url, location) => {
      const { statusCode, headers } = await createBrowser(server).get(url)

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toBe(location)
    })

    /** A form submission cannot be replayed as a GET, so there is nothing to go back to. */
    test('Should send a form submission to sign in without remembering it', async () => {
      const { statusCode, headers } = await server.inject({
        method: 'POST',
        url: '/issues/2-JBSWY3DPEHPK3PXP/start',
        payload: { expectedVersion: '4' }
      })

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toBe('/login')
    })

    test('Should never call the backend', async () => {
      await createBrowser(server).get('/admin/status')

      expect(globalThis.fetch).not.toHaveBeenCalled()
    })

    test('Should leave the health check open, for the platform', async () => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/health'
      })

      expect(statusCode).toBe(statusCodes.ok)
    })

    test('Should leave stylesheets, scripts and icons open, so the sign-in page is styled', async () => {
      const asset = await server.inject({
        method: 'GET',
        url: '/public/stylesheets/no-such-file.css'
      })
      const icon = await server.inject({ method: 'GET', url: '/favicon.ico' })

      expect(asset.statusCode).toBe(statusCodes.notFound)
      expect(icon.statusCode).toBe(statusCodes.noContent)
    })

    test('Should show an unknown address as not found, with nothing to navigate to', async () => {
      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: '/no-such-page'
      })

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).not.toContain('Sign out')
    })
  })

  describe('Signed in', () => {
    test('Should open every page outside the admin area', async () => {
      const browser = await signedInBrowser()

      const { statusCode, result } = await browser.get('/')

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('href="/logout"')
    })

    test('Should still ask for the admin password before the admin area', async () => {
      const browser = await signedInBrowser()

      const { statusCode, headers } = await browser.get('/admin/status')

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toBe('/admin/login?next=%2Fadmin%2Fstatus')
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })

    test('Should open the admin area once the admin password is given too', async () => {
      const browser = await signedInBrowser({ admin: true })

      const { statusCode, result } = await browser.get('/admin')

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Status')
    })

    test('Should carry the sign-in from one instance to another in the cookie alone', async () => {
      const browser = await signedInBrowser({ admin: true })
      const other = await createServer()
      await other.initialize()

      try {
        const cookie = [...browser.cookies]
          .map(([name, value]) => `${name}=${value}`)
          .join('; ')
        const { statusCode } = await other.inject({
          method: 'GET',
          url: '/admin',
          headers: { cookie }
        })

        expect(statusCode).toBe(statusCodes.ok)
      } finally {
        await other.stop({ timeout: 0 })
      }
    })
  })

  describe('A sign-in', () => {
    /** The session holds proof of the password rather than a flag, so the cookie is not enough. */
    test('Should not be forged by someone able to write the session cookie', async () => {
      const browser = createBrowser(server)
      await browser.get('/test/forge')

      expect(browser.cookies.has('session')).toBe(true)
      expect((await browser.get('/')).headers.location).toBe('/login')
      expect((await browser.get('/admin')).headers.location).toBe(
        '/login?next=%2Fadmin'
      )
    })

    test('Should end when the password changes, signing everyone out', async () => {
      const browser = await signedInBrowser({ admin: true })

      config.set('auth.password', randomUUID())

      expect((await browser.get('/')).headers.location).toBe('/login')
    })

    test('Should leave the admin area when only the admin password changes', async () => {
      const browser = await signedInBrowser({ admin: true })

      config.set('auth.adminPassword', randomUUID())

      expect((await browser.get('/')).statusCode).toBe(statusCodes.ok)
      expect((await browser.get('/admin')).headers.location).toBe(
        '/admin/login?next=%2Fadmin'
      )
    })

    test('Should end once the session cookie would have expired, however busy it has been', async () => {
      const browser = await signedInBrowser({ admin: true })
      const signedInAt = Date.now()
      const now = vi.spyOn(Date, 'now')

      now.mockReturnValue(signedInAt + config.get('session.cookie.ttl') - 1000)
      expect((await browser.get('/')).statusCode).toBe(statusCodes.ok)

      now.mockReturnValue(signedInAt + config.get('session.cookie.ttl') + 1000)
      expect((await browser.get('/')).headers.location).toBe('/login')
    })

    /** Each proof is bound to the moment of its own sign-in, so a copied one cannot be renewed. */
    test('Should not be stretched past its lifetime by rewriting when it was made', async () => {
      const browser = await signedInBrowser({ admin: true })
      vi.spyOn(Date, 'now').mockReturnValue(
        Date.now() + 10 * config.get('session.cookie.ttl')
      )

      const backdated = await browser.get('/test/backdate')

      expect(backdated.headers['set-cookie']).toBeDefined()
      expect((await browser.get('/')).headers.location).toBe('/login')
      expect((await browser.get('/admin')).headers.location).toBe(
        '/login?next=%2Fadmin'
      )
    })

    test('Should hold a different proof for every sign-in', async () => {
      const proofIn = async (browser) =>
        (await browser.get('/test/signed-in')).result.service

      const first = await proofIn(await signedInBrowser())
      const second = await proofIn(await signedInBrowser())

      expect(first).toEqual(expect.any(String))
      expect(first).not.toBe(second)
    })
  })

  describe('With no password set', () => {
    test('Should keep every page closed', async () => {
      config.set('auth.password', '')

      expect((await createBrowser(server).get('/')).headers.location).toBe(
        '/login'
      )
    })

    test('Should keep the admin area closed, even to someone signed in', async () => {
      const browser = await signedInBrowser()

      config.set('auth.adminPassword', '   ')

      expect((await browser.get('/admin')).headers.location).toBe(
        '/admin/login?next=%2Fadmin'
      )
    })
  })
})
