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
  test('adds users by posting their email addresses', async () => {
    const fetchSpy = stubFetch(ok({ created: [], existing: [] }))
    const client = createCleanseClient({ auth: { headers: async () => ({}) } })
    await client.registerUsers({ emails: ['a@example.test'] })
    const [url, options] = fetchSpy.mock.calls[0]
    expect(new URL(url).pathname).toBe('/v1/users')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ emails: ['a@example.test'] })
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

describe('#createCleanseClient holdings and lists', () => {
  const noAuth = { auth: { headers: async () => ({}) } }

  test('Should ask for a holding by its CPH in the query string, never the path', async () => {
    const fetchSpy = stubFetch(ok({}))

    await createCleanseClient(noAuth).getHolding('cts-sam', '01/036/8000')

    const url = urlOf(fetchSpy)
    expect(url.pathname).toBe('/v1/holdings')
    expect(url.searchParams.get('groupId')).toBe('cts-sam')
    expect(url.searchParams.get('cph')).toBe('01/036/8000')
  })

  test.each([
    ['assignHolding', 'PUT', '/v1/holdings/assignee'],
    ['addHoldingNote', 'POST', '/v1/holdings/notes'],
    ['recordHoldingActions', 'POST', '/v1/holdings/actions'],
    ['updateHoldingIssues', 'POST', '/v1/holdings/workflow-status']
  ])(
    'Should send %s as %s %s, naming the person it is for',
    async (method, verb, path) => {
      const fetchSpy = stubFetch(ok({}))
      const body = { groupId: 'cts-sam', cph: '01/036/8000' }
      const client = createCleanseClient(noAuth).forRequest('trace', {
        actingUserId: 'user-1'
      })

      await client[method](body)

      const [url, options] = fetchSpy.mock.calls[0]
      expect(new URL(url).pathname).toBe(path)
      expect(options.method).toBe(verb)
      expect(JSON.parse(options.body)).toEqual(body)
      expect(options.headers['x-cleanse-user-id']).toBe('user-1')
    }
  )

  test('Should read the person when the change is sent, as the session loads after the client is made', async () => {
    const fetchSpy = stubFetch(ok({}))
    let signedIn = null
    const client = createCleanseClient(noAuth).forRequest('trace', {
      actingUserId: () => signedIn
    })

    signedIn = 'user-2'
    await client.addCodedValue('action-types', { name: 'Updated SAM' })

    const [url, options] = fetchSpy.mock.calls[0]
    expect(new URL(url).pathname).toBe('/v1/lists/action-types')
    expect(options.headers['x-cleanse-user-id']).toBe('user-2')
  })

  test('Should name nobody on a read, or when nobody is signed in', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => ok([]))
    const reader = createCleanseClient(noAuth).forRequest('trace', {
      actingUserId: 'user-1'
    })
    const anonymous = createCleanseClient(noAuth).forRequest('trace', {
      actingUserId: () => undefined
    })

    await reader.listCodedValues('resolved-reasons', { activeOnly: true })
    await anonymous.setCodedValueActive('action-types', 'id 1', {
      isActive: false
    })

    const [readUrl, read] = fetchSpy.mock.calls[0]
    const [writeUrl, write] = fetchSpy.mock.calls[1]
    expect(new URL(readUrl).searchParams.get('activeOnly')).toBe('true')
    expect(read.headers).not.toHaveProperty('x-cleanse-user-id')
    expect(new URL(writeUrl).pathname).toBe(
      '/v1/lists/action-types/id%201/active'
    )
    expect(write.headers).not.toHaveProperty('x-cleanse-user-id')
  })

  test('Should say which issue the backend refused', async () => {
    stubFetch(
      problem(400, {
        title: 'Bad request',
        code: 'workflow.transition_not_allowed',
        subject: '3-AAAA'
      })
    )

    await expect(
      createCleanseClient(noAuth).updateHoldingIssues({})
    ).rejects.toMatchObject({ status: 400, subject: '3-AAAA' })
  })

  test('Should read the settings, and change them for the person signed in', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => ok({ minimumIssueAgeDays: 7 }))
    const client = createCleanseClient(noAuth).forRequest('trace', {
      actingUserId: 'user-1'
    })

    await client.getSettings()
    await client.updateSettings({ minimumIssueAgeDays: 7 })

    const [readUrl, read] = fetchSpy.mock.calls[0]
    const [writeUrl, write] = fetchSpy.mock.calls[1]
    expect(new URL(readUrl).pathname).toBe('/v1/settings')
    expect(read.method).toBe('GET')
    expect(new URL(writeUrl).pathname).toBe('/v1/settings')
    expect(write.method).toBe('PUT')
    expect(JSON.parse(write.body)).toEqual({ minimumIssueAgeDays: 7 })
    expect(write.headers['x-cleanse-user-id']).toBe('user-1')
  })
})

describe('#createCleanseClient SPOL datasets', () => {
  const noAuth = { auth: { headers: async () => ({}) } }
  const id = '0196a3a4-0000-7000-8000-000000000001'

  test.each([
    ['createSpolDataset', [{ name: 'Nov' }], 'POST', '/v1/datasets', true],
    [
      'processSpolDataset',
      [id, { groupId: 'cts-sam' }],
      'POST',
      `/v1/datasets/${id}/process`,
      true
    ],
    [
      'renameSpolDataset',
      [id, { name: 'Nov', expectedVersion: 2 }],
      'PUT',
      `/v1/datasets/${id}/name`,
      false
    ],
    ['deleteSpolDataset', [id], 'DELETE', `/v1/datasets/${id}`, false],
    ['getSpolDataset', [id], 'GET', `/v1/datasets/${id}`, false]
  ])(
    'Should send %s to the backend',
    async (method, args, verb, path, forPerson) => {
      const fetchSpy = stubFetch(ok({}))
      const client = createCleanseClient(noAuth).forRequest('trace', {
        actingUserId: 'user-1'
      })

      await client[method](...args)

      const [url, options] = fetchSpy.mock.calls[0]
      expect(new URL(url).pathname).toBe(path)
      expect(options.method).toBe(verb)
      expect(options.headers['x-cleanse-user-id']).toBe(
        forPerson ? 'user-1' : undefined
      )
      expect(options.headers).not.toHaveProperty('x-dataset-key')
    }
  )

  test("Should send the connector's key on its calls, and its page as it came", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => ok({}))
    const client = createCleanseClient(noAuth)
    const page = {
      loadId: 'load',
      page: 1,
      pageCount: 1,
      totalRows: 1,
      rows: [{ itemId: 7 }]
    }

    await client.checkSpolDatasetKey(id, 'cleanse_ds_key')
    await client.loadSpolDatasetPage(id, 'cleanse_ds_key', page)

    const [checkUrl, check] = fetchSpy.mock.calls[0]
    const [loadUrl, load] = fetchSpy.mock.calls[1]
    expect(new URL(checkUrl).pathname).toBe(`/v1/datasets/${id}`)
    expect(check.method).toBe('GET')
    expect(check.headers['x-dataset-key']).toBe('cleanse_ds_key')
    expect(new URL(loadUrl).pathname).toBe(`/v1/datasets/${id}`)
    expect(load.method).toBe('POST')
    expect(load.headers['x-dataset-key']).toBe('cleanse_ds_key')
    expect(JSON.parse(load.body)).toEqual(page)
  })

  test("Should list a dataset's processing runs", async () => {
    const fetchSpy = stubFetch(ok({ items: [] }))

    await createCleanseClient(noAuth).searchImports({
      datasetId: id,
      pageSize: 20
    })

    expect(urlOf(fetchSpy).searchParams.get('datasetId')).toBe(id)
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
