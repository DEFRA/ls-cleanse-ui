import { vi } from 'vitest'
import { load } from 'cheerio'
import { createServer } from '#/server/server.js'
import { signedIn } from '#/test-helpers/sign-in.js'

const json = (body) => new Response(JSON.stringify(body), { status: 200 })

describe('Recent issues in the Issues List and Grouped views', () => {
  let server
  let fetch

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  beforeEach(() => {
    fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/issues')) {
        return json({ items: [], totalCount: 0, pageNumber: 1, pageSize: 20 })
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

  const searchQuery = () =>
    new URL(
      fetch.mock.calls.find(([url]) => String(url).includes('/v1/issues'))[0]
    ).searchParams

  test.each(['/issues', '/issues/grouped'])(
    '%s always leaves out recent issues, and offers no way not to',
    async (path) => {
      const response = await server.inject({
        url: `${path}?filtered=true&applyMinimumAge=false`,
        auth: signedIn
      })

      expect(response.statusCode).toBe(200)
      expect(searchQuery().getAll('applyMinimumAge')).toEqual(['true'])
      const $ = load(response.result)
      const fields = $('form.app-filters [name]')
        .map((_, field) => $(field).attr('name'))
        .get()
      expect(fields).toContain('searchTerm')
      expect(fields.filter((name) => /age|minimum/i.test(name))).toEqual([])
    }
  )
})
