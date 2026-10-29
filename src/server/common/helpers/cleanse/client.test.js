import { vi } from 'vitest'

import { createCleanseClient, CleanseApiError } from './client.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

const ok = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })

const problem = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json' }
  })

function stubFetch(response) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
}

const urlOf = (fetchSpy) => new URL(fetchSpy.mock.calls[0][0])

describe('#createCleanseClient query building', () => {
  test('sends scoped import name-matching context in multipart, never a secret', async () => {
    const fetchSpy = stubFetch(ok({ id: 'import-id' }))
    const client = createCleanseClient({ auth: { headers: async () => ({}) } })
    const tenantId = crypto.randomUUID()
    const clientId = crypto.randomUUID()
    await client.uploadImport({
      groupId: 'cts-sam',
      fileName: 'spol.csv',
      content: Buffer.from('header'),
      tenantId,
      clientId
    })
    const form = fetchSpy.mock.calls[0][1].body
    expect(form.get('tenantId')).toBe(tenantId)
    expect(form.get('clientId')).toBe(clientId)
    expect(form.get('file').name).toBe('spol.csv')
  })

  test('omits user-directory scope for password-mode imports', async () => {
    const fetchSpy = stubFetch(ok({ id: 'import-id' }))
    const client = createCleanseClient({ auth: { headers: async () => ({}) } })
    await client.uploadImport({
      groupId: 'cts-sam',
      fileName: 'spol.csv',
      content: Buffer.from('header')
    })
    const form = fetchSpy.mock.calls[0][1].body
    expect(form.has('tenantId')).toBe(false)
    expect(form.has('clientId')).toBe(false)
  })

  test('Should drop empty values rather than send them as blank filters', async () => {
    const fetchSpy = stubFetch(ok({ items: [] }))
    const client = createCleanseClient({ auth: { headers: async () => ({}) } })

    await client.searchIssues({
      groupId: 'cts-sam',
      searchTerm: '',
      ruleId: undefined,
      assignedTo: null
    })

    const { searchParams } = urlOf(fetchSpy)
    expect(searchParams.get('groupId')).toBe('cts-sam')
    expect(searchParams.has('searchTerm')).toBe(false)
    expect(searchParams.has('ruleId')).toBe(false)
    expect(searchParams.has('assignedTo')).toBe(false)
  })

  test('Should repeat a key for each value, which is how the backend binds a multi-filter', async () => {
    const fetchSpy = stubFetch(ok({ items: [] }))
    const client = createCleanseClient({ auth: { headers: async () => ({}) } })

    await client.searchIssues({ workflowStatus: ['todo', 'in-progress'] })

    expect(urlOf(fetchSpy).searchParams.getAll('workflowStatus')).toEqual([
      'todo',
      'in-progress'
    ])
  })

  test('Should encode an id that is not already URL-safe', async () => {
    const fetchSpy = stubFetch(ok({}))
    const client = createCleanseClient({ auth: { headers: async () => ({}) } })

    await client.getIssue('2:01/036/8000')

    expect(fetchSpy.mock.calls[0][0]).toContain(
      '/v1/issues/2%3A01%2F036%2F8000'
    )
  })

  test('Should send the auth headers the strategy supplies', async () => {
    const fetchSpy = stubFetch(ok({}))
    const client = createCleanseClient({
      auth: { headers: async () => ({ 'x-cleanse-api-key': 'secret' }) }
    })

    await client.getRules()

    expect(fetchSpy.mock.calls[0][1].headers).toMatchObject({
      'x-cleanse-api-key': 'secret'
    })
  })
})

describe('#createCleanseClient through the CDP developer gateway', () => {
  // Generated, so no literal in the repository reads as a credential to secret scanning.
  const gatewayKey = crypto.randomUUID()

  test('Should send the developer key the gateway expects alongside the service credential', async () => {
    const fetchSpy = stubFetch(ok({}))
    const client = createCleanseClient({
      baseUrl:
        'https://ephemeral-protected.api.dev.cdp-int.defra.cloud/cleanse/',
      auth: { headers: async () => ({ 'x-cleanse-api-key': 'service' }) },
      gatewayKey
    })

    await client.getRules()

    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://ephemeral-protected.api.dev.cdp-int.defra.cloud/cleanse/v1/rules'
    )
    expect(fetchSpy.mock.calls[0][1].headers).toMatchObject({
      'x-api-key': gatewayKey,
      'x-cleanse-api-key': 'service'
    })
  })

  test('Should send no gateway key when none is configured, as on CDP', async () => {
    const fetchSpy = stubFetch(ok({}))
    const client = createCleanseClient({ auth: { headers: async () => ({}) } })

    await client.getRules()

    expect(fetchSpy.mock.calls[0][1].headers).not.toHaveProperty('x-api-key')
  })
})

describe('#createCleanseClient error handling', () => {
  test('Should surface the stable code from the problem document', async () => {
    stubFetch(
      problem(409, {
        title: 'Conflict',
        detail: 'Issue has version 4, not the expected 3.',
        code: 'issue.concurrency_conflict'
      })
    )
    const client = createCleanseClient({ auth: { headers: async () => ({}) } })

    await expect(client.getIssue('abc')).rejects.toMatchObject({
      name: 'CleanseApiError',
      status: 409,
      code: 'issue.concurrency_conflict'
    })
  })

  test('Should flag a conflict and a not-found distinctly', async () => {
    expect(new CleanseApiError({ status: 409 }).isConflict).toBe(true)
    expect(new CleanseApiError({ status: 404 }).isNotFound).toBe(true)
    expect(new CleanseApiError({ status: 400 }).isConflict).toBe(false)
  })

  /** The backend answers an unknown import with a 400, so its code is what says it is missing. */
  test('Should recognise a not-found by its code as well as its status', () => {
    const error = (status, code) => new CleanseApiError({ status, code })

    expect(error(400, 'import.not_found').isNotFound).toBe(true)
    expect(error(400, 'validation.failed').isNotFound).toBe(false)
    expect(error(503, 'api.unreachable').isNotFound).toBe(false)
  })

  test('Should still raise a usable error when the body is not a problem document', async () => {
    stubFetch(new Response('<html>502</html>', { status: 502 }))
    const client = createCleanseClient({ auth: { headers: async () => ({}) } })

    await expect(client.getRules()).rejects.toMatchObject({ status: 502 })
  })

  test('Should turn a transport failure into an unreachable error, not a crash', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const client = createCleanseClient({ auth: { headers: async () => ({}) } })

    await expect(client.getRules()).rejects.toMatchObject({
      status: 503,
      code: 'api.unreachable'
    })
  })

  /** The search term is whatever a caseworker typed, so a failure log must not repeat it. */
  test('Should log a failed request by its path, never its query string', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const errorLog = vi
      .spyOn(createLogger(), 'error')
      .mockImplementation(() => {})
    const client = createCleanseClient({ auth: { headers: async () => ({}) } })

    await expect(
      client.searchIssues({ groupId: 'cts-sam', searchTerm: 'Keeper-Surname' })
    ).rejects.toMatchObject({ code: 'api.unreachable' })

    const [details] = errorLog.mock.calls.at(-1)
    expect(details.url).toMatch(/\/v1\/issues$/)
    expect(JSON.stringify(details)).not.toContain('Keeper-Surname')
  })

  /** A backend that accepts the connection but never answers must not hold the page open. */
  test('Should give up on a backend that does not answer within the timeout', async () => {
    let signal
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          signal = options.signal
          signal.addEventListener('abort', () => reject(signal.reason))
        })
    )
    const client = createCleanseClient({
      auth: { headers: async () => ({}) },
      timeout: 20
    })

    await expect(client.getRules()).rejects.toMatchObject({
      status: 503,
      code: 'api.unreachable'
    })
    expect(signal.aborted).toBe(true)
    expect(signal.reason).toMatchObject({ name: 'TimeoutError' })
  })

  test('Should time out every backend call by default', async () => {
    const fetchSpy = stubFetch(ok([]))
    const client = createCleanseClient({ auth: { headers: async () => ({}) } })

    await client.getRules()

    expect(fetchSpy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  /** Deployed, the credential is an STS token, and failing to mint one must not crash a page. */
  test('Should turn a credential that cannot be had into an error a page can show', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const client = createCleanseClient({
      auth: {
        name: 'stsJwt',
        headers: async () => {
          throw new Error('Could not load credentials from any providers')
        }
      }
    })

    await expect(client.getRules()).rejects.toMatchObject({
      name: 'CleanseApiError',
      status: 503,
      code: 'api.credentials_unavailable',
      detail:
        'Could not get an STS web identity token: Could not load credentials from any providers'
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
