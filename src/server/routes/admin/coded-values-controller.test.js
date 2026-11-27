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

const entries = {
  'action-types': [
    { id: 'a1', name: 'Phoned the keeper', isActive: true },
    { id: 'a2', name: '<b>Old</b> letter', isActive: false }
  ],
  'resolved-reasons': [{ id: 'r1', name: 'Fixed in SAM', isActive: true }],
  'cant-resolve-reasons': []
}

/** Lists come from the backend; a write is answered by `respond`, and recorded. */
function stubBackend(respond = () => json({}, 201)) {
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
    return json(entries[pathname.slice('/v1/lists/'.length)] ?? [])
  })
  return writes
}

describe('#admin lists', () => {
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

  async function post(page, url, payload) {
    const shown = await get(page)
    const crumb = /name="crumb" value="([^"]+)"/.exec(shown.result)?.[1]
    const response = await server.inject({
      method: 'POST',
      url,
      headers: { cookie: cookiesFrom(shown) },
      payload: { crumb, ...payload },
      auth: signedInAsAdmin
    })
    response.cookies = cookiesFrom(shown, response)
    return response
  }

  test('Should list the action types, safely, and whether each is switched on', async () => {
    stubBackend()

    const { statusCode, result } = await get('/admin/action-types')

    expect(statusCode).toBe(statusCodes.ok)
    const $ = load(result)
    expect($('h1').text()).toBe('Action types')
    const rows = $('tbody tr')
    expect(rows.first().text()).toContain('Phoned the keeper')
    expect(rows.first().text()).toContain('Active')
    expect(rows.first().find('button').text()).toContain('Switch off')
    expect(rows.last().find('button').text()).toContain('Switch on')
    expect(result).toContain('&lt;b&gt;Old&lt;/b&gt; letter')
    expect(result).not.toContain('<b>Old</b>')
  })

  test('Should show both outcome lists, each with its own form', async () => {
    stubBackend()

    const $ = load((await get('/admin/outcome-reasons')).result)

    expect(
      $('main h2')
        .map((_, heading) => $(heading).text())
        .get()
    ).toEqual(['Resolved reasons', "Can't resolve reasons"])
    expect(
      $('input[name="list"]')
        .map((_, input) => $(input).val())
        .get()
    ).toEqual(['resolved-reasons', 'resolved-reasons', 'cant-resolve-reasons'])
    expect($('main').text()).toContain('None yet.')
  })

  test('Should add an entry to the list it was added under, and say so', async () => {
    const writes = stubBackend()
    const page = '/admin/outcome-reasons'

    const added = await post(page, page, {
      list: 'cant-resolve-reasons',
      name: '  Keeper has died  '
    })
    const shown = await get(page, added.cookies)

    expect(added.statusCode).toBe(statusCodes.found)
    expect(added.headers.location).toBe(page)
    expect(writes).toEqual([
      {
        method: 'POST',
        pathname: '/v1/lists/cant-resolve-reasons',
        body: { name: 'Keeper has died' }
      }
    ])
    expect(load(shown.result)('.govuk-notification-banner').text()).toContain(
      '"Keeper has died" added'
    )
  })

  test.each([
    [{ list: 'action-types', name: ' ' }, 'Enter the name of the action type'],
    [
      { list: 'action-types', name: 'x'.repeat(101) },
      'A name can be up to 100 characters'
    ],
    [{ list: 'resolved-reasons', name: 'Fixed' }, 'Choose which list to add to']
  ])('Should add nothing when given %o', async (payload, message) => {
    const writes = stubBackend()

    const { statusCode, result } = await post(
      '/admin/action-types',
      '/admin/action-types',
      payload
    )

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(load(result)('.govuk-error-summary').text()).toContain(message)
    expect(writes).toHaveLength(0)
  })

  test('Should say when the name is already in the list', async () => {
    stubBackend(() =>
      json({ code: 'coded_value.duplicate_name' }, statusCodes.conflict)
    )

    const { statusCode, result } = await post(
      '/admin/action-types',
      '/admin/action-types',
      { list: 'action-types', name: 'Phoned the keeper' }
    )

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(load(result)('.govuk-error-summary').text()).toContain(
      '"Phoned the keeper" is already in the list'
    )
    expect(load(result)('#name-action-types').val()).toBe('Phoned the keeper')
  })

  test('Should switch an entry off, and say which', async () => {
    const writes = stubBackend(() =>
      json({ id: 'a1', name: 'Phoned the keeper', isActive: false })
    )

    const { statusCode, headers } = await post(
      '/admin/action-types',
      '/admin/action-types/a1/active',
      { list: 'action-types', active: 'false' }
    )

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/admin/action-types')
    expect(writes).toEqual([
      {
        method: 'PUT',
        pathname: '/v1/lists/action-types/a1/active',
        body: { isActive: false }
      }
    ])
  })
})
