import { config } from '#/config/config.js'
import { CleanseApiError } from '#/server/common/helpers/cleanse/client.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

const logger = createLogger()

/** The periods offered. Each ends today; Custom is a from and a to date. */
export const periods = [
  { id: '7d', text: '7 days', days: 7 },
  { id: '4w', text: '4 weeks', days: 28 },
  { id: '3m', text: '3 months', months: 3 },
  { id: '12m', text: '12 months', months: 12 },
  { id: 'all', text: 'All' },
  { id: 'custom', text: 'Custom' }
]

export const intervals = [
  { id: 'day', text: 'Day' },
  { id: 'week', text: 'Week' },
  { id: 'month', text: 'Month' }
]

export const tabs = [
  { id: 'overview', text: 'Overview' },
  { id: 'people', text: 'People' },
  { id: 'actions', text: 'Actions' },
  { id: 'outcomes', text: 'Outcomes' },
  { id: 'backlog', text: 'Backlog' }
]

/** Earlier than any history, which the backend cuts to where the history starts. */
const beforeAnyHistory = '2000-01-01'

const dayPattern = /^\d{4}-\d{2}-\d{2}$/

const ukDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

/** Today in the UK, as yyyy-mm-dd: the dashboard's days are UK days. */
export const ukToday = (now = new Date()) => ukDay.format(now)

const toDate = (day) => new Date(`${day}T00:00:00Z`)
const toDay = (date) => date.toISOString().slice(0, 10)

export function addDays(day, days) {
  const date = toDate(day)
  date.setUTCDate(date.getUTCDate() + days)
  return toDay(date)
}

/** The same day of the month, or the month's last day if it has no such day. */
export function addMonths(day, months) {
  const date = toDate(day)
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)
  )
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate()
  target.setUTCDate(Math.min(date.getUTCDate(), last))
  return toDay(target)
}

const text = (value) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const day = (value) => (dayPattern.test(value ?? '') ? value : undefined)

/**
 * The filters in the address. Anything unrecognised falls back to its default rather than
 * failing, so an old bookmark still opens. Choosing a rule means issues, as a holding can have
 * issues for several rules.
 */
export function readFilters(query = {}) {
  const from = day(query.from)
  const to = day(query.to)
  const named = periods.find((period) => period.id === query.period)?.id
  const period = named ?? (from || to ? 'custom' : '7d')
  const ruleId = text(query.ruleId)

  return {
    period,
    from: period === 'custom' ? from : undefined,
    to: period === 'custom' ? to : undefined,
    interval: intervals.some((interval) => interval.id === query.interval)
      ? query.interval
      : undefined,
    ruleId,
    userId: text(query.userId),
    unit: query.unit === 'holdings' && !ruleId ? 'holdings' : 'issues',
    tab: tabs.some((tab) => tab.id === query.tab) ? query.tab : 'overview'
  }
}

/** The from and to dates a period stands for, today being the UK day. */
export function resolvePeriod(filters, today) {
  const preset = periods.find((period) => period.id === filters.period)

  if (preset?.days) {
    return { from: addDays(today, 1 - preset.days), to: today }
  }

  if (preset?.months) {
    return { from: addDays(addMonths(today, -preset.months), 1), to: today }
  }

  if (filters.period === 'all') {
    return { from: beforeAnyHistory, to: today }
  }

  return { from: filters.from, to: filters.to }
}

/** Both sets of figures for the filters, asked for at once. */
async function loadFigures(request, groupId, filters) {
  const { from, to } = resolvePeriod(filters, ukToday())
  const shared = { from, to, interval: filters.interval }

  const [work, backlog] = await Promise.all([
    request.cleanse.getMiWork(groupId, {
      ...shared,
      ruleId: filters.ruleId,
      userId: filters.userId
    }),
    request.cleanse.getMiBacklog(groupId, {
      ...shared,
      ruleId: filters.unit === 'issues' ? filters.ruleId : undefined,
      unit: filters.unit
    })
  ])

  return { work, backlog }
}

/** A failure the admin can act on, such as a custom period that ends before it starts. */
const isFilterProblem = (error) => error.status === 400

async function describeGroup(request, groupId) {
  try {
    const groups = await request.cleanse.getGroups()
    return groups.find((group) => group.groupId === groupId)?.name ?? groupId
  } catch (error) {
    if (!(error instanceof CleanseApiError)) {
      throw error
    }
    return groupId
  }
}

async function listRules(request) {
  try {
    const rules = await request.cleanse.getRules()
    return rules.map((rule) => ({
      id: rule.ruleId,
      text: `Rule ${rule.ruleNumber}: ${rule.name}`
    }))
  } catch (error) {
    if (!(error instanceof CleanseApiError)) {
      throw error
    }
    return []
  }
}

export const dashboardController = {
  async handler(request, h) {
    const groupId = config.get('cleanse.groupId')
    const filters = readFilters(request.query)

    const [groupName, rules, loaded] = await Promise.all([
      describeGroup(request, groupId),
      listRules(request),
      loadFigures(request, groupId, filters).then(
        (figures) => ({ figures }),
        (error) => {
          if (!(error instanceof CleanseApiError)) {
            throw error
          }
          logger.warn(
            { status: error.status, code: error.code },
            'The dashboard figures could not be loaded'
          )
          return { error }
        }
      )
    ])

    const figures = loaded.figures ?? null
    const view = h.view('admin/dashboard', {
      pageTitle: 'Dashboard',
      groupId,
      groupName,
      filters,
      periods,
      intervals,
      tabs,
      rules,
      people: figures?.work.people.filter((person) => person.named) ?? [],
      status: figures?.work.status ?? null,
      today: ukToday(),
      filterError:
        loaded.error && isFilterProblem(loaded.error)
          ? loaded.error.detail
          : null,
      loadError:
        loaded.error && !isFilterProblem(loaded.error)
          ? (loaded.error.detail ?? loaded.error.title ?? loaded.error.message)
          : null,
      embedded: {
        filters,
        figures,
        rules,
        groupName,
        today: ukToday()
      }
    })

    // Names and work are in the page, so nothing on the way may keep a copy.
    return view
      .code(loaded.error && isFilterProblem(loaded.error) ? 400 : 200)
      .header('cache-control', 'no-store')
  }
}

/** The figures for a set of filters, for the page to fetch without reloading. */
export const dashboardDataController = {
  async handler(request, h) {
    const groupId = config.get('cleanse.groupId')
    const filters = readFilters(request.query)

    try {
      const figures = await loadFigures(request, groupId, filters)
      return h
        .response({ filters, figures, today: ukToday() })
        .header('cache-control', 'no-store')
    } catch (error) {
      if (!(error instanceof CleanseApiError)) {
        throw error
      }

      return h
        .response({
          error: error.detail ?? error.title ?? error.message,
          filterProblem: isFilterProblem(error)
        })
        .code(isFilterProblem(error) ? 400 : 502)
        .header('cache-control', 'no-store')
    }
  }
}

/** Asked every minute by an open dashboard, to see whether there are newer figures. */
export const dashboardStatusController = {
  async handler(request, h) {
    try {
      const status = await request.cleanse.getMiStatus(
        config.get('cleanse.groupId')
      )
      return h.response(status).header('cache-control', 'no-store')
    } catch (error) {
      if (!(error instanceof CleanseApiError)) {
        throw error
      }

      return h
        .response({ error: error.detail ?? error.message })
        .code(502)
        .header('cache-control', 'no-store')
    }
  }
}

export const rebuildDashboardController = {
  async handler(request, h) {
    try {
      await request.cleanse.rebuildMi(config.get('cleanse.groupId'))
      request.yar.flash(
        'notification',
        'The dashboard figures are being rebuilt. The dashboard shows the old figures until the new ones are ready.'
      )
    } catch (error) {
      if (!(error instanceof CleanseApiError)) {
        throw error
      }

      // 503 means the refresh is turned off in this environment.
      request.yar.flash('dashboardError', error.detail ?? error.message)
    }

    return h.redirect('/admin/status#dashboard-figures')
  }
}
