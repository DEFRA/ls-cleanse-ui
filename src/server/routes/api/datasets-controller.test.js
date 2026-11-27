import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

const id = '0196a3a4-0000-7000-8000-000000000001'

// Generated, so no literal in the repository reads as a credential to secret scanning.
const key = `cleanse_ds_${crypto.randomUUID()}`

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

describe("#the SPOL connector's API", () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  const stubBackend = (answer) =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => answer())

  const body = (response) => JSON.parse(response.payload)

  test('Should check the key with the backend, and give the connector only what it shows', async () => {
    const fetchSpy = stubBackend(() =>
      json({
        id,
        name: 'November export',
        status: 'ready',
        rowCount: 31887,
        expectedRows: 31887,
        lastLoadedAtUtc: '2026-11-27T10:00:00Z',
        createdBy: 'Some Admin',
        version: 4
      })
    )

    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/datasets/${id}`,
      headers: { 'x-dataset-key': key }
    })

    expect(response.statusCode).toBe(statusCodes.ok)
    expect(body(response)).toEqual({
      id,
      name: 'November export',
      status: 'ready',
      rowCount: 31887,
      expectedRows: 31887,
      lastLoadedAtUtc: '2026-11-27T10:00:00Z'
    })
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['set-cookie']).toBeUndefined()
    const [url, options] = fetchSpy.mock.calls[0]
    expect(new URL(url).pathname).toBe(`/v1/datasets/${id}`)
    expect(options.headers['x-dataset-key']).toBe(key)
  })

  test('Should pass a page on to the backend, and its answer back', async () => {
    const answer = {
      datasetId: id,
      loadId: 'load',
      page: 1,
      pageCount: 160,
      rowsInPage: 1,
      rowCount: 1,
      totalRows: 31887,
      status: 'loading'
    }
    const fetchSpy = stubBackend(() => json(answer))
    const page = {
      loadId: 'load',
      page: 1,
      pageCount: 160,
      totalRows: 31887,
      rows: [{ itemId: 1, cph: '01/036/8000', notes: 'Line one\nline two' }]
    }

    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/datasets/${id}`,
      headers: { 'x-dataset-key': key },
      payload: page
    })

    expect(response.statusCode).toBe(statusCodes.ok)
    expect(body(response)).toEqual(answer)
    const [url, options] = fetchSpy.mock.calls[0]
    expect(new URL(url).pathname).toBe(`/v1/datasets/${id}`)
    expect(options.method).toBe('POST')
    expect(options.headers['x-dataset-key']).toBe(key)
    expect(JSON.parse(options.body)).toEqual(page)
  })

  test.each([
    ['GET', 'no key', {}, id],
    ['GET', 'a blank key', { 'x-dataset-key': ' ' }, id],
    ['GET', 'an id that is not a GUID', { 'x-dataset-key': key }, 'not-a-guid'],
    ['POST', 'no key', {}, id],
    ['POST', 'an id that is not a GUID', { 'x-dataset-key': key }, '1']
  ])(
    'Should refuse a %s with %s without asking the backend',
    async (method, _case, headers, datasetId) => {
      const fetchSpy = stubBackend(() => json({}))

      const response = await server.inject({
        method,
        url: `/api/v1/datasets/${datasetId}`,
        headers,
        payload: method === 'POST' ? { rows: [] } : undefined
      })

      expect(response.statusCode).toBe(statusCodes.unauthorized)
      expect(response.headers['content-type']).toContain(
        'application/problem+json'
      )
      expect(body(response)).toMatchObject({
        code: 'dataset.unauthorised',
        detail: 'The dataset id or key is not valid.'
      })
      expect(fetchSpy).not.toHaveBeenCalled()
    }
  )

  test("Should pass the backend's refusal on as it gave it", async () => {
    stubBackend(() =>
      json(
        {
          title: 'Conflict',
          status: 409,
          detail: 'A newer load has started.',
          code: 'dataset.load_superseded'
        },
        409
      )
    )

    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/datasets/${id}`,
      headers: { 'x-dataset-key': key },
      payload: { loadId: 'old', page: 2, pageCount: 2, totalRows: 2, rows: [] }
    })

    expect(response.statusCode).toBe(409)
    expect(body(response)).toEqual({
      status: 409,
      title: 'Conflict',
      detail: 'A newer load has started.',
      code: 'dataset.load_superseded'
    })
  })

  test('Should say so, as JSON, when the backend cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))

    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/datasets/${id}`,
      headers: { 'x-dataset-key': key }
    })

    expect(response.statusCode).toBe(statusCodes.serviceUnavailable)
    expect(body(response)).toMatchObject({ code: 'api.unreachable' })
  })

  test.each([
    ['CSV', { 'content-type': 'text/csv' }, 'itemId,cph\n1,01/036/8000', 415],
    [
      'JSON that will not parse',
      { 'content-type': 'application/json' },
      '{"rows": [',
      400
    ],
    [
      'more than 4 MB',
      { 'content-type': 'application/json' },
      `{"rows":"${'x'.repeat(4 * 1024 * 1024)}"}`,
      413
    ]
  ])(
    'Should refuse a page of %s, as JSON, without asking the backend',
    async (_case, headers, payload, status) => {
      const fetchSpy = stubBackend(() => json({}))

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/datasets/${id}`,
        headers: { ...headers, 'x-dataset-key': key },
        payload
      })

      expect(response.statusCode).toBe(status)
      expect(response.headers['content-type']).toContain(
        'application/problem+json'
      )
      expect(body(response).status).toBe(status)
      expect(fetchSpy).not.toHaveBeenCalled()
    }
  )

  test('Should answer an address it does not have with JSON', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/nothing-here'
    })

    expect(response.statusCode).toBe(statusCodes.notFound)
    expect(body(response).status).toBe(statusCodes.notFound)
  })
})
