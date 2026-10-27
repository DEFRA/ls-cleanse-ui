import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { signedInAsAdmin } from '#/test-helpers/sign-in.js'

describe('Users administration', () => {
  let server
  const tenantId = randomUUID()
  const clientId = randomUUID()

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
    config.set('auth.entra.tenantId', tenantId)
    config.set('auth.entra.clientId', clientId)
  })
  afterAll(async () => {
    await server.stop({ timeout: 0 })
    config.set('auth.entra.tenantId', '')
    config.set('auth.entra.clientId', '')
  })
  afterEach(() => {
    config.set('auth.mode', 'password')
    vi.restoreAllMocks()
  })

  test('lists login users safely with last logon and scoped pagination', async () => {
    config.set('auth.mode', 'entra')
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: randomUUID(),
              fullName: '<script>Person</script>',
              firstLoggedInAtUtc: '2026-10-25T10:00:00Z',
              lastLoggedInAtUtc: '2026-10-27T09:00:00Z'
            }
          ],
          totalCount: 101
        }),
        { status: 200 }
      )
    )
    const response = await server.inject({
      url: '/admin/users?page=2',
      auth: signedInAsAdmin
    })
    expect(response.statusCode).toBe(200)
    expect(response.result).toContain('&lt;script&gt;Person&lt;/script&gt;')
    expect(response.result).not.toContain('<script>Person</script>')
    expect(response.result).toContain('2026-10-27T09:00:00Z')
    expect(response.result).toContain('All times are UTC')
    const query = new URL(fetch.mock.calls[0][0]).searchParams
    expect(query.get('tenantId')).toBe(tenantId)
    expect(query.get('clientId')).toBe(clientId)
    expect(query.get('pageNumber')).toBe('2')
    expect(response.result).toContain('/admin/users?page=3')
  })

  test('does not request or expose users in password mode', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const response = await server.inject({
      url: '/admin/users',
      auth: signedInAsAdmin
    })
    expect(response.statusCode).toBe(404)
    expect(response.result).toContain('not available')
    expect(fetch).not.toHaveBeenCalled()
    const home = await server.inject({ url: '/admin', auth: signedInAsAdmin })
    expect(home.result).not.toContain('href="/admin/users"')
  })

  test('does not expose the directory before sign-in', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const response = await server.inject('/admin/users')
    expect(response.statusCode).toBe(302)
    expect(fetch).not.toHaveBeenCalled()
  })

  test('shows an explicit failure if the user directory is unavailable', async () => {
    config.set('auth.mode', 'entra')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 503 })
    )
    const response = await server.inject({
      url: '/admin/users',
      auth: signedInAsAdmin
    })
    expect(response.statusCode).toBe(503)
    expect(response.result).not.toContain('Nobody has signed in')
  })
})
