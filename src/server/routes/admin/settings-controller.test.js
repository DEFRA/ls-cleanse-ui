import { vi } from 'vitest'
import { load } from 'cheerio'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { signedInAsAdmin } from '#/test-helpers/sign-in.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

/** The settings come from the backend; a write is answered by `respond`, and recorded. */
function stubBackend({
  minimumIssueAgeDays = 14,
  respond = (write) => json(write.body)
} = {}) {
  const writes = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init = {}) => {
    const { pathname } = new URL(url)
    if (init.method && init.method !== 'GET') {
      const write = {
        method: init.method,
        pathname,
        body: JSON.parse(init.body)
      }
      writes.push(write)
      return respond(write)
    }
    return json({ minimumIssueAgeDays })
  })
  return writes
}

describe('#admin settings', () => {
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

  const get = (url, cookie) =>
    server.inject({
      method: 'GET',
      url,
      headers: cookie ? { cookie } : {},
      auth: signedInAsAdmin
    })

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

  async function save(minimumIssueAgeDays) {
    const shown = await get('/admin/settings')
    const crumb = /name="crumb" value="([^"]+)"/.exec(shown.result)?.[1]
    const response = await server.inject({
      method: 'POST',
      url: '/admin/settings',
      headers: { cookie: cookiesFrom(shown) },
      payload: { crumb, minimumIssueAgeDays },
      auth: signedInAsAdmin
    })
    response.cookies = cookiesFrom(shown, response)
    return response
  }

  test('Should show the minimum issue age the backend holds', async () => {
    stubBackend()

    const { statusCode, result } = await get('/admin/settings')

    expect(statusCode).toBe(statusCodes.ok)
    const $ = load(result)
    expect($('h1').text()).toBe('Settings')
    expect($('label[for="minimumIssueAgeDays"]').text()).toContain(
      'Minimum issue age'
    )
    expect($('#minimumIssueAgeDays').val()).toBe('14')
    expect($('.govuk-input__suffix').text()).toBe('days')
  })

  test('Should show a minimum issue age of 0', async () => {
    stubBackend({ minimumIssueAgeDays: 0 })

    const $ = load((await get('/admin/settings')).result)

    expect($('#minimumIssueAgeDays').val()).toBe('0')
  })

  test('Should save a new minimum issue age, and say so', async () => {
    const writes = stubBackend()

    const saved = await save(' 7 ')
    const shown = await get('/admin/settings', saved.cookies)

    expect(saved.statusCode).toBe(statusCodes.found)
    expect(saved.headers.location).toBe('/admin/settings')
    expect(writes).toEqual([
      {
        method: 'PUT',
        pathname: '/v1/settings',
        body: { minimumIssueAgeDays: 7 }
      }
    ])
    expect(load(shown.result)('.govuk-notification-banner').text()).toContain(
      'Minimum issue age set to 7 days'
    )
  })

  test.each([
    ['', 'Enter the minimum issue age'],
    ['-1', 'Minimum issue age must be between 0 and 365 days'],
    ['366', 'Minimum issue age must be between 0 and 365 days'],
    ['1.5', 'Minimum issue age must be a whole number, like 14'],
    ['two weeks', 'Minimum issue age must be a whole number, like 14']
  ])('Should save nothing when given "%s"', async (value, message) => {
    const writes = stubBackend()

    const { statusCode, result } = await save(value)

    expect(statusCode).toBe(statusCodes.badRequest)
    const $ = load(result)
    expect($('.govuk-error-summary').text()).toContain(message)
    expect($('#minimumIssueAgeDays-error').text()).toContain(message)
    expect($('#minimumIssueAgeDays').val()).toBe(value)
    expect(writes).toHaveLength(0)
  })

  test('Should say why the backend refused a minimum issue age', async () => {
    stubBackend({
      respond: () =>
        json(
          {
            title: 'Invalid request',
            detail: 'The minimum issue age must be from 0 to 365 days.'
          },
          statusCodes.badRequest
        )
    })

    const { statusCode, result } = await save('30')

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(load(result)('.govuk-error-summary').text()).toContain(
      'The minimum issue age must be from 0 to 365 days.'
    )
  })

  test('Should be on the admin menu', async () => {
    const { result } = await get('/admin')

    expect(result).toContain('href="/admin/settings"')
  })
})
