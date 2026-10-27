import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { signedIn } from '#/test-helpers/sign-in.js'

const userId = randomUUID()
const tenantId = randomUUID()
const clientId = randomUUID()
const json = (body) => new Response(JSON.stringify(body), { status: 200 })

describe('Issue assignee filter', () => {
  let server
  let fetch
  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
    config.set('auth.entra.tenantId', tenantId)
    config.set('auth.entra.clientId', clientId)
  })
  beforeEach(() => {
    config.set('auth.mode', 'entra')
    fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/users?')) {
        return json({
          items: [{ id: userId, fullName: '<Test Person>' }],
          totalCount: 1
        })
      }
      if (String(url).includes('/v1/issues?')) {
        return json({
          items: [
            {
              id: 'issue-1',
              ruleId: '2',
              assignedTo: '<Test Person>',
              workflowStatus: 'todo',
              status: 'active',
              context: { cph: '01/234/5678' }
            }
          ],
          totalCount: 21,
          pageNumber: 1,
          pageSize: 20
        })
      }
      return json([])
    })
  })
  afterEach(() => {
    config.set('auth.mode', 'password')
    vi.restoreAllMocks()
  })
  afterAll(async () => {
    await server.stop({ timeout: 0 })
    config.set('auth.entra.tenantId', '')
    config.set('auth.entra.clientId', '')
  })

  const searchQuery = () =>
    new URL(
      fetch.mock.calls.find(([url]) => String(url).includes('/v1/issues?'))[0]
    ).searchParams

  test('filters by stable ID, scopes user lookup and keeps selection in pagination', async () => {
    const response = await server.inject({
      url: `/issues?filtered=true&assignee=${userId}`,
      auth: signedIn
    })
    expect(response.statusCode).toBe(200)
    expect(searchQuery().get('assignedUserId')).toBe(userId)
    expect(searchQuery().has('unassigned')).toBe(false)
    const usersQuery = new URL(
      fetch.mock.calls.find(([url]) => String(url).includes('/v1/users?'))[0]
    ).searchParams
    expect(usersQuery.get('tenantId')).toBe(tenantId)
    expect(usersQuery.get('clientId')).toBe(clientId)
    expect(response.result).toMatch(
      new RegExp(`value="${userId}"[^>]*selected`)
    )
    expect(response.result).toContain(`assignee=${userId}&amp;page=2`)
    expect(response.result).toContain('Assigned to: &lt;Test Person&gt;')
    expect(response.result).not.toContain('<Test Person>')
  })

  test('supports unassigned in password mode without exposing a user directory', async () => {
    config.set('auth.mode', 'password')
    const response = await server.inject({
      url: '/issues?filtered=true&assignee=unassigned',
      auth: signedIn
    })
    expect(response.statusCode).toBe(200)
    expect(searchQuery().get('unassigned')).toBe('true')
    expect(searchQuery().has('assignedUserId')).toBe(false)
    expect(
      fetch.mock.calls.some(([url]) => String(url).includes('/v1/users?'))
    ).toBe(false)
    expect(response.result).not.toContain(`value="${userId}"`)
  })

  test('does not send assignment constraints for anyone', async () => {
    const response = await server.inject({ url: '/issues', auth: signedIn })
    expect(response.statusCode).toBe(200)
    expect(searchQuery().has('assignedUserId')).toBe(false)
    expect(searchQuery().has('unassigned')).toBe(false)
  })

  test('rejects unknown user choices explicitly instead of showing an unfiltered result', async () => {
    const response = await server.inject({
      url: `/issues?assignee=${randomUUID()}`,
      auth: signedIn
    })
    expect(response.statusCode).toBe(400)
    expect(response.result).toContain('Invalid assignee filter')
    expect(
      fetch.mock.calls.some(([url]) => String(url).includes('/v1/issues?'))
    ).toBe(false)
  })

  test('shows a service error when the user directory fails', async () => {
    fetch.mockResolvedValue(new Response('{}', { status: 503 }))
    const response = await server.inject({ url: '/issues', auth: signedIn })
    expect(response.statusCode).toBe(503)
    expect(response.result).not.toContain('No issues match')
  })
})
