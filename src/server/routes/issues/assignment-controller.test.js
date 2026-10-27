import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { signedIn } from '#/test-helpers/sign-in.js'

const userId = randomUUID()
const issue = {
  id: '2-JBSWY3DPEHPK3PXP',
  status: 'active',
  workflowStatus: 'todo',
  version: 4,
  assignedTo: 'Legacy Person',
  context: {}
}
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status })
const path = `/issues/${issue.id}/assign`

describe('Issue assignment', () => {
  let server
  let fetch
  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })
  beforeEach(() => {
    config.set('auth.mode', 'entra')
    fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url, options) => {
        if (String(url).includes('/v1/users?')) {
          return json({
            items: [{ id: userId, fullName: 'Test Person' }],
            totalCount: 1
          })
        }
        return json(issue)
      })
  })
  afterEach(() => {
    config.set('auth.mode', 'password')
    vi.restoreAllMocks()
  })
  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  async function submit(payload) {
    const page = await server.inject({ url: path, auth: signedIn })
    const cookie = page.headers['set-cookie']?.[0].split(';')[0]
    const crumb = /name="crumb" value="([^"]+)"/.exec(page.result)?.[1]
    return server.inject({
      method: 'POST',
      url: path,
      auth: signedIn,
      headers: { cookie },
      payload: { crumb, expectedVersion: '4', ...payload }
    })
  }

  test('lists known users with stable IDs and preserves legacy assignment display', async () => {
    const page = await server.inject({ url: path, auth: signedIn })
    expect(page.statusCode).toBe(200)
    expect(page.result).toContain('Legacy Person')
    expect(page.result).toContain(userId)
    expect(page.result).not.toContain('More users')
  })

  test('preselects the current known user', async () => {
    fetch.mockImplementation(async (url) =>
      String(url).includes('/v1/users?')
        ? json({
            items: [{ id: userId, fullName: 'Test Person' }],
            totalCount: 1
          })
        : json({ ...issue, assignedUserId: userId })
    )
    const page = await server.inject({ url: path, auth: signedIn })
    expect(page.result).toMatch(new RegExp(`value="${userId}"[^>]*selected`))
  })

  test('requires an explicit choice when the current assignee is outside this directory', async () => {
    fetch.mockImplementation(async (url) =>
      String(url).includes('/v1/users?')
        ? json({
            items: [{ id: userId, fullName: 'Test Person' }],
            totalCount: 1
          })
        : json({ ...issue, assignedUserId: randomUUID() })
    )
    const page = await server.inject({ url: path, auth: signedIn })
    expect(page.result).toMatch(/value="choose"[^>]*selected/)
  })

  test.each([userId, ''])(
    'sends stable ID or null with expected version',
    async (selected) => {
      const response = await submit({ userId: selected })
      expect(response.statusCode).toBe(302)
      const mutation = fetch.mock.calls.find(
        ([, options]) => options?.method === 'PUT'
      )
      expect(JSON.parse(mutation[1].body)).toMatchObject({
        userId: selected || null,
        expectedVersion: 4
      })
    }
  )

  test('rejects invalid selection without mutating', async () => {
    expect((await submit({ userId: 'made-up-person' })).statusCode).toBe(400)
    expect(
      fetch.mock.calls.some(([, options]) => options?.method === 'PUT')
    ).toBe(false)
  })

  test('requires CSRF protection', async () => {
    const response = await server.inject({
      url: path,
      method: 'POST',
      auth: signedIn,
      payload: { userId, expectedVersion: '4' }
    })
    expect(response.statusCode).toBe(403)
  })

  test('handles concurrent changes explicitly', async () => {
    fetch.mockImplementation(async (url, options) => {
      if (String(url).includes('/v1/users?')) {
        return json({ items: [], totalCount: 0 })
      }
      return options?.method === 'PUT'
        ? json({ title: 'Conflict' }, 409)
        : json(issue)
    })
    expect((await submit({ userId })).statusCode).toBe(409)
  })

  test('disables assignment without calling the backend in password mode', async () => {
    config.set('auth.mode', 'password')
    expect(
      (await server.inject({ url: path, auth: signedIn })).statusCode
    ).toBe(404)
    expect(fetch).not.toHaveBeenCalled()
  })
})
