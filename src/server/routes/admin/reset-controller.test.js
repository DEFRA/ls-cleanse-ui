import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { signedInAsAdmin } from '#/test-helpers/sign-in.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

const resetResult = {
  scope: 'cts-sam',
  issues: 377,
  issueHistoryEntries: 4,
  auditEntries: 379,
  ruleRuns: 1,
  importJobs: 0,
  importRejections: 0
}

describe('#admin reset', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  async function withCrumb() {
    const page = await server.inject({
      method: 'GET',
      url: '/admin/reset',
      auth: signedInAsAdmin
    })
    return {
      crumb: /name="crumb" value="([^"]+)"/.exec(page.result)?.[1],
      cookie: page.headers['set-cookie']?.[0].split(';')[0]
    }
  }

  const post = async (payload) => {
    const { crumb, cookie } = await withCrumb()
    return server.inject({
      method: 'POST',
      url: '/admin/reset',
      headers: { cookie },
      payload: { crumb, ...payload },
      auth: signedInAsAdmin
    })
  }

  test('Should warn about what is destroyed before anything is typed', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/admin/reset',
      auth: signedInAsAdmin
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toContain('There is no undo')
  })

  test('Should refuse without a key, and not call the backend at all', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(json(resetResult))

    const { statusCode, result } = await post({
      resetKey: '  ',
      scope: 'group'
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toContain('Enter the reset key')
    expect(
      fetchSpy.mock.calls.filter(([, init]) => init?.method === 'POST')
    ).toHaveLength(0)
  })

  test('Should send the key as a header and scope the wipe to the group by default', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(json(resetResult))

    await post({ resetKey: 'a-key', scope: 'group' })

    const [url, init] = fetchSpy.mock.calls.find(
      ([, i]) => i?.method === 'POST'
    )
    expect(url).toContain('/v1/maintenance/reset')
    expect(init.headers['x-reset-key']).toBe('a-key')
    expect(JSON.parse(init.body)).toEqual({ groupId: 'cts-sam' })
  })

  test('Should clear every group only when explicitly asked', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(json(resetResult))

    await post({ resetKey: 'a-key', scope: 'all' })

    const [, init] = fetchSpy.mock.calls.find(([, i]) => i?.method === 'POST')
    expect(JSON.parse(init.body)).toEqual({ groupId: null })
  })

  test('Should report what was deleted and send the user to the status page', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(resetResult))

    const { statusCode, headers } = await post({
      resetKey: 'a-key',
      scope: 'group'
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/admin/status')
  })

  test('Should show the backend reason when the key is refused', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(
        {
          title: 'Forbidden',
          detail: 'The supplied reset key is not valid.',
          code: 'reset.key_invalid'
        },
        statusCodes.forbidden
      )
    )

    const { statusCode, result } = await post({
      resetKey: 'wrong',
      scope: 'group'
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toContain('The supplied reset key is not valid.')
  })

  test('Should reject a POST with no CSRF token', async () => {
    const { statusCode } = await server.inject({
      method: 'POST',
      url: '/admin/reset',
      payload: { resetKey: 'a-key', scope: 'all' },
      auth: signedInAsAdmin
    })

    expect(statusCode).toBe(statusCodes.forbidden)
  })
})
