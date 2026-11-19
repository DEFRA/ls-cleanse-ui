import { config } from '#/config/config.js'
import { presentIssue, presentCphGroup } from './presenter.js'
import { CleanseApiError } from '#/server/common/helpers/cleanse/client.js'
import {
  knownUsers,
  userOptions
} from '#/server/common/helpers/cleanse/known-users.js'
import {
  issueStatuses,
  workflowStatuses,
  openWorkflowStatuses
} from '#/server/common/constants/workflow.js'

const pageSize = 20

const toArray = (value) => {
  if (value === undefined || value === null || value === '') {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

/**
 * The first visit gets a working queue rather than every issue ever raised. `filtered=true`
 * marks a deliberate choice, so that unticking everything shows everything rather than nothing.
 */
export function readFilters(query = {}) {
  const chosen = query.filtered === 'true'

  return {
    status: chosen ? toArray(query.status) : ['active'],
    workflowStatus: chosen
      ? toArray(query.workflowStatus)
      : [...openWorkflowStatuses],
    ruleId: query.ruleId ?? 'all',
    assignee: query.assignee ?? 'all',
    searchTerm: (query.searchTerm ?? '').trim(),
    page: Math.max(1, Number.parseInt(query.page, 10) || 1),
    groupSort: query.sort === 'count' ? 'count' : 'updated',
    groupDirection: query.dir === 'asc' ? 'asc' : 'desc',
    isDefault: !chosen
  }
}

/** Rebuilds the current filters as a query string, for pagination and for the back link. */
export function buildQuery(filters, page) {
  const params = new URLSearchParams({ filtered: 'true' })

  filters.status.forEach((value) => params.append('status', value))
  filters.workflowStatus.forEach((value) =>
    params.append('workflowStatus', value)
  )

  if (filters.ruleId !== 'all') {
    params.append('ruleId', filters.ruleId)
  }

  if (filters.searchTerm) {
    params.append('searchTerm', filters.searchTerm)
  }
  if (filters.assignee && filters.assignee !== 'all') {
    params.append('assignee', filters.assignee)
  }

  if (page > 1) {
    params.append('page', String(page))
  }

  if (filters.groupSort !== 'updated' || filters.groupDirection !== 'desc') {
    params.append('sort', filters.groupSort)
    params.append('dir', filters.groupDirection)
  }

  return `?${params.toString()}`
}

const groupSortColumns = [
  { name: 'count', text: 'Issues' },
  { name: 'updated', text: 'Last updated' }
]

/**
 * The sortable headers of the grouped table. A header sorts newest or largest first, and
 * choosing the current one reverses it. Every change returns to page one.
 */
export function buildGroupSortHeaders(filters) {
  return Object.fromEntries(
    groupSortColumns.map(({ name, text }) => {
      const current = filters.groupSort === name
      const direction = current ? filters.groupDirection : undefined
      const next = current && direction === 'desc' ? 'asc' : 'desc'

      return [
        name,
        {
          text,
          href: buildQuery(
            { ...filters, groupSort: name, groupDirection: next },
            1
          ),
          ariaSort: direction
            ? direction === 'asc'
              ? 'ascending'
              : 'descending'
            : 'none'
        }
      ]
    })
  )
}

/**
 * GOV.UK pagination shows first, last, current and its neighbours, with ellipses for the gaps.
 * Returns null for a single page, because the component should not appear at all then.
 */
export function buildPagination(filters, pageNumber, totalPages) {
  if (totalPages <= 1) {
    return null
  }

  const wanted = new Set([
    1,
    totalPages,
    pageNumber - 1,
    pageNumber,
    pageNumber + 1
  ])
  const pages = [...wanted]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b)

  const items = []
  let previous = 0

  for (const page of pages) {
    if (page - previous > 1) {
      items.push({ ellipsis: true })
    }

    items.push({
      number: page,
      href: buildQuery(filters, page),
      current: page === pageNumber
    })

    previous = page
  }

  return {
    items,
    previous:
      pageNumber > 1
        ? { href: buildQuery(filters, pageNumber - 1) }
        : undefined,
    next:
      pageNumber < totalPages
        ? { href: buildQuery(filters, pageNumber + 1) }
        : undefined
  }
}

/** Generous for any real set of filters; see the session plugin for why there is a limit. */
export const maxRememberedQueryLength = 1000

/**
 * The list URL to return to from an issue. Sessions live in the cookie, so a query too long to
 * carry is dropped in favour of the plain list rather than stored.
 */
export function rememberableQuery(url) {
  const full = url.pathname + url.search
  return full.length <= maxRememberedQueryLength ? full : url.pathname
}

/**
 * The remembered list URL to link back to. The session comes back from the browser, so anything
 * that is not the issues list, such as another site or a javascript: URL, is replaced by it.
 */
export function issuesBackLink(remembered) {
  return typeof remembered === 'string' &&
    /^\/issues(?:\/grouped)?(?:\?|$)/.test(remembered)
    ? remembered
    : '/issues'
}

const views = {
  list: {
    path: '/issues',
    search: (cleanse, query) => cleanse.searchIssues(query),
    present: (items) => ({ issues: items.map(presentIssue) })
  },
  grouped: {
    path: '/issues/grouped',
    search: (cleanse, query, filters) =>
      cleanse.searchIssuesByCph({
        ...query,
        groupSortBy:
          filters.groupSort === 'count' ? 'IssueCount' : 'LatestUpdatedAtUtc',
        groupSortDirection:
          filters.groupDirection === 'asc' ? 'Ascending' : 'Descending'
      }),
    present: (items) => ({ groups: items.map(presentCphGroup) })
  }
}

/** The List and Grouped tabs, each keeping the current filters but starting from page one. */
export function buildSubNavigation(filters, current) {
  const unsorted = { ...filters, groupSort: 'updated', groupDirection: 'desc' }
  const queryFor = (name) =>
    filters.isDefault ? '' : buildQuery(name === 'list' ? unsorted : filters, 1)

  return [
    { text: 'List', name: 'list' },
    { text: 'Grouped', name: 'grouped' }
  ].map(({ text, name }) => ({
    text,
    href: views[name].path + queryFor(name),
    current: name === current
  }))
}

function issuesController(viewName) {
  const view = views[viewName]

  return {
    async handler(request, h) {
      const filters = readFilters(request.query)
      const groupId = config.get('cleanse.groupId')
      let users
      try {
        users = await knownUsers(request.cleanse)
      } catch (error) {
        if (!(error instanceof CleanseApiError)) {
          throw error
        }
        request.logger.error(
          { status: error.status },
          'Could not load assignee choices'
        )
        return h
          .view('error/index', {
            pageTitle: 'Assignee choices unavailable',
            heading: 'Assignee choices unavailable',
            message: 'The user directory could not be loaded. Try again.'
          })
          .code(503)
      }
      const validAssignee = [
        'all',
        'unassigned',
        ...users.map((user) => user.id)
      ].includes(filters.assignee)
      if (!validAssignee) {
        request.logger.warn('An unavailable assignee filter was requested')
        return h
          .view('issues/filter-error', {
            pageTitle: 'Invalid assignee filter'
          })
          .code(400)
      }

      const [results, rules] = await Promise.all([
        view.search(
          request.cleanse,
          {
            groupId,
            status: filters.status.length === 1 ? filters.status[0] : undefined,
            workflowStatus: filters.workflowStatus,
            ruleId: filters.ruleId === 'all' ? undefined : filters.ruleId,
            searchTerm: filters.searchTerm || undefined,
            assignedUserId:
              filters.assignee !== 'all' && filters.assignee !== 'unassigned'
                ? filters.assignee
                : undefined,
            unassigned: filters.assignee === 'unassigned' ? true : undefined,
            sortBy: 'UpdatedAtUtc',
            sortDirection: 'Descending',
            pageNumber: filters.page,
            pageSize
          },
          filters
        ),
        request.cleanse.getRules()
      ])

      const totalPages = Math.ceil(results.totalCount / results.pageSize)
      const from =
        results.totalCount === 0
          ? 0
          : (results.pageNumber - 1) * results.pageSize + 1

      // Lets "Back to issues" return to the same view, filters and page.
      request.yar.set('lastIssuesQuery', rememberableQuery(request.url))

      return h.view('issues/list', {
        pageTitle: 'Issues',
        view: viewName,
        basePath: view.path,
        subNavigation: buildSubNavigation(filters, viewName),
        groupSortHeaders: buildGroupSortHeaders(filters),
        filters,
        ...view.present(results.items),
        totalCount: results.totalCount,
        from,
        to: Math.min(from + results.pageSize - 1, results.totalCount),
        pagination: buildPagination(filters, results.pageNumber, totalPages),
        assigneeItems: [
          {
            value: 'all',
            text: 'Anyone or unassigned',
            selected: filters.assignee === 'all'
          },
          {
            value: 'unassigned',
            text: 'Unassigned',
            selected: filters.assignee === 'unassigned'
          },
          ...userOptions(users, filters.assignee)
        ],
        workflowStatusItems: workflowStatuses.map((status) => ({
          value: status.id,
          text: status.name,
          checked: filters.workflowStatus.includes(status.id)
        })),
        statusItems: issueStatuses.map((status) => ({
          value: status.id,
          text: status.name,
          checked: filters.status.includes(status.id)
        })),
        ruleItems: [
          {
            value: 'all',
            text: 'All rules',
            selected: filters.ruleId === 'all'
          },
          ...rules.map((rule) => ({
            value: rule.ruleId,
            text: `${rule.ruleNumber}. ${rule.errorDescription}`,
            selected: filters.ruleId === rule.ruleId
          }))
        ]
      })
    }
  }
}

export const listController = issuesController('list')

export const groupedController = issuesController('grouped')
