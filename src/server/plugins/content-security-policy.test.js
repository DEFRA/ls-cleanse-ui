import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { signedIn } from '#/test-helpers/sign-in.js'

// The header is only set on a successful response, so the backend call the home page makes
// has to be stubbed or this asserts against a 500.
const summary = {
  groupId: 'cts-sam',
  totalIssues: 0,
  activeIssues: 0,
  inactiveIssues: 0,
  breakdown: [],
  latestRun: null
}

describe('#contentSecurityPolicy', () => {
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

  test('Should set the CSP policy header', async () => {
    const resp = await server.inject({
      method: 'GET',
      url: '/',
      auth: signedIn
    })

    expect(resp.statusCode).toBe(200)
    expect(resp.headers['content-security-policy']).toBeDefined()
  })
})
