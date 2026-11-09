import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { signedInAsAdmin } from '#/test-helpers/sign-in.js'
import { parseEmails } from './users-controller.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status })

describe('Users administration', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })
  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })
  afterEach(() => {
    config.set('auth.mode', 'password')
    vi.restoreAllMocks()
  })

  async function addUsers(emails, respond) {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url, options) =>
        options?.method === 'POST'
          ? respond(options)
          : json({ items: [], totalCount: 0 })
      )
    const page = await server.inject({
      url: '/admin/users/add',
      auth: signedInAsAdmin
    })
    const cookie = page.headers['set-cookie']?.[0].split(';')[0]
    const crumb = /name="crumb" value="([^"]+)"/.exec(page.result)?.[1]
    const response = await server.inject({
      method: 'POST',
      url: '/admin/users/add',
      auth: signedInAsAdmin,
      headers: { cookie },
      payload: { crumb, emails }
    })
    const session = response.headers['set-cookie']?.[0].split(';')[0] ?? cookie
    return { fetch, response, session }
  }

  test.each(['entra', 'password'])(
    'lists everyone safely, with email, last logon or never, in %s mode',
    async (mode) => {
      config.set('auth.mode', mode)
      const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        json({
          items: [
            {
              id: randomUUID(),
              fullName: '<script>Person</script>',
              email: 'person@example.test',
              firstLoggedInAtUtc: '2026-10-25T10:00:00Z',
              lastLoggedInAtUtc: '2026-10-27T09:00:00Z'
            },
            {
              id: randomUUID(),
              fullName: 'Not Signed In',
              email: 'added@example.test',
              firstLoggedInAtUtc: null,
              lastLoggedInAtUtc: null
            }
          ],
          totalCount: 101
        })
      )
      const response = await server.inject({
        url: '/admin/users?page=2',
        auth: signedInAsAdmin
      })
      expect(response.statusCode).toBe(200)
      expect(response.result).toContain('&lt;script&gt;Person&lt;/script&gt;')
      expect(response.result).not.toContain('<script>Person</script>')
      expect(response.result).toContain('2026-10-27T09:00:00Z')
      expect(response.result).toContain('added@example.test')
      expect(response.result).toContain('Never')
      expect(response.result).toContain('not a list of who may sign in')
      expect(response.result).toContain('href="/admin/users/add"')
      const query = new URL(fetch.mock.calls[0][0]).searchParams
      expect(query.has('tenantId')).toBe(false)
      expect(query.get('pageNumber')).toBe('2')
      expect(response.result).toContain('/admin/users?page=3')
      const home = await server.inject({ url: '/admin', auth: signedInAsAdmin })
      expect(home.result).toContain('href="/admin/users"')
    }
  )

  test('does not expose the directory before sign-in', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    expect((await server.inject('/admin/users')).statusCode).toBe(302)
    expect((await server.inject('/admin/users/add')).statusCode).toBe(302)
    expect(fetch).not.toHaveBeenCalled()
  })

  test('shows an explicit failure if the user directory is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({}, 503))
    const response = await server.inject({
      url: '/admin/users',
      auth: signedInAsAdmin
    })
    expect(response.statusCode).toBe(503)
    expect(response.result).not.toContain('Nobody has been added')
  })

  test('adds pasted addresses and reports how many were new', async () => {
    const { fetch, response, session } = await addUsers(
      'kris.dyson@defra.gov.uk, Andrew.Agius@apha.gov.uk;\nowen.jones@apha.gov.uk kris.dyson@defra.gov.uk',
      () =>
        json({
          created: [{ id: randomUUID() }, { id: randomUUID() }],
          existing: [{ id: randomUUID() }]
        })
    )
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/admin/users')
    const post = fetch.mock.calls.find(
      ([, options]) => options?.method === 'POST'
    )
    expect(new URL(post[0]).pathname).toBe('/v1/users')
    expect(JSON.parse(post[1].body)).toEqual({
      emails: [
        'kris.dyson@defra.gov.uk',
        'Andrew.Agius@apha.gov.uk',
        'owen.jones@apha.gov.uk'
      ]
    })
    const list = await server.inject({
      url: '/admin/users',
      auth: signedInAsAdmin,
      headers: { cookie: session }
    })
    expect(list.result).toContain('2 users added. 1 address already known.')
  })

  test('keeps what was typed and shows the problem when an address is invalid', async () => {
    const { response } = await addUsers(
      'good@example.test, <not an email>',
      () =>
        json(
          {
            title: 'Invalid request',
            detail: 'These are not valid email addresses: <not.'
          },
          400
        )
    )
    expect(response.statusCode).toBe(400)
    expect(response.result).toContain('There is a problem')
    expect(response.result).toContain(
      'These are not valid email addresses: &lt;not.'
    )
    expect(response.result).toContain('good@example.test, &lt;not an email&gt;')
  })

  test('asks for at least one address without calling the backend', async () => {
    const { fetch, response } = await addUsers('  ,  ', () => json({}))
    expect(response.statusCode).toBe(400)
    expect(response.result).toContain('Enter at least one email address')
    expect(
      fetch.mock.calls.some(([, options]) => options?.method === 'POST')
    ).toBe(false)
  })

  test('requires CSRF protection to add users', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const response = await server.inject({
      method: 'POST',
      url: '/admin/users/add',
      auth: signedInAsAdmin,
      payload: { emails: 'a@example.test' }
    })
    expect(response.statusCode).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })

  test('splits pasted lists on commas, semicolons and white space', () => {
    expect(parseEmails(' a@x.test,b@x.test;\n c@x.test  a@x.test ')).toEqual([
      'a@x.test',
      'b@x.test',
      'c@x.test'
    ])
    expect(parseEmails(undefined)).toEqual([])
  })
})
