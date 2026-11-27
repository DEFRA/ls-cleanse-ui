import { vi } from 'vitest'
import { load } from 'cheerio'
import { createServer } from '#/server/server.js'
import { signedInAsAdmin } from '#/test-helpers/sign-in.js'

const datasetId = '0196a3a4-0000-7000-8000-000000000001'

/** The import and its report, as the backend gives them. */
function stubImport(job, items = []) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes('/rejections')
            ? { items, totalCount: items.length }
            : String(url).includes('/v1/imports/')
              ? job
              : { items: [job], totalCount: 1 }
        )
      )
  )
}

describe('SPOL imports', () => {
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

  const get = (url) => server.inject({ url, auth: signedInAsAdmin })

  test('shows warnings without claiming the entire row was rejected and escapes details', async () => {
    stubImport(
      {
        id: 'import-id',
        fileName: 'spol.csv',
        status: 'completed',
        matched: 1,
        source: 'file'
      },
      [{ rowNumber: 2, reason: 'AssigneeAmbiguous', detail: '<Same Name>' }]
    )

    const response = await get('/admin/imports/import-id')

    expect(response.statusCode).toBe(200)
    expect(response.result).toContain('Import warnings and rejected rows')
    expect(response.result).toContain('Warnings do not prevent')
    expect(response.result).toContain('&lt;Same Name&gt;')
    expect(response.result).not.toContain('1 row could not be applied')
    expect(load(response.result)('a.govuk-back-link').attr('href')).toBe(
      '/admin/imports'
    )
  })

  test("names a dataset's items by SharePoint item ID, counts the users added and links back to it", async () => {
    stubImport(
      {
        id: 'import-id',
        fileName: 'SPOL 27 Nov 2026 14:05',
        status: 'completed',
        source: 'dataset',
        datasetId,
        usersCreated: 3
      },
      [
        {
          rowNumber: 31887,
          reason: 'issue_not_found',
          detail: 'No issue exists.'
        }
      ]
    )

    const $ = load((await get('/admin/imports/import-id')).result)

    expect($('a.govuk-back-link').attr('href')).toBe(
      `/admin/datasets/${datasetId}`
    )
    expect($('h2').text()).toContain('Import warnings and rejected items')
    expect($('th').first().text()).toBe('Item ID')
    expect($('td').first().text()).toBe('31887')
    const summary = $('.govuk-summary-list').text()
    expect(summary).toContain('Users added')
    expect(summary).toContain('3')
    expect(
      $(`.govuk-summary-list a[href="/admin/datasets/${datasetId}"]`).text()
    ).toBe('SPOL 27 Nov 2026 14:05')
  })

  test("says when a dataset's import outlived its dataset", async () => {
    stubImport({
      id: 'import-id',
      fileName: 'Old export',
      status: 'completed',
      source: 'dataset',
      datasetId: null
    })

    const $ = load((await get('/admin/imports/import-id')).result)

    expect($('.govuk-summary-list').text()).toContain('Old export (deleted)')
    expect($('a.govuk-back-link').attr('href')).toBe('/admin/imports')
  })

  test('has nowhere to upload a file, and points to SPOL datasets instead', async () => {
    stubImport({
      id: 'import-id',
      fileName: 'spol.csv',
      status: 'completed',
      createdAtUtc: '2026-11-27T10:00:00Z'
    })

    const response = await get('/admin/imports')

    expect(response.statusCode).toBe(200)
    const $ = load(response.result)
    expect($('input[type="file"]')).toHaveLength(0)
    expect($('form[enctype="multipart/form-data"]')).toHaveLength(0)
    expect($('main a[href="/admin/datasets"]').length).toBeGreaterThan(0)
    expect($('a[href="/admin/imports/import-id"]').text()).toBe('spol.csv')
  })

  test('refuses a file posted to the old upload address', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/admin/imports',
      auth: signedInAsAdmin
    })

    expect(response.statusCode).toBe(404)
  })
})
