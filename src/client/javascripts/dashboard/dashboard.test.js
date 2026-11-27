// @vitest-environment happy-dom
import { vi } from 'vitest'

import {
  alice,
  backlog,
  status,
  work
} from '#/test-helpers/dashboard-figures.js'
import { startDashboard } from './start.js'

const rules = [
  { id: 'rule-1', text: 'Rule 1: Missing keeper' },
  { id: 'rule-3', text: 'Rule 3: Address mismatch' }
]

const tabs = ['overview', 'people', 'actions', 'outcomes', 'backlog']

const radio = (name, value, index, checked) =>
  `<div class="govuk-radios__item"><input class="govuk-radios__input" id="${name}${index ? `-${index + 1}` : ''}" name="${name}" type="radio" value="${value}"${checked ? ' checked' : ''}></div>`

/** The page as the server renders it, cut down to what the script uses. */
function renderPage(figures = { work, backlog }, filters = {}) {
  const data = {
    filters: { period: '7d', unit: 'issues', tab: 'overview', ...filters },
    figures,
    rules,
    groupName: 'CTS and SAM',
    today: '2026-11-27'
  }
  document.body.className = 'govuk-frontend-supported'
  document.body.innerHTML = `
    <div class="app-dashboard" data-module="app-dashboard" data-data-url="/admin/dashboard/data" data-status-url="/admin/dashboard/status">
      <p data-dashboard-status></p>
      <div data-dashboard-live aria-live="polite"></div>
      <form data-dashboard-filters>
        <input type="hidden" name="tab" value="${data.filters.tab}" data-dashboard-tab>
        <div class="govuk-radios" data-module="govuk-radios">
          ${['7d', '4w', '3m', '12m', 'all', 'custom'].map((value, index) => radio('period', value, index, value === data.filters.period)).join('')}
          <div class="govuk-radios__conditional govuk-radios__conditional--hidden" id="conditional-period-6">
            <input id="from" name="from" type="date"><input id="to" name="to" type="date">
          </div>
        </div>
        ${['day', 'week', 'month'].map((value, index) => radio('interval', value, index, false)).join('')}
        <select id="ruleId" name="ruleId"><option value="">All rules</option><option value="rule-1">Rule 1</option></select>
        <select id="userId" name="userId"><option value="">Everyone</option><option value="${alice}">Alice Smith</option></select>
        ${radio('unit', 'issues', 0, true)}${radio('unit', 'holdings', 1, false)}
        <button type="submit" data-dashboard-apply>Show these figures</button>
        <button type="button" data-dashboard-copy hidden>Copy link</button>
        <span data-dashboard-copied></span>
      </form>
      <div class="govuk-tabs" data-module="govuk-tabs">
        <h2 class="govuk-tabs__title">Contents</h2>
        <ul class="govuk-tabs__list">
          ${tabs.map((tab, index) => `<li class="govuk-tabs__list-item${index === 0 ? ' govuk-tabs__list-item--selected' : ''}"><a class="govuk-tabs__tab" href="#${tab}">${tab}</a></li>`).join('')}
        </ul>
        ${tabs.map((tab, index) => `<div class="govuk-tabs__panel${index ? ' govuk-tabs__panel--hidden' : ''}" id="${tab}"><div data-dashboard-panel="${tab}"></div></div>`).join('')}
      </div>
      <script type="application/json" id="app-dashboard-data">${JSON.stringify(data).replaceAll('<', '\\u003c')}</script>
    </div>`
}

const json = (body, statusCode = 200) => ({
  ok: statusCode < 300,
  status: statusCode,
  type: 'basic',
  json: async () => structuredClone(body)
})

const figureTitled = (title) =>
  [...document.querySelectorAll('figure.app-chart')].find(
    (figure) => figure.querySelector('.app-chart__title').textContent === title
  )

const tableRows = (figure) =>
  [...figure.querySelectorAll('.app-chart__table tbody tr')].map((row) =>
    [...row.children].map((cell) => cell.textContent)
  )

describe('#dashboard page', () => {
  let dashboard

  beforeEach(() => {
    window.history.replaceState(null, '', '/admin/dashboard')
    vi.spyOn(window, 'fetch').mockResolvedValue(json({}))
  })

  afterEach(() => {
    dashboard?.stop()
    vi.restoreAllMocks()
  })

  test('Should draw every tab from the figures in the page', () => {
    renderPage()
    dashboard = startDashboard(document, window)

    expect(document.querySelectorAll('#overview .app-headline')).toHaveLength(8)
    for (const title of [
      'Outcomes each day',
      'Open issues',
      'Why the number of open issues changed',
      'Outcomes each day, by person',
      'Actions by type',
      'Actions each day, by type',
      'Actions recorded on each holding closed in the period',
      'Resolved, by reason',
      "Can't resolve, by reason",
      'How issues moved',
      'Time to an outcome',
      'Outcomes by rule',
      'Active issues, by workflow status',
      'Active and inactive issues',
      'Age of open issues',
      'Open issues by rule'
    ]) {
      expect(figureTitled(title), title).toBeDefined()
    }
    expect(document.querySelectorAll('#overview svg').length).toBeGreaterThan(3)
    expect(
      document.querySelector('[data-dashboard-status]').textContent
    ).toContain('History from 3 November 2026')
  })

  test('Should show exactly what a chart shows as a table', () => {
    renderPage()
    dashboard = startDashboard(document, window)

    expect(tableRows(figureTitled('Outcomes each day'))).toEqual([
      ['25 November 2026', '4', '1', '0', '1'],
      ['26 November 2026', '6', '0', '1', '0'],
      ['27 November 2026', '2', '1', '0', '0']
    ])
    expect(
      tableRows(figureTitled('Why the number of open issues changed'))[0]
    ).toEqual(['Open at the start', '72', '0'])
    expect(
      figureTitled('Why the number of open issues changed').querySelector(
        '.app-chart__summary'
      ).textContent
    ).toBe(
      "72 open at the start of 25 November 2026, then up 6 raised, 1 came back, 1 reopened and 2 from SPOL imports, and down 12 resolved, 2 Can't resolve, 1 suppressed, 3 no longer found by the rules and 1 from SPOL imports: 63 open at the end."
    )

    const toggle =
      figureTitled('Outcomes each day').querySelector('[aria-controls]')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    toggle.click()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(
      document.getElementById(toggle.getAttribute('aria-controls')).hidden
    ).toBe(false)
  })

  test('Should compare each headline figure with the period before', () => {
    renderPage()
    dashboard = startDashboard(document, window)

    const [resolved] = document.querySelectorAll('.app-headline')
    expect(resolved.querySelector('.app-headline__value').textContent).toBe(
      '12'
    )
    expect(
      resolved.querySelector('.app-headline__comparison').textContent
    ).toBe('Up 2 (20%) on the 3 days before')
    expect(document.querySelectorAll('.app-headline')[7].textContent).toContain(
      '75%'
    )
  })

  test('Should move through a chart with the keyboard, and say each point', () => {
    renderPage()
    dashboard = startDashboard(document, window)
    const figure = figureTitled('Outcomes each day')
    const plot = figure.querySelector('.app-chart__plot')
    const readout = figure.querySelector('.app-chart__readout')

    plot.dispatchEvent(new Event('focus'))
    expect(readout.hidden).toBe(false)
    expect(readout.textContent).toContain('25 November 2026')
    expect(figure.querySelector('[role="status"]').textContent).toContain(
      'Resolved 4'
    )

    plot.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowRight' })
    )
    expect(readout.textContent).toContain('26 November 2026')
    expect(readout.textContent).toContain('Reopened 1')

    plot.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
    expect(readout.hidden).toBe(true)
  })

  test('Should switch a series off and on from its legend', () => {
    renderPage()
    dashboard = startDashboard(document, window)
    const figure = figureTitled('Outcomes each day')
    const bars = () => figure.querySelectorAll('.app-chart__bars rect').length
    const before = bars()

    const resolved = [
      ...figure.querySelectorAll('.app-chart__legend-item')
    ].find((item) => item.textContent === 'Resolved')
    resolved.click()

    expect(
      figure.querySelector('.app-chart__legend-item[aria-pressed="false"]')
        .textContent
    ).toBe('Resolved')
    expect(bars()).toBe(before - 3)
  })

  test('Should update the figures in place when a filter changes, and keep it in the address', async () => {
    renderPage()
    dashboard = startDashboard(document, window)
    const holdings = {
      ...backlog,
      unit: 'holdings',
      states: ['todo', 'in-progress', 'suppressed', 'closed']
    }
    window.fetch.mockResolvedValue(
      json({
        filters: { period: '7d', unit: 'holdings', tab: 'overview' },
        figures: { work, backlog: holdings },
        today: '2026-11-27'
      })
    )

    const unit = document.querySelector('[name="unit"][value="holdings"]')
    unit.checked = true
    unit.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => expect(figureTitled('Open holdings')).toBeDefined())

    expect(window.fetch).toHaveBeenCalledWith(
      '/admin/dashboard/data?unit=holdings',
      expect.objectContaining({ redirect: 'manual' })
    )
    expect(window.location.search).toBe('?unit=holdings')
    expect(
      figureTitled('Holdings with active issues, by holding status')
    ).toBeDefined()
    expect(document.querySelector('[data-dashboard-live]').textContent).toBe(
      'Figures updated'
    )
  })

  test('Should show one person\u2019s work when they are selected', async () => {
    renderPage()
    dashboard = startDashboard(document, window)
    window.fetch.mockResolvedValue(
      json({
        filters: { period: '7d', unit: 'issues', tab: 'people', userId: alice },
        figures: { work: { ...work, userId: alice }, backlog },
        today: '2026-11-27'
      })
    )

    document
      .querySelector('#people .app-people button[aria-label^="Alice Smith"]')
      .click()
    await vi.waitFor(() => expect(window.fetch).toHaveBeenCalled())

    expect(String(window.fetch.mock.calls[0][0])).toContain(`userId=${alice}`)
  })

  test('Should keep the tab in the address without asking for new figures', async () => {
    renderPage()
    dashboard = startDashboard(document, window)

    window.history.pushState(null, '', '/admin/dashboard#backlog')
    window.dispatchEvent(new window.PopStateEvent('popstate'))
    window.dispatchEvent(new window.HashChangeEvent('hashchange'))

    expect(window.fetch).not.toHaveBeenCalled()
    expect(window.location.search).toBe('?tab=backlog')
    expect(document.querySelector('[data-dashboard-tab]').value).toBe('backlog')

    window.fetch.mockResolvedValue(
      json({
        filters: { period: '4w', unit: 'issues', tab: 'backlog' },
        figures: { work, backlog },
        today: '2026-11-27'
      })
    )
    const period = document.querySelector('[name="period"][value="4w"]')
    period.checked = true
    period.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => expect(window.fetch).toHaveBeenCalled())

    expect(window.fetch.mock.calls[0][0]).toBe(
      '/admin/dashboard/data?period=4w&tab=backlog'
    )
  })

  test('Should keep the old figures and say so when new ones cannot be loaded', async () => {
    renderPage()
    dashboard = startDashboard(document, window)
    window.fetch.mockResolvedValue(
      json(
        { error: 'The Cleanse service is unavailable', filterProblem: false },
        502
      )
    )

    await dashboard.apply({ period: '4w', unit: 'issues', tab: 'overview' })

    expect(
      document.querySelector('.app-dashboard__message').textContent
    ).toContain('The figures could not be loaded')
    expect(
      document.querySelector('.app-dashboard__message button').textContent
    ).toBe('Try again')
    expect(figureTitled('Outcomes each day')).toBeDefined()
  })

  test('Should say when the sign-in has ended, with a way back to the same view', async () => {
    renderPage()
    dashboard = startDashboard(document, window)
    window.history.replaceState(null, '', '/admin/dashboard?period=4w')
    window.fetch.mockResolvedValue({
      ok: false,
      status: 0,
      type: 'opaqueredirect'
    })

    await dashboard.apply({ period: '4w', unit: 'issues', tab: 'overview' })

    const link = document.querySelector('.app-dashboard__message a')
    expect(link.textContent).toBe('Sign in again')
    expect(link.getAttribute('href')).toBe(
      '/admin/login?next=%2Fadmin%2Fdashboard%3Fperiod%3D4w'
    )
  })

  test('Should fetch newer figures only once they have been rebuilt', async () => {
    renderPage()
    dashboard = startDashboard(document, window)
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true
    })

    window.fetch.mockResolvedValue(
      json({ ...status, asAtUtc: '2026-11-27T10:44:00Z' })
    )
    await dashboard.check()
    expect(window.fetch).toHaveBeenCalledTimes(1)

    const rebuilt = {
      ...status,
      builtAtUtc: '2026-11-27T10:46:00Z',
      asAtUtc: '2026-11-27T10:46:00Z'
    }
    window.fetch.mockResolvedValueOnce(json(rebuilt)).mockResolvedValueOnce(
      json({
        filters: { period: '7d', unit: 'issues', tab: 'overview' },
        figures: { work: { ...work, status: rebuilt }, backlog },
        today: '2026-11-27'
      })
    )
    await dashboard.check()

    expect(window.fetch).toHaveBeenCalledTimes(3)
    expect(document.querySelector('[data-dashboard-live]').textContent).toMatch(
      /^Figures updated at /
    )
  })

  test('Should write every name as text, never as markup', () => {
    const people = [
      { ...work.people[0], name: '<img src=x onerror=alert(1)>' },
      ...work.people.slice(1)
    ]
    renderPage({ work: { ...work, people }, backlog })
    dashboard = startDashboard(document, window)

    expect(document.querySelector('.app-dashboard img')).toBeNull()
    expect(document.querySelector('#people').textContent).toContain(
      '<img src=x onerror=alert(1)>'
    )
  })

  test('Should say the history is being worked out, rather than draw empty charts', () => {
    const unbuilt = { ...status, built: false }
    renderPage({
      work: { ...work, status: unbuilt },
      backlog: { ...backlog, status: unbuilt }
    })
    dashboard = startDashboard(document, window)

    expect(document.querySelectorAll('figure.app-chart')).toHaveLength(0)
    expect(document.querySelector('#overview').textContent).toContain(
      'being worked out for the first time'
    )
  })
})
