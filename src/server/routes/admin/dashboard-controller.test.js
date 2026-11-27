import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { signedInAsAdmin } from '#/test-helpers/sign-in.js'
import {
  backlog,
  rules,
  status,
  work
} from '#/test-helpers/dashboard-figures.js'
import {
  addDays,
  addMonths,
  readFilters,
  resolvePeriod
} from './dashboard-controller.js'

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => structuredClone(body)
})

/** The backend, answering each address the dashboard asks. */
function backendAnswers({ figures = { work, backlog }, problem } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const address = String(url)
    if (problem && address.includes('/mi/')) {
      return json(problem, problem.status)
    }
    if (address.includes('/mi/work')) {
      return json(figures.work)
    }
    if (address.includes('/mi/backlog')) {
      return json(figures.backlog)
    }
    if (address.includes('/mi/status')) {
      return json(status)
    }
    if (address.endsWith('/v1/rules')) {
      return json(rules)
    }
    if (address.endsWith('/v1/groups')) {
      return json([
        { groupId: 'cts-sam', name: 'CTS and SAM', rulesEnabled: true }
      ])
    }
    return json({ title: 'Not found' }, 404)
  })
}

/** The figures the page carries for its script. */
const embedded = (html) =>
  JSON.parse(
    /<script type="application\/json" id="app-dashboard-data">([\s\S]*?)<\/script>/.exec(
      html
    )[1]
  )

describe('#dashboard filters', () => {
  test('Should fall back to the defaults for anything it does not recognise', () => {
    expect(
      readFilters({
        period: 'fortnight',
        interval: 'hour',
        tab: 'secret',
        unit: 'farms'
      })
    ).toEqual({
      period: '7d',
      from: undefined,
      to: undefined,
      interval: undefined,
      ruleId: undefined,
      userId: undefined,
      unit: 'issues',
      tab: 'overview'
    })
  })

  test('Should read a custom period from its dates, and only well-formed ones', () => {
    expect(readFilters({ from: '2026-11-01', to: '2026-11-27' })).toMatchObject(
      {
        period: 'custom',
        from: '2026-11-01',
        to: '2026-11-27'
      }
    )
    expect(
      readFilters({ period: 'custom', from: '1/11/2026' }).from
    ).toBeUndefined()
    expect(
      readFilters({ period: '4w', from: '2026-11-01' }).from
    ).toBeUndefined()
  })

  test('Should count issues when a rule is chosen, as a holding can have several rules', () => {
    expect(readFilters({ unit: 'holdings', ruleId: 'rule-1' }).unit).toBe(
      'issues'
    )
    expect(readFilters({ unit: 'holdings' }).unit).toBe('holdings')
  })

  test('Should turn each period into whole UK days ending today', () => {
    const today = '2026-11-27'
    expect(resolvePeriod({ period: '7d' }, today)).toEqual({
      from: '2026-11-21',
      to: today
    })
    expect(resolvePeriod({ period: '4w' }, today)).toEqual({
      from: '2026-10-31',
      to: today
    })
    expect(resolvePeriod({ period: '3m' }, today)).toEqual({
      from: '2026-08-28',
      to: today
    })
    expect(resolvePeriod({ period: '12m' }, today)).toEqual({
      from: '2025-11-28',
      to: today
    })
    expect(resolvePeriod({ period: 'all' }, today).from < '2026-01-01').toBe(
      true
    )
    expect(
      resolvePeriod(
        { period: 'custom', from: '2026-11-02', to: '2026-11-09' },
        today
      )
    ).toEqual({
      from: '2026-11-02',
      to: '2026-11-09'
    })
  })

  test('Should keep to the last day of a shorter month', () => {
    expect(addMonths('2026-05-31', -3)).toBe('2026-02-28')
    expect(addMonths('2024-05-31', -3)).toBe('2024-02-29')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('#admin dashboard', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  const get = (url, auth = signedInAsAdmin) =>
    server.inject({ method: 'GET', url, auth })

  test('Should be first in the admin menu', async () => {
    const { result } = await get('/admin')

    expect(result.indexOf('href="/admin/dashboard"')).toBeGreaterThan(-1)
    expect(result.indexOf('href="/admin/dashboard"')).toBeLessThan(
      result.indexOf('href="/admin/runs"')
    )
  })

  test('Should be behind the sign-in, like every admin page', async () => {
    for (const url of [
      '/admin/dashboard',
      '/admin/dashboard/data',
      '/admin/dashboard/status'
    ]) {
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url
      })

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toContain('/login')
    }
  })

  test('Should carry the first figures in the page, so it needs no second request to show them', async () => {
    const fetchSpy = backendAnswers()

    const { statusCode, result, headers } = await get(
      '/admin/dashboard?period=4w&tab=backlog'
    )

    expect(statusCode).toBe(statusCodes.ok)
    expect(headers['cache-control']).toBe('no-store')
    expect(result).toContain('CTS and SAM')
    expect(result).toContain('src/client/javascripts/dashboard.js')
    const data = embedded(result)
    expect(data.filters).toMatchObject({
      period: '4w',
      tab: 'backlog',
      unit: 'issues'
    })
    expect(data.figures.work.headline.resolved.value).toBe(12)
    expect(data.figures.backlog.openAtEnd).toBe(63)
    expect(data.rules).toEqual([
      { id: 'rule-1', text: 'Rule 1: Missing keeper' },
      { id: 'rule-3', text: 'Rule 3: Address mismatch' }
    ])

    const asked = fetchSpy.mock.calls.map(([url]) => new URL(String(url)))
    const workCall = asked.find((url) => url.pathname.endsWith('/mi/work'))
    expect(workCall.pathname).toBe('/v1/groups/cts-sam/mi/work')
    expect(workCall.searchParams.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(
      asked
        .find((url) => url.pathname.endsWith('/mi/backlog'))
        .searchParams.get('unit')
    ).toBe('issues')
  })

  test('Should offer the people the figures name as the Person filter', async () => {
    backendAnswers()

    const { result } = await get('/admin/dashboard')

    expect(result).toContain('>Alice Smith</option>')
    expect(result).toContain('>Bob Jones</option>')
    expect(result).not.toContain('>Not named</option>')
  })

  test('Should keep the figures from ending their script element, whatever a name says', async () => {
    const people = [
      { ...work.people[0], name: '</script><script>alert(1)</script>' }
    ]
    backendAnswers({ figures: { work: { ...work, people }, backlog } })

    const { result } = await get('/admin/dashboard')

    expect(result).not.toContain('<script>alert(1)</script>')
    expect(embedded(result).figures.work.people[0].name).toBe(
      '</script><script>alert(1)</script>'
    )
  })

  test('Should say what is wrong with filters the backend refuses', async () => {
    backendAnswers({
      problem: {
        status: 400,
        code: 'validation.failed',
        detail: 'from must be on or before to.'
      }
    })

    const { statusCode, result } = await get(
      '/admin/dashboard?from=2026-11-27&to=2026-11-01'
    )

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toContain('There is a problem with the filters')
    expect(result).toContain('from must be on or before to.')
    expect(embedded(result).figures).toBeNull()
  })

  test('Should say so, and offer to try again, when the figures cannot be loaded', async () => {
    backendAnswers({
      problem: { status: 503, title: 'The Cleanse service is unavailable' }
    })

    const { statusCode, result } = await get('/admin/dashboard')

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toContain('The figures could not be loaded')
    expect(result).toContain('Try again')
  })

  test('Should say the history is still being worked out before the first build', async () => {
    const unbuilt = { ...status, built: false, asAtUtc: null }
    backendAnswers({
      figures: {
        work: { ...work, status: unbuilt },
        backlog: { ...backlog, status: unbuilt }
      }
    })

    const { result } = await get('/admin/dashboard')

    expect(result).toContain('being worked out for the first time')
  })

  test('Should answer the page with the figures for a set of filters, as JSON', async () => {
    const fetchSpy = backendAnswers()

    const { statusCode, result, headers } = await get(
      '/admin/dashboard/data?period=12m&unit=holdings&userId=' +
        work.people[0].userId
    )

    expect(statusCode).toBe(statusCodes.ok)
    expect(headers['cache-control']).toBe('no-store')
    expect(result.filters).toMatchObject({ period: '12m', unit: 'holdings' })
    expect(result.figures.work.period.days).toBe(3)
    const asked = fetchSpy.mock.calls.map(([url]) => new URL(String(url)))
    expect(
      asked
        .find((url) => url.pathname.endsWith('/mi/work'))
        .searchParams.get('userId')
    ).toBe(work.people[0].userId)
    expect(
      asked
        .find((url) => url.pathname.endsWith('/mi/backlog'))
        .searchParams.get('userId')
    ).toBeNull()
  })

  test('Should pass on why the backend refused a set of filters', async () => {
    backendAnswers({ problem: { status: 400, detail: 'more than 400 points' } })

    const { statusCode, result } = await get(
      '/admin/dashboard/data?interval=day&period=all'
    )

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual({
      error: 'more than 400 points',
      filterProblem: true
    })
  })

  test('Should say when the figures were last brought up to date, for the page to check', async () => {
    backendAnswers()

    const { statusCode, result } = await get('/admin/dashboard/status')

    expect(statusCode).toBe(statusCodes.ok)
    expect(result.builtAtUtc).toBe(status.builtAtUtc)
  })
})
