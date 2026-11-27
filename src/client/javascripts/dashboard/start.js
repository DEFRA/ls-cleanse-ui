import { createAll, Tabs } from 'govuk-frontend'

import { csvFileName } from './csv.js'
import { formatAsAt, formatDay } from './format.js'
import { createPanel, issuesUrl, tabBuilders } from './panels.js'

const filterNames = [
  'period',
  'from',
  'to',
  'interval',
  'ruleId',
  'userId',
  'unit',
  'tab'
]
const tabIds = Object.keys(tabBuilders)
const refreshEvery = 60000

/** The address for a set of filters, leaving out what is blank or the default. */
export function toQuery(filters) {
  const query = new URLSearchParams()
  for (const name of filterNames) {
    const value = filters[name]
    if (value === undefined || value === null || value === '') {
      continue
    }
    if (
      (name === 'period' && value === '7d') ||
      (name === 'unit' && value === 'issues') ||
      (name === 'tab' && value === 'overview')
    ) {
      continue
    }
    if ((name === 'from' || name === 'to') && filters.period !== 'custom') {
      continue
    }
    query.set(name, value)
  }
  return query.toString()
}

/** The filters in an address, as the server reads them. */
export function fromQuery(search) {
  const query = new URLSearchParams(search)
  const value = (name) => query.get(name) || undefined
  const from = value('from')
  const to = value('to')
  const ruleId = value('ruleId')
  return {
    period: value('period') ?? (from || to ? 'custom' : '7d'),
    from,
    to,
    interval: value('interval'),
    ruleId,
    userId: value('userId'),
    unit: value('unit') === 'holdings' && !ruleId ? 'holdings' : 'issues',
    tab: tabIds.includes(value('tab')) ? value('tab') : 'overview'
  }
}

function statusText(status, now) {
  if (!status?.built) {
    return 'The dashboard\u2019s history is being worked out for the first time. Check back in a few minutes.'
  }
  const history = status.historyFromUtc
    ? ` History from ${formatDay(status.historyFromUtc.slice(0, 10))}.`
    : ''
  return `Figures as at ${formatAsAt(status.asAtUtc, now)}. They are kept up to date every few minutes.${history}`
}

export function startDashboard(doc = document, win = window) {
  const root = doc.querySelector('[data-module="app-dashboard"]')
  const dataNode = doc.getElementById('app-dashboard-data')
  if (!root || !dataNode) {
    return null
  }

  let model = JSON.parse(dataNode.textContent)
  const listening = new AbortController()
  const on = (type, handler) =>
    win.addEventListener(type, handler, { signal: listening.signal })
  const form = root.querySelector('[data-dashboard-filters]')
  const statusLine = root.querySelector('[data-dashboard-status]')
  const live = root.querySelector('[data-dashboard-live]')
  const copyButton = root.querySelector('[data-dashboard-copy]')
  const copied = root.querySelector('[data-dashboard-copied]')
  const panels = new Map()
  let request = 0

  const message = doc.createElement('div')
  message.className = 'app-dashboard__message'
  message.hidden = true
  form.after(message)

  function showMessage(text, { link, retry } = {}) {
    message.replaceChildren()
    const box = doc.createElement('div')
    box.className = 'govuk-inset-text app-dashboard__message-box'
    const words = doc.createElement('p')
    words.className = 'govuk-body'
    words.textContent = text
    box.append(words)
    if (link) {
      const anchor = doc.createElement('a')
      anchor.className = 'govuk-link'
      anchor.href = link.href
      anchor.textContent = link.text
      box.append(anchor)
    }
    if (retry) {
      const button = doc.createElement('button')
      button.type = 'button'
      button.className =
        'govuk-button govuk-button--secondary govuk-!-margin-bottom-0'
      button.textContent = 'Try again'
      button.addEventListener('click', retry)
      box.append(button)
    }
    message.append(box)
    message.hidden = false
  }

  const hideMessage = () => {
    message.hidden = true
    message.replaceChildren()
  }

  const signInLink = () => ({
    href: `/admin/login?${new URLSearchParams({ next: `${win.location.pathname}${win.location.search}` })}`,
    text: 'Sign in again'
  })

  const actions = {
    setFilters: (partial) =>
      apply({ ...model.filters, ...partial }, { push: true }),
    openIssues: (state) =>
      win.location.assign(issuesUrl(state, { ruleId: model.filters.ruleId }))
  }

  function render() {
    const figures = model.figures
    for (const id of tabIds) {
      const holder = root.querySelector(`[data-dashboard-panel="${id}"]`)
      if (!holder) {
        continue
      }
      if (!figures) {
        holder.replaceChildren()
        continue
      }
      if (!figures.work.status.built) {
        const waiting = doc.createElement('p')
        waiting.className = 'govuk-body'
        waiting.textContent = statusText(figures.work.status)
        holder.replaceChildren(waiting)
        continue
      }

      const panel = createPanel(doc, {
        fileName: (chart) =>
          csvFileName(chart, {
            filters: model.filters,
            period: figures.work.period
          })
      })
      const view = {
        work: figures.work,
        backlog: figures.backlog,
        filters: model.filters,
        rules: model.rules ?? [],
        today: model.today
      }
      holder.replaceChildren(...tabBuilders[id](doc, view, panel, actions))
      panels.set(id, panel)
    }

    if (figures) {
      statusLine.textContent = statusText(figures.work.status, new Date())
    }
    redrawVisible()
  }

  function visibleTab() {
    const hash = win.location.hash.replace('#', '')
    return tabIds.includes(hash) ? hash : model.filters.tab
  }

  /** A hidden panel has no width, so its charts are drawn again once it can be seen. */
  function redrawVisible() {
    win.requestAnimationFrame?.(() =>
      panels.get(visibleTab())?.figures.forEach((figure) => figure.redraw())
    )
  }

  function syncForm(filters) {
    for (const name of filterNames) {
      const fields = form.querySelectorAll(`[name="${name}"]`)
      for (const field of fields) {
        if (field.type === 'radio') {
          field.checked = field.value === (filters[name] ?? '')
        } else {
          field.value = filters[name] ?? ''
        }
      }
    }
    const custom = form.querySelector('[name="period"][value="custom"]')
    const reveal = custom
      ? doc.getElementById(`conditional-${custom.id}`)
      : null
    reveal?.classList.toggle(
      'govuk-radios__conditional--hidden',
      filters.period !== 'custom'
    )

    // An interval that would give more than 400 points is not offered.
    const days = model.figures?.work.period.days ?? 0
    for (const radio of form.querySelectorAll('[name="interval"]')) {
      radio.disabled =
        (radio.value === 'day' && days > 400) ||
        (radio.value === 'week' && days > 2800)
    }
  }

  function readForm() {
    const data = new FormData(form)
    const filters = { ...model.filters }
    for (const name of filterNames) {
      const value = data.get(name)
      filters[name] = value === null || value === '' ? undefined : String(value)
    }
    if (filters.period !== 'custom') {
      filters.from = undefined
      filters.to = undefined
    }
    return filters
  }

  async function apply(filters, { push = false, quiet = false } = {}) {
    const ticket = ++request
    const query = toQuery(filters)
    if (push) {
      win.history.pushState(
        { filters },
        '',
        `${win.location.pathname}${query ? `?${query}` : ''}#${filters.tab ?? 'overview'}`
      )
    }
    syncForm(filters)
    if (!quiet) {
      root.classList.add('app-dashboard--loading')
      root.setAttribute('aria-busy', 'true')
    }

    try {
      const response = await win.fetch(
        `${root.dataset.dataUrl}${query ? `?${query}` : ''}`,
        {
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
          redirect: 'manual'
        }
      )
      if (ticket !== request) {
        return
      }
      if (
        response.type === 'opaqueredirect' ||
        response.status === 401 ||
        response.status === 0
      ) {
        showMessage(
          'Your sign-in has ended, so the figures cannot be updated.',
          { link: signInLink() }
        )
        return
      }

      const body = await response.json()
      if (!response.ok) {
        showMessage(
          body.filterProblem
            ? `These filters cannot be shown: ${body.error}`
            : `The figures could not be loaded: ${body.error}. The figures shown are the ones from before.`,
          { retry: () => apply(filters) }
        )
        return
      }

      hideMessage()
      if (!body?.filters || !body.figures?.work || !body.figures.backlog) {
        throw new Error('The answer had no figures in it.')
      }
      model = {
        ...model,
        filters: body.filters,
        figures: body.figures,
        today: body.today
      }
      syncForm(model.filters)
      render()
      live.textContent = quiet
        ? `Figures updated at ${formatAsAt(body.figures.work.status.asAtUtc)}`
        : 'Figures updated'
    } catch {
      if (ticket === request) {
        showMessage(
          'The figures could not be loaded. The figures shown are the ones from before.',
          {
            retry: () => apply(filters)
          }
        )
      }
    } finally {
      if (ticket === request) {
        root.classList.remove('app-dashboard--loading')
        root.removeAttribute('aria-busy')
      }
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    apply(readForm(), { push: true })
  })

  form.addEventListener('change', (event) => {
    const filters = readForm()
    if (event.target.name === 'ruleId' && filters.ruleId) {
      filters.unit = 'issues'
    }
    if (event.target.name === 'unit' && filters.unit === 'holdings') {
      filters.ruleId = undefined
    }
    if (filters.period === 'custom' && !(filters.from && filters.to)) {
      syncForm(filters)
      return
    }
    apply(filters, { push: true })
  })

  /** The tab is in the address too, so a link or a sign-in comes back to it. */
  function onTabChange() {
    const tab = visibleTab()
    if (tab !== model.filters.tab) {
      model = { ...model, filters: { ...model.filters, tab } }
      const tabField = form.querySelector('[data-dashboard-tab]')
      if (tabField) {
        tabField.value = tab
      }
      const query = toQuery(model.filters)
      win.history.replaceState(
        { filters: model.filters },
        '',
        `${win.location.pathname}${query ? `?${query}` : ''}#${tab}`
      )
    }
    redrawVisible()
  }

  const filtersOnly = (filters) => toQuery({ ...filters, tab: 'overview' })

  // Choosing a tab changes only the fragment, which fires popstate as well as hashchange. Only a
  // change to the filters needs new figures.
  on('popstate', () => {
    const asked = fromQuery(win.location.search)
    if (filtersOnly(asked) === filtersOnly(model.filters)) {
      onTabChange()
      return
    }
    apply({ ...asked, tab: visibleTab() })
  })

  on('hashchange', onTabChange)

  let resizing
  on('resize', () => {
    win.clearTimeout(resizing)
    resizing = win.setTimeout(
      () =>
        panels.get(visibleTab())?.figures.forEach((figure) => figure.redraw()),
      150
    )
  })

  // The charts print with their tables, so the tables are shown while printing.
  on('beforeprint', () => {
    for (const holder of root.querySelectorAll(
      '.app-chart__table-holder[hidden]'
    )) {
      holder.hidden = false
      holder.dataset.shownToPrint = 'true'
    }
  })
  on('afterprint', () => {
    for (const holder of root.querySelectorAll('[data-shown-to-print]')) {
      holder.hidden = true
      delete holder.dataset.shownToPrint
    }
  })

  form.querySelector('[data-dashboard-apply]')?.setAttribute('hidden', '')
  if (copyButton) {
    copyButton.hidden = false
    copyButton.addEventListener('click', async () => {
      try {
        await win.navigator.clipboard.writeText(win.location.href)
        copied.textContent = 'Link copied'
      } catch {
        copied.textContent = `Copy this link: ${win.location.href}`
      }
    })
  }

  /** While the page can be seen, asks every minute whether there are newer figures. */
  async function check() {
    if (doc.visibilityState !== 'visible' || !model.figures) {
      return
    }
    try {
      const response = await win.fetch(root.dataset.statusUrl, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        redirect: 'manual'
      })
      if (
        response.type === 'opaqueredirect' ||
        response.status === 401 ||
        response.status === 0
      ) {
        showMessage(
          'Your sign-in has ended, so the figures cannot be updated.',
          { link: signInLink() }
        )
        return
      }
      if (!response.ok) {
        return
      }
      const status = await response.json()
      const shown = model.figures.work.status
      if (
        status.builtAtUtc !== shown.builtAtUtc ||
        status.built !== shown.built
      ) {
        await apply(model.filters, { quiet: true })
      } else {
        model.figures.work.status = { ...shown, ...status }
        statusLine.textContent = statusText(
          model.figures.work.status,
          new Date()
        )
      }
    } catch {
      // The next check tries again.
    }
  }
  const timer = win.setInterval(check, refreshEvery)

  // The tab is in the address as well as the fragment, because signing in again keeps only the
  // address. The fragment is what the tabs read, so it is set from the address first.
  if (
    !tabIds.includes(win.location.hash.replace('#', '')) &&
    model.filters.tab !== 'overview'
  ) {
    win.history.replaceState(
      win.history.state,
      '',
      `${win.location.pathname}${win.location.search}#${model.filters.tab}`
    )
  }
  createAll(Tabs, undefined, root)
  syncForm(model.filters)
  render()

  return {
    apply,
    check,
    stop: () => {
      win.clearInterval(timer)
      listening.abort()
    },
    get model() {
      return model
    }
  }
}
