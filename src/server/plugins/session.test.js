import { randomUUID } from 'node:crypto'

import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { isSignedInTo, signIn, signInEntra } from '#/server/plugins/auth.js'
import { maxRememberedQueryLength } from '#/server/routes/issues/list-controller.js'

/**
 * Two instances, as on CDP. Neither holds any session state of its own, so whichever instance
 * the load balancer picks can serve the next request: the cookie carries everything, sign-in
 * included.
 */
describe('#session', () => {
  let first
  let second

  async function instance() {
    const server = await createServer()

    server.route([
      {
        method: 'GET',
        path: '/test/session/write',
        options: { auth: false },
        handler(request, h) {
          if (request.query.signIn === 'entra') {
            signInEntra(request, { id: randomUUID() })
            signIn(request, 'admin')
          } else if (request.query.signIn) {
            signIn(request, 'service')
            signIn(request, 'admin')
          }

          request.yar.flash('notification', request.query.message)
          request.yar.set('lastIssuesQuery', request.query.query ?? '/issues')
          return h.response('written')
        }
      },
      {
        method: 'GET',
        path: '/test/session/read',
        options: { auth: false },
        handler(request) {
          return {
            notification: request.yar.flash('notification')[0] ?? null,
            lastIssuesQuery: request.yar.get('lastIssuesQuery') ?? null,
            signedIn: isSignedInTo(request, 'admin')
          }
        }
      }
    ])

    await server.initialize()
    return server
  }

  beforeAll(async () => {
    // Generated: a literal password reads as a leaked credential to secret scanning.
    config.set('auth.password', randomUUID())
    config.set('auth.adminPassword', randomUUID())

    first = await instance()
    second = await instance()
  })

  afterAll(async () => {
    await first.stop({ timeout: 0 })
    await second.stop({ timeout: 0 })

    config.set('auth.password', '')
    config.set('auth.adminPassword', '')
  })

  const sessionCookie = (response) =>
    response.headers['set-cookie']
      ?.find((cookie) => cookie.startsWith('session='))
      ?.split(';')[0]

  async function writeThenRead(query) {
    const written = await first.inject({
      method: 'GET',
      url: `/test/session/write?${new URLSearchParams(query)}`
    })

    return second.inject({
      method: 'GET',
      url: '/test/session/read',
      headers: { cookie: sessionCookie(written) }
    })
  }

  test('Should carry a session from one instance to another in the cookie alone', async () => {
    const { result } = await writeThenRead({ message: 'Issue updated.' })

    expect(result).toEqual({
      notification: 'Issue updated.',
      lastIssuesQuery: '/issues',
      signedIn: false
    })
  })

  /**
   * Above its size limit yar would fall back to a store held by one instance only, so the most
   * the service ever stores has to fit: both sign-ins, the longest remembered query and a long
   * file name.
   */
  test('Should keep the largest session the service stores inside the cookie', async () => {
    const lastIssuesQuery = `/issues?searchTerm=${'x'.repeat(maxRememberedQueryLength - 19)}`
    const notification = `${'a'.repeat(255)}.csv uploaded. Processing has started.`

    expect(lastIssuesQuery).toHaveLength(maxRememberedQueryLength)

    const { result } = await writeThenRead({
      signIn: 'yes',
      message: notification,
      query: lastIssuesQuery
    })

    expect(result).toEqual({ notification, lastIssuesQuery, signedIn: true })
  })

  test('Should not set a cookie for a visitor with nothing in their session', async () => {
    const response = await first.inject({ method: 'GET', url: '/health' })

    expect(sessionCookie(response)).toBeUndefined()
  })

  test('Should carry the largest Entra session across instances without server storage', async () => {
    config.set('auth.mode', 'entra')
    try {
      const { result } = await writeThenRead({
        signIn: 'entra',
        message: 'x'.repeat(300),
        query: `/issues?searchTerm=${'x'.repeat(980)}`
      })
      expect(result.signedIn).toBe(true)
      expect(result.notification).toHaveLength(300)
      expect(result.lastIssuesQuery).toHaveLength(999)
    } finally {
      config.set('auth.mode', 'password')
    }
  })
})
