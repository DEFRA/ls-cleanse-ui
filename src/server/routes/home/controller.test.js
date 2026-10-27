import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { signedIn } from '#/test-helpers/sign-in.js'

const summary = {
  groupId: 'cts-sam',
  totalIssues: 12,
  activeIssues: 10,
  inactiveIssues: 2,
  breakdown: [
    { status: 'active', workflowStatus: 'todo', count: 7 },
    { status: 'active', workflowStatus: 'in-progress', count: 3 },
    { status: 'inactive', workflowStatus: 'resolved', count: 2 }
  ],
  latestRun: null
}

describe('#homeController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(summary), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
  })

  test('Should provide expected response', async () => {
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/',
      auth: signedIn
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(
      expect.stringContaining('Cleanse - Cleanse - GOV.UK')
    )
  })

  test('Should count only active issues against each workflow status', async () => {
    const { result } = await server.inject({
      method: 'GET',
      url: '/',
      auth: signedIn
    })

    // 7 todo + 3 in progress are open; the 2 inactive resolved must not be counted as active.
    expect(result).toEqual(
      expect.stringContaining('10 of 10 active issues still need work.')
    )
  })
})
