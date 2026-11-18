import { vi } from 'vitest'
import { load } from 'cheerio'
import { createServer } from '#/server/server.js'
import { signedIn } from '#/test-helpers/sign-in.js'

const json = (body) => new Response(JSON.stringify(body), { status: 200 })

const issue = (id, ruleNumber, workflowStatus, extra = {}) => ({
  id,
  ruleId: `rule${ruleNumber}`,
  status: 'active',
  workflowStatus,
  updatedAtUtc: '2026-01-02T00:00:00Z',
  context: {
    cph: '01/234/5678',
    ruleNumber,
    errorCode: `0${ruleNumber}`,
    errorDescription: `Finding ${ruleNumber}`,
    ...extra
  }
})

describe('Issues grouped by CPH', () => {
  let server
  let fetch

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  beforeEach(() => {
    fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/issues/by-cph?')) {
        return json({
          items: [
            {
              cph: '01/234/5678',
              issueCount: 2,
              latestUpdatedAtUtc: '2026-01-02T00:00:00Z',
              issues: [
                issue('issue-1', '2', 'todo'),
                issue('issue-2', '5', 'in-progress', {
                  samFeatureName: 'Hill Farm'
                })
              ]
            }
          ],
          totalCount: 21,
          pageNumber: 1,
          pageSize: 20
        })
      }
      if (String(url).includes('/v1/users?')) {
        return json({ items: [], totalCount: 0 })
      }
      return json([])
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  const backendQuery = () =>
    new URL(
      fetch.mock.calls.find(([url]) =>
        String(url).includes('/v1/issues/by-cph?')
      )[0]
    ).searchParams

  test('renders each CPH with its count and every issue inside it', async () => {
    const response = await server.inject({
      url: '/issues/grouped?filtered=true&searchTerm=farm',
      auth: signedIn
    })

    expect(response.statusCode).toBe(200)
    expect(backendQuery().get('searchTerm')).toBe('farm')

    const $ = load(response.result)
    const parent = $('.app-grouped-table__parent')
    expect(parent).toHaveLength(1)
    expect(parent.find('.app-grouped-table__cph').text()).toBe('01/234/5678')
    expect(parent.text()).toContain('Hill Farm')
    expect(parent.find('.govuk-table__cell--numeric').text()).toBe('2')

    const child = $(
      `#${parent.find('.app-grouped-table__cph').data('controls')}`
    )
    expect(
      child
        .find('a')
        .map((_, a) => $(a).attr('href'))
        .get()
    ).toEqual(['/issues/issue-1', '/issues/issue-2'])
    expect(child.text()).toContain('Finding 5')
    // Open on the server, so the issues are reachable without JavaScript.
    expect(child.attr('hidden')).toBeUndefined()

    expect($('h2').text()).toContain('21 CPHs with matching issues')
    expect($('form.app-filters').attr('action')).toBe('/issues/grouped')
    expect(response.result).toContain('searchTerm=farm&amp;page=2')
  })

  test('marks Grouped as the current view and links back to List with the same filters', async () => {
    const response = await server.inject({
      url: '/issues/grouped?filtered=true&searchTerm=farm',
      auth: signedIn
    })

    const $ = load(response.result)
    const current = $('.app-sub-navigation [aria-current="page"]')
    expect(current.text()).toBe('Grouped')
    expect(
      $('.app-sub-navigation a')
        .filter((_, a) => $(a).text() === 'List')
        .attr('href')
    ).toBe('/issues?filtered=true&searchTerm=farm')
  })
})
