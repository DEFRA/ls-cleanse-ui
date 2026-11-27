import { vi } from 'vitest'
import { load } from 'cheerio'

import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { signedInAsAdmin } from '#/test-helpers/sign-in.js'

const id = '0196a3a4-0000-7000-8000-000000000001'
const jobId = '0196a3a4-0000-7000-8000-0000000000aa'

// Generated, so no literal in the repository reads as a credential to secret scanning.
const key = `cleanse_ds_${crypto.randomUUID()}`

const json = (body, status = 200) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

const dataset = (overrides = {}) => ({
  id,
  name: 'November export',
  status: 'ready',
  rowCount: 31887,
  expectedRows: 31887,
  createdBy: 'Some Admin',
  createdAtUtc: '2026-11-27T09:00:00Z',
  updatedAtUtc: '2026-11-27T10:00:00Z',
  loadStartedAtUtc: '2026-11-27T09:58:00Z',
  lastLoadedAtUtc: '2026-11-27T10:00:00Z',
  lastProcessing: null,
  version: 4,
  ...overrides
})

/**
 * The backend, by method and path. `answers` overrides one route; every write is recorded, with
 * its body, so a test can say what was sent.
 */
function stubBackend(answers = {}) {
  const writes = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init = {}) => {
    const { pathname } = new URL(url)
    const method = init.method ?? 'GET'
    const route = `${method} ${pathname}`
    if (method !== 'GET') {
      writes.push({
        route,
        body: init.body ? JSON.parse(init.body) : undefined,
        headers: init.headers
      })
    }
    if (answers[route]) {
      return answers[route]()
    }
    switch (route) {
      case 'GET /v1/datasets':
        return json({ items: [dataset()], totalCount: 1 })
      case `GET /v1/datasets/${id}`:
        return json(dataset())
      case 'GET /v1/imports':
        return json({ items: [], totalCount: 0 })
      case 'POST /v1/datasets':
        return json(
          { dataset: dataset({ status: 'empty', rowCount: 0 }), key },
          201
        )
      case `PUT /v1/datasets/${id}/name`:
        return json(dataset({ name: 'SPOL 27 Nov' }))
      case `DELETE /v1/datasets/${id}`:
        return new Response(null, { status: 204 })
      case `POST /v1/datasets/${id}/process`:
        return json({ id: jobId, status: 'pending', datasetId: id }, 202)
      case `GET /v1/imports/${jobId}`:
        return json({
          id: jobId,
          fileName: 'November export',
          status: 'pending',
          source: 'dataset',
          datasetId: id
        })
      case `GET /v1/imports/${jobId}/rejections`:
        return json({ items: [], totalCount: 0 })
      default:
        return json({ title: 'Not found' }, 404)
    }
  })
  return writes
}

const cookiesFrom = (...responses) =>
  [
    ...new Map(
      responses
        .flatMap((response) => response.headers['set-cookie'] ?? [])
        .map((cookie) => cookie.split(';')[0].split(/=(.*)/s))
    )
  ]
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')

describe('#admin SPOL datasets', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterEach(() => {
    config.set('cdpEnvironment', 'local')
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  const get = (url, cookie) =>
    server.inject({
      method: 'GET',
      url,
      headers: cookie ? { cookie } : {},
      auth: signedInAsAdmin
    })

  /** Opens the page with the form first, as a person would, then submits it. */
  async function submit(page, action, payload = {}) {
    const shown = await get(page)
    const crumb = /name="crumb" value="([^"]+)"/.exec(shown.result)?.[1]
    const response = await server.inject({
      method: 'POST',
      url: action,
      headers: { cookie: cookiesFrom(shown) },
      payload: { crumb, ...payload },
      auth: signedInAsAdmin
    })
    response.cookies = cookiesFrom(shown, response)
    return response
  }

  test('Should be on the admin menu, in place of the upload', async () => {
    const $ = load((await get('/admin')).result)

    expect($('a[href="/admin/datasets"]').text()).toBe('SPOL datasets')
    expect($('a[href="/admin/imports"]')).toHaveLength(0)
  })

  test('Should list each dataset with its status, rows and dates', async () => {
    stubBackend({
      'GET /v1/datasets': () =>
        json({
          items: [
            dataset(),
            dataset({
              id: '0196a3a4-0000-7000-8000-000000000002',
              name: 'Half loaded',
              status: 'loading',
              rowCount: 200,
              expectedRows: 31887,
              lastLoadedAtUtc: null,
              lastProcessing: {
                importJobId: jobId,
                status: 'completed',
                createdAtUtc: '2026-11-27T11:00:00Z'
              }
            })
          ],
          totalCount: 2
        })
    })

    const { statusCode, result } = await get('/admin/datasets')

    expect(statusCode).toBe(statusCodes.ok)
    const $ = load(result)
    const rows = $('tbody tr')
    expect(rows).toHaveLength(2)
    expect($(rows[0]).find(`a[href="/admin/datasets/${id}"]`).text()).toBe(
      'November export'
    )
    expect($(rows[0]).text()).toContain('Ready')
    expect($(rows[0]).text()).toContain('31,887')
    expect($(rows[1]).text()).toContain('200 of 31,887')
    expect($(rows[1]).text()).toContain('Not yet')
    expect($(rows[1]).find(`a[href="/admin/imports/${jobId}"]`)).toHaveLength(1)
    expect($('main a[href="/admin/imports"]')).toHaveLength(1)
  })

  test('Should say when there are no datasets', async () => {
    stubBackend({
      'GET /v1/datasets': () => json({ items: [], totalCount: 0 })
    })

    expect(
      load((await get('/admin/datasets')).result)('main').text()
    ).toContain('There are no datasets.')
  })

  test("Should show a new dataset's id, key and connector command once, and keep the key nowhere", async () => {
    const writes = stubBackend()

    const created = await submit('/admin/datasets', '/admin/datasets', {
      name: '  November export '
    })

    expect(created.statusCode).toBe(statusCodes.ok)
    expect(created.headers['cache-control']).toBe('no-store')
    const $ = load(created.result)
    expect($('#dataset-id').text()).toBe(id)
    expect($('#dataset-key').text()).toBe(key)
    expect($('#connector-command').text()).toBe(
      `.\\Invoke-SpolPipeline.ps1 -Environment local -DatasetId ${id}`
    )
    expect($('.govuk-warning-text').text()).toContain("won't be shown again")
    expect(writes).toEqual([
      expect.objectContaining({
        route: 'POST /v1/datasets',
        body: { name: 'November export' }
      })
    ])

    // Not carried in the session, so no later page can show it.
    const later = await get(`/admin/datasets/${id}`, created.cookies)
    expect(later.result).not.toContain(key)
    expect(created.headers['set-cookie'] ?? []).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^session=/)])
    )
  })

  test('Should leave an unnamed dataset for the backend to name', async () => {
    const writes = stubBackend()

    await submit('/admin/datasets', '/admin/datasets', { name: '   ' })

    expect(writes[0].body).toEqual({ name: null })
  })

  test('Should give the address to load into where the connector does not know the environment', async () => {
    config.set('cdpEnvironment', 'perf-test')
    stubBackend()

    const created = await submit('/admin/datasets', '/admin/datasets', {})

    expect(load(created.result)('#connector-command').text()).toMatch(
      new RegExp(
        `^\\.\\\\Invoke-SpolPipeline\\.ps1 -BaseUrl https://\\S+ -DatasetId ${id}$`
      )
    )
  })

  test('Should refuse a name over 100 characters without asking the backend', async () => {
    const writes = stubBackend()

    const response = await submit('/admin/datasets', '/admin/datasets', {
      name: 'x'.repeat(101)
    })

    expect(response.statusCode).toBe(statusCodes.badRequest)
    expect(load(response.result)('.govuk-error-summary').text()).toContain(
      'Name must be 100 characters or fewer'
    )
    expect(writes).toHaveLength(0)
  })

  test("Should show a dataset's details and processing runs, and offer to process it when it is Ready", async () => {
    stubBackend({
      'GET /v1/imports': () =>
        json({
          items: [
            {
              id: jobId,
              status: 'completed',
              createdAtUtc: '2026-11-27T11:00:00Z',
              totalRows: 31887,
              matched: 31000,
              unmatched: 887,
              usersCreated: 6
            }
          ],
          totalCount: 1
        })
    })

    const { statusCode, result } = await get(`/admin/datasets/${id}`)

    expect(statusCode).toBe(statusCodes.ok)
    const $ = load(result)
    expect($('h1').text()).toBe('November export')
    const summary = $('.govuk-summary-list').text()
    expect(summary).toContain(id)
    expect(summary).toContain('31,887')
    expect(summary).toContain('Some Admin')
    expect(
      $(`form[action="/admin/datasets/${id}/process"] button`).text()
    ).toContain('Process')
    expect($(`a[href="/admin/datasets/${id}/rename"]`)).toHaveLength(1)
    expect($(`a[href="/admin/datasets/${id}/delete"]`)).toHaveLength(1)
    const run = $('tbody tr')
    expect(run.find(`a[href="/admin/imports/${jobId}"]`)).toHaveLength(1)
    expect(
      run
        .find('td.govuk-table__cell--numeric')
        .map((_, cell) => $(cell).text().trim())
        .get()
    ).toEqual(['31,887', '31,000', '887', '6'])
    expect(result).not.toContain(key)
  })

  test.each([
    ['Empty', { status: 'empty', rowCount: 0 }, 'Nothing has been loaded yet'],
    [
      'Loading',
      { status: 'loading', rowCount: 200 },
      '200 of 31,887 rows have arrived'
    ]
  ])(
    'Should not offer to process a dataset that is %s',
    async (_status, overrides, says) => {
      stubBackend({
        [`GET /v1/datasets/${id}`]: () => json(dataset(overrides))
      })

      const $ = load((await get(`/admin/datasets/${id}`)).result)

      expect($(`form[action="/admin/datasets/${id}/process"]`)).toHaveLength(0)
      expect($('.govuk-inset-text').text()).toContain(says)
    }
  )

  test('Should neither process nor delete a dataset while it is being processed', async () => {
    stubBackend({
      [`GET /v1/datasets/${id}`]: () =>
        json(
          dataset({
            lastProcessing: { importJobId: jobId, status: 'processing' }
          })
        )
    })

    const $ = load((await get(`/admin/datasets/${id}`)).result)

    expect($(`form[action="/admin/datasets/${id}/process"]`)).toHaveLength(0)
    expect($(`a[href="/admin/datasets/${id}/delete"]`)).toHaveLength(0)
    expect($('.govuk-inset-text').text()).toContain('being processed')
  })

  test('Should start processing in the group, and open the import', async () => {
    const writes = stubBackend()

    const response = await submit(
      `/admin/datasets/${id}`,
      `/admin/datasets/${id}/process`
    )
    const opened = await get(`/admin/imports/${jobId}`, response.cookies)

    expect(response.statusCode).toBe(statusCodes.found)
    expect(response.headers.location).toBe(`/admin/imports/${jobId}`)
    expect(writes).toEqual([
      expect.objectContaining({
        route: `POST /v1/datasets/${id}/process`,
        body: { groupId: 'cts-sam' }
      })
    ])
    expect(opened.statusCode).toBe(statusCodes.ok)
  })

  test('Should say why the backend would not process the dataset', async () => {
    stubBackend({
      [`POST /v1/datasets/${id}/process`]: () =>
        json(
          {
            title: 'Conflict',
            detail: "Group 'cts-sam' already has import 'x' in progress.",
            code: 'import.already_in_progress'
          },
          409
        )
    })

    const response = await submit(
      `/admin/datasets/${id}`,
      `/admin/datasets/${id}/process`
    )

    expect(response.statusCode).toBe(statusCodes.conflict)
    expect(load(response.result)('.govuk-error-summary').text()).toContain(
      'already has import'
    )
  })

  test('Should rename a dataset at the version it was shown at', async () => {
    const writes = stubBackend()

    const saved = await submit(
      `/admin/datasets/${id}/rename`,
      `/admin/datasets/${id}/rename`,
      {
        name: ' SPOL 27 Nov ',
        version: '4'
      }
    )
    const shown = await get(`/admin/datasets/${id}`, saved.cookies)

    expect(saved.statusCode).toBe(statusCodes.found)
    expect(saved.headers.location).toBe(`/admin/datasets/${id}`)
    expect(writes).toEqual([
      expect.objectContaining({
        route: `PUT /v1/datasets/${id}/name`,
        body: { name: 'SPOL 27 Nov', expectedVersion: 4 }
      })
    ])
    expect(load(shown.result)('.govuk-notification-banner').text()).toContain(
      'Dataset renamed to SPOL 27 Nov'
    )
  })

  test('Should show the current name and version on the rename form', async () => {
    stubBackend()

    const $ = load((await get(`/admin/datasets/${id}/rename`)).result)

    expect($('#name').val()).toBe('November export')
    expect($('input[name="version"]').val()).toBe('4')
  })

  test.each([
    ['', 'Enter a name for the dataset'],
    ['x'.repeat(101), 'Name must be 100 characters or fewer']
  ])('Should not rename a dataset to "%s"', async (name, message) => {
    const writes = stubBackend()

    const response = await submit(
      `/admin/datasets/${id}/rename`,
      `/admin/datasets/${id}/rename`,
      {
        name,
        version: '4'
      }
    )

    expect(response.statusCode).toBe(statusCodes.badRequest)
    expect(load(response.result)('.govuk-error-summary').text()).toContain(
      message
    )
    expect(writes).toHaveLength(0)
  })

  test('Should say when the dataset changed while it was being renamed', async () => {
    stubBackend({
      [`PUT /v1/datasets/${id}/name`]: () =>
        json({ title: 'Conflict', code: 'dataset.concurrency_conflict' }, 409)
    })

    const response = await submit(
      `/admin/datasets/${id}/rename`,
      `/admin/datasets/${id}/rename`,
      {
        name: 'SPOL 27 Nov',
        version: '3'
      }
    )

    expect(response.statusCode).toBe(statusCodes.conflict)
    const $ = load(response.result)
    expect($('.govuk-error-summary').text()).toContain(
      'changed while you were renaming it'
    )
    expect($('#name').val()).toBe('SPOL 27 Nov')
    expect($('input[name="version"]').val()).toBe('4')
  })

  test('Should ask before deleting a dataset, then delete it', async () => {
    const writes = stubBackend()

    const asked = await get(`/admin/datasets/${id}/delete`)
    const deleted = await submit(
      `/admin/datasets/${id}/delete`,
      `/admin/datasets/${id}/delete`
    )
    const listed = await get('/admin/datasets', deleted.cookies)

    expect(load(asked.result)('.govuk-warning-text').text()).toContain(
      '31,887 rows'
    )
    expect(deleted.statusCode).toBe(statusCodes.found)
    expect(deleted.headers.location).toBe('/admin/datasets')
    expect(writes).toEqual([
      expect.objectContaining({ route: `DELETE /v1/datasets/${id}` })
    ])
    expect(load(listed.result)('.govuk-notification-banner').text()).toContain(
      'Dataset November export deleted'
    )
  })

  test('Should say why a dataset cannot be deleted', async () => {
    stubBackend({
      [`DELETE /v1/datasets/${id}`]: () =>
        json(
          {
            title: 'Conflict',
            detail: `Dataset '${id}' is being processed. Try again once it has finished.`,
            code: 'dataset.processing'
          },
          409
        )
    })

    const response = await submit(
      `/admin/datasets/${id}/delete`,
      `/admin/datasets/${id}/delete`
    )

    expect(response.statusCode).toBe(statusCodes.conflict)
    expect(load(response.result)('.govuk-error-summary').text()).toContain(
      'is being processed'
    )
  })

  test('Should answer a dataset the backend does not have with page not found', async () => {
    stubBackend({
      [`GET /v1/datasets/${id}`]: () =>
        json({ title: 'Not found', code: 'dataset.not_found' }, 404)
    })

    expect((await get(`/admin/datasets/${id}`)).statusCode).toBe(
      statusCodes.notFound
    )
  })
})
