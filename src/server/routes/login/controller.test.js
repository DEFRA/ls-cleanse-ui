import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'

import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { createBrowser } from '#/test-helpers/sign-in.js'
import { safeNext } from './controller.js'

/**
 * Generated rather than written down: a literal password in a test reads as a leaked credential
 * to secret scanning, and push protection then refuses the push.
 */
const password = randomUUID()
const adminPassword = randomUUID()

describe('#login', () => {
  let server

  beforeAll(async () => {
    config.set('auth.password', password)
    config.set('auth.adminPassword', adminPassword)

    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
    config.set('auth.password', '')
    config.set('auth.adminPassword', '')
  })

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response('{}', { status: 200 }))
    )
  })

  afterEach(() => {
    config.set('auth.password', password)
    config.set('auth.adminPassword', adminPassword)
  })

  describe('The sign-in page', () => {
    test('Should ask for the password, with nowhere else to go', async () => {
      const { statusCode, result } = await createBrowser(server).get('/login')

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Sign in - Cleanse - GOV.UK')
      expect(result).toContain('type="password"')
      expect(result).toContain('autocomplete="current-password"')
      expect(result).toContain('name="crumb"')
      expect(result).not.toContain('href="/issues"')
    })

    test('Should sign in and go where it was going', async () => {
      const browser = createBrowser(server)

      const { statusCode, headers } = await browser.submit(
        '/login?next=%2Fissues%3Fstatus%3Dtodo',
        { password }
      )

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toBe('/issues?status=todo')
    })

    test('Should go to the home page when it was going nowhere in particular', async () => {
      const { headers } = await createBrowser(server).submit('/login', {
        password
      })

      expect(headers.location).toBe('/')
    })

    test('Should accept the password with white space pasted around it', async () => {
      const { statusCode } = await createBrowser(server).submit('/login', {
        password: `  ${password}\n`
      })

      expect(statusCode).toBe(statusCodes.found)
    })

    test('Should refuse a wrong password without repeating it', async () => {
      const browser = createBrowser(server)
      const wrong = randomUUID()

      const { statusCode, result } = await browser.submit('/login', {
        password: wrong
      })

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('Error: Sign in')
      expect(result).toContain('The password is not correct')
      expect(result).not.toContain(wrong)
      expect((await browser.get('/')).headers.location).toBe('/login')
    })

    test('Should not take the admin password for the service password', async () => {
      const { statusCode } = await createBrowser(server).submit('/login', {
        password: adminPassword
      })

      expect(statusCode).toBe(statusCodes.badRequest)
    })

    test('Should ask for the password when none is typed', async () => {
      const { statusCode, result } = await createBrowser(server).submit(
        '/login',
        { password: '   ' }
      )

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('Enter the password')
    })

    test('Should refuse a sign-in that carries no CSRF token', async () => {
      const { statusCode } = await server.inject({
        method: 'POST',
        url: '/login',
        payload: { password }
      })

      expect(statusCode).toBe(statusCodes.forbidden)
    })

    test.each(['//evil.example/sign-in', '/.//evil.example/sign-in'])(
      'Should not send the browser off this service, to %s',
      async (next) => {
        const { headers } = await createBrowser(server).submit(
          `/login?${new URLSearchParams({ next })}`,
          { password }
        )

        expect(headers.location).toBe('/')
      }
    )

    test('Should not send someone already signed in off this service either', async () => {
      const browser = createBrowser(server)
      await browser.submit('/login', { password })

      const { headers } = await browser.get(
        '/login?next=%2F..%2F%2Fevil.example'
      )

      expect(headers.location).toBe('/')
    })

    test('Should pass someone already signed in straight through', async () => {
      const browser = createBrowser(server)
      await browser.submit('/login', { password })

      const { statusCode, headers } = await browser.get('/login?next=%2Fissues')

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toBe('/issues')
    })

    test('Should say sign-in is unavailable, rather than offer a form, when no password is set', async () => {
      config.set('auth.password', '')
      const browser = createBrowser(server)

      const page = await browser.get('/login')
      const attempt = await browser.post('/login', { password: '' })

      expect(page.statusCode).toBe(statusCodes.serviceUnavailable)
      expect(page.result).toContain('no password has been set up')
      expect(page.result).not.toContain('<form')
      expect(attempt.statusCode).toBe(statusCodes.serviceUnavailable)
    })
  })

  describe('The admin sign-in page', () => {
    async function signedIn() {
      const browser = createBrowser(server)
      await browser.submit('/login', { password })
      return browser
    }

    test('Should only be offered to someone signed in to the service', async () => {
      const { headers } = await createBrowser(server).get('/admin/login')

      expect(headers.location).toBe('/login?next=%2Fadmin%2Flogin')
    })

    test('Should come back to it after signing in to the service', async () => {
      const { headers } = await createBrowser(server).submit(
        '/login?next=%2Fadmin%2Flogin',
        { password }
      )

      expect(headers.location).toBe('/admin/login')
    })

    test('Should ask for the admin password', async () => {
      const browser = await signedIn()

      const { statusCode, result } = await browser.get('/admin/login')

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Sign in to admin')
      expect(result).toContain('Admin password')
    })

    test('Should sign in to admin and go where it was going', async () => {
      const browser = await signedIn()

      const { headers } = await browser.submit(
        '/admin/login?next=%2Fadmin%2Fstatus',
        { password: adminPassword }
      )

      expect(headers.location).toBe('/admin/status')
    })

    test('Should not take the service password for the admin password', async () => {
      const browser = await signedIn()

      const { statusCode, result } = await browser.submit('/admin/login', {
        password
      })

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('The admin password is not correct')
      expect((await browser.get('/admin')).headers.location).toBe(
        '/admin/login?next=%2Fadmin'
      )
    })

    test('Should say the admin area is unavailable when no admin password is set', async () => {
      const browser = await signedIn()
      config.set('auth.adminPassword', '')

      const { statusCode, result } = await browser.get('/admin/login')

      expect(statusCode).toBe(statusCodes.serviceUnavailable)
      expect(result).toContain('no admin password has been set up')
      expect(result).not.toContain('<form')
    })
  })

  describe('Signing out', () => {
    test('Should sign out of everything and say so', async () => {
      const browser = createBrowser(server)
      await browser.submit('/login', { password })
      await browser.submit('/admin/login', { password: adminPassword })

      const signOut = await browser.get('/logout')
      const signInPage = await browser.get('/login')

      expect(signOut.statusCode).toBe(statusCodes.found)
      expect(signOut.headers.location).toBe('/login')
      expect(signInPage.result).toContain('You have signed out.')
      expect((await browser.get('/')).headers.location).toBe('/login')
      expect((await browser.get('/admin')).headers.location).toBe(
        '/login?next=%2Fadmin'
      )
    })
  })
})

describe('#safeNext', () => {
  test.each([
    '/',
    '/issues',
    '/issues?status=todo&page=2',
    '/admin/login?next=%2Fadmin%2Fstatus',
    '/issues/2-JBSWY3DPEHPK3PXP/suppress'
  ])('Should go on to %s', (next) => {
    expect(safeNext(next, '/fallback')).toBe(next)
  })

  test.each([
    undefined,
    '',
    ['/issues', '/admin'],
    'issues',
    'https://evil.example/',
    '//evil.example/',
    '/\\evil.example',
    '/\t/evil.example',
    // Dot segments, which resolving removes, leaving a path that starts '//'.
    '/.//evil.example',
    '/..//evil.example',
    '/%2e//evil.example',
    '/a/..//evil.example',
    '/.\\/evil.example',
    'javascript:alert(1)',
    '/login',
    '/login?next=%2Fissues',
    '/logout'
  ])('Should not go on to %j', (next) => {
    expect(safeNext(next, '/fallback')).toBe('/fallback')
  })
})
