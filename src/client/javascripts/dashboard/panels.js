import { statusStyle, categoryStyle } from './colours.js'
import {
  drawAreas,
  drawBars,
  drawColumns,
  drawFlow,
  drawLines,
  drawSparkline,
  drawWaterfall,
  inlineBar
} from './charts.js'
import { createFigure } from './figure.js'
import {
  describeBucket,
  describeChange,
  eachInterval,
  formatBucket,
  formatDay,
  formatInstantDay,
  formatNumber,
  formatPercent,
  formatRange,
  plural,
  previousPeriod
} from './format.js'

const openStates = ['todo', 'in-progress']

const waterfallReasons = {
  raised: 'Raised',
  'came-back': 'Came back',
  reopened: 'Reopened',
  'suppression-ended': 'Suppression ended',
  spol: 'SPOL imports',
  resolved: 'Resolved',
  'cant-resolve': "Can't resolve",
  suppressed: 'Suppressed',
  'no-longer-found': 'No longer found by the rules',
  correction: 'Corrections'
}

/** The same reasons in a sentence, after a number: 12 came back, 24 from SPOL imports. */
const waterfallPhrases = {
  raised: 'raised',
  'came-back': 'came back',
  reopened: 'reopened',
  'suppression-ended': 'suppressions ended',
  spol: 'from SPOL imports',
  resolved: 'resolved',
  'cant-resolve': "Can't resolve",
  suppressed: 'suppressed',
  'no-longer-found': 'no longer found by the rules',
  correction: 'corrected'
}

/** a, b and c */
const listOf = (items) =>
  items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

const ageBands = {
  'under-1-week': 'Under 1 week',
  '1-2-weeks': '1 to 2 weeks',
  '2-4-weeks': '2 to 4 weeks',
  '1-2-months': '1 to 2 months',
  '2-3-months': '2 to 3 months',
  '3-6-months': '3 to 6 months',
  'over-6-months': 'Over 6 months'
}

const actionBands = {
  0: 'None',
  1: '1 action',
  2: '2 actions',
  3: '3 actions',
  4: '4 actions',
  '5-or-more': '5 or more'
}

const el = (doc, tag, className, text) => {
  const node = doc.createElement(tag)
  if (className) {
    node.className = className
  }
  if (text !== undefined) {
    node.textContent = text
  }
  return node
}

const sumOf = (values) =>
  values.reduce((total, value) => total + (value ?? 0), 0)

/** Which bucket each marker falls in, for the dashed lines on time charts. */
function markersFor(buckets, markers = []) {
  return markers
    .map((marker) => ({
      kind: marker.kind,
      index: buckets.findIndex(
        (bucket) => marker.day >= bucket.start && marker.day <= bucket.end
      )
    }))
    .filter((marker) => marker.index >= 0)
}

function markerNote(markers) {
  const kinds = new Set(markers.map((marker) => marker.kind))
  return [
    kinds.has('spol-import') ? 'Dashed lines mark SPOL imports.' : null,
    kinds.has('history-start')
      ? 'A dotted line marks where the history starts.'
      : null
  ]
    .filter(Boolean)
    .join(' ')
}

const ruleName = (rules, ruleId) =>
  rules.find((rule) => rule.id === ruleId)?.text ?? `Rule ${ruleId}`

const listEntryName = (entry, empty) =>
  entry.id === null
    ? empty
    : entry.active === false
      ? `${entry.name} (no longer offered)`
      : entry.name

/** The period in words: 21 to 27 November 2026 (today so far), compared with the 7 days before. */
export function describePeriod(
  period,
  today,
  { compared = true, byInterval = false } = {}
) {
  const range = formatRange(period.from, period.to)
  const sofar = period.to === today ? ' (today so far)' : ''
  const comparison =
    compared && period.hasPrevious
      ? `, compared with ${previousPeriod(period.days)}`
      : ''
  const interval = byInterval ? `, by ${period.interval}` : ''
  return `${range}${sofar}${interval}${comparison}.`
}

function headlineCard(doc, { label, value, comparison, series, colour }) {
  const card = el(doc, 'div', 'app-headline')
  card.append(
    el(doc, 'p', 'govuk-body-s app-headline__label', label),
    el(doc, 'p', 'app-headline__value', value),
    el(
      doc,
      'p',
      'govuk-body-s app-secondary-text app-headline__comparison',
      comparison
    )
  )
  if (series?.length) {
    const spark = el(doc, 'div', 'app-headline__spark')
    spark.setAttribute('aria-hidden', 'true')
    spark.append(drawSparkline(spark, series, { colour }) ?? '')
    card.append(spark)
  }
  return card
}

function section(doc, className = 'app-dashboard__charts') {
  return el(doc, 'div', className)
}

/** A small column chart for each person, all on one scale, moved through together. */
function drawMultiples(doc, plot, options) {
  const { rows, labels, yMax, buckets, width } = options
  const nameRoom = Math.min(180, Math.round(width * 0.25))
  const drawn = rows.map((person) => {
    const row = el(doc, 'div', 'app-small-multiples__row')
    row.append(
      el(doc, 'span', 'govuk-body-s app-small-multiples__name', person.name)
    )
    const holder = el(doc, 'div', 'app-small-multiples__plot')
    row.append(holder)
    plot.append(row)
    return drawColumns(holder, {
      ...options,
      width: Math.max(120, width - nameRoom),
      labels,
      compact: true,
      yMax,
      series: [
        {
          key: 'outcomes',
          label: 'Outcomes',
          style: statusStyle('resolved'),
          values: person.outcomes
        }
      ]
    })
  })

  return {
    points: labels.length,
    describe: (index) => [
      describeBucket(buckets[index]),
      ...rows.map(
        (person) => `${person.name} ${formatNumber(person.outcomes[index])}`
      )
    ],
    highlight: (index) => drawn.forEach((chart) => chart.highlight(index))
  }
}

/** A figure for a chart over time, with its points named as the interval names them. */
function timeLabels(buckets, interval) {
  return buckets.map((bucket) => formatBucket(bucket, interval))
}

function statusSeries(states, points, keyOf = (state) => state) {
  return states.map((state) => ({
    key: state,
    label: statusStyle(state).label,
    style: statusStyle(state),
    values: points.map((point) => point.counts?.[keyOf(state)] ?? 0)
  }))
}

function legendOf(series) {
  return series.map((entry) => ({
    key: entry.key,
    label: entry.label,
    colour: entry.style.colour,
    pattern: entry.style.pattern,
    line: entry.style.line
  }))
}

/** Links to the Issues list, for the open or active issues in each status. */
function issuesLinks(doc, states, { ruleId, userId }) {
  const list = el(doc, 'p', 'govuk-body-s app-chart__links')
  list.append(doc.createTextNode('Open in the Issues list: '))
  states.forEach((state, index) => {
    const query = new URLSearchParams({
      filtered: 'true',
      status: 'active',
      workflowStatus: state
    })
    if (ruleId) {
      query.set('ruleId', ruleId)
    }
    if (userId) {
      query.set('assignee', userId)
    }
    const link = el(doc, 'a', 'govuk-link', statusStyle(state).label)
    link.href = `/issues?${query}`
    list.append(link)
    if (index < states.length - 1) {
      list.append(doc.createTextNode(', '))
    }
  })
  list.append(
    doc.createTextNode(
      '. The Issues list leaves out issues too new to list, so it can show fewer.'
    )
  )
  return list
}

export function issuesUrl(state, { ruleId, userId } = {}) {
  const query = new URLSearchParams({ filtered: 'true', status: 'active' })
  for (const each of Array.isArray(state) ? state : [state]) {
    query.append('workflowStatus', each)
  }
  if (ruleId) {
    query.set('ruleId', ruleId)
  }
  if (userId) {
    query.set('assignee', userId)
  }
  return `/issues?${query}`
}

/** Everything a panel draws, so the figures in it can be told about the crosshair and resizes. */
export function createPanel(doc, context) {
  const figures = []
  const add = (spec) => {
    const figure = createFigure(doc, spec, {
      filtersForFile: context.fileName,
      onCrosshair: (index, source) => {
        for (const other of figures) {
          if (other.element !== source && other.isTime()) {
            other.crosshair(index)
          }
        }
      }
    })
    figures.push(figure)
    return figure.element
  }
  return { figures, add }
}

function overview(doc, model, panel, actions) {
  const { work, backlog, filters, today } = model
  const nodes = []
  const days = work.period.days
  const compare = (figure) =>
    work.period.hasPrevious
      ? describeChange(figure.value, figure.previous, days)
      : ''
  const unitWord = backlog.unit === 'holdings' ? 'holdings' : 'issues'

  nodes.push(el(doc, 'p', 'govuk-body', describePeriod(work.period, today)))
  if (filters.userId) {
    nodes.push(personNotice(doc, work, actions))
  }

  const h = work.headline
  const confirmedShare = h.confirmed.resolved
    ? h.confirmed.noLongerFound / h.confirmed.resolved
    : 0
  const openChange = backlog.openAtEnd - backlog.openAtStart
  const cards = el(doc, 'div', 'app-headlines')
  cards.append(
    headlineCard(doc, {
      label: 'Issues resolved',
      value: formatNumber(h.resolved.value),
      comparison: compare(h.resolved),
      series: h.resolved.series,
      colour: statusStyle('resolved').colour
    }),
    headlineCard(doc, {
      label: "Issues marked Can't resolve",
      value: formatNumber(h.cantResolve.value),
      comparison: compare(h.cantResolve),
      series: h.cantResolve.series,
      colour: statusStyle('nonactionable').colour
    }),
    headlineCard(doc, {
      label: 'Holdings closed',
      value: formatNumber(h.holdingsClosed.value),
      comparison: compare(h.holdingsClosed),
      series: h.holdingsClosed.series
    }),
    headlineCard(doc, {
      label: 'Actions recorded',
      value: formatNumber(h.actions.value),
      comparison: compare(h.actions),
      series: h.actions.series
    }),
    headlineCard(doc, {
      label: 'People working',
      value: formatNumber(h.peopleWorking.value),
      comparison: compare(h.peopleWorking),
      series: h.peopleWorking.series
    }),
    headlineCard(doc, {
      label: 'Holdings worked',
      value: formatNumber(h.holdingsWorked.value),
      comparison: compare(h.holdingsWorked),
      series: h.holdingsWorked.series
    }),
    headlineCard(doc, {
      label: `Open ${unitWord} now`,
      value: formatNumber(backlog.openAtEnd),
      comparison:
        openChange === 0
          ? 'No change in the period'
          : `${openChange > 0 ? 'Up' : 'Down'} ${formatNumber(Math.abs(openChange))} in the period`,
      series: backlog.openOverTime
    }),
    headlineCard(doc, {
      label: 'Confirmed by the rules',
      value: h.confirmed.resolved
        ? formatPercent(confirmedShare)
        : 'None resolved',
      comparison: h.confirmed.resolved
        ? `Of the issues resolved, the rules no longer find ${formatNumber(h.confirmed.noLongerFound)}`
        : ''
    })
  )
  nodes.push(cards)

  const labels = timeLabels(work.buckets, work.period.interval)
  const outcomeSeries = [
    {
      key: 'resolved',
      label: 'Resolved',
      style: statusStyle('resolved'),
      values: work.outcomes.map((point) => point.resolved)
    },
    {
      key: 'cantResolve',
      label: "Can't resolve",
      style: statusStyle('nonactionable'),
      values: work.outcomes.map((point) => point.cantResolve)
    },
    {
      key: 'reopened',
      label: 'Reopened, below the line',
      style: { colour: '#d4351c', pattern: 'hatch' },
      values: work.outcomes.map((point) => point.reopened),
      below: true
    }
  ]
  const totalOutcomes =
    sumOf(outcomeSeries[0].values) + sumOf(outcomeSeries[1].values)
  const markers = markersFor(work.buckets, work.markers)
  const charts = section(doc)
  charts.append(
    panel.add({
      id: 'outcomes',
      time: true,
      title: `Outcomes ${eachInterval(work.period.interval)}`,
      summary: totalOutcomes
        ? `${plural(sumOf(outcomeSeries[0].values), 'issue')} resolved and ${formatNumber(sumOf(outcomeSeries[1].values))} marked Can't resolve, with ${formatNumber(sumOf(outcomeSeries[2].values))} reopened.`
        : 'Nothing was recorded in this period.',
      legend: legendOf(outcomeSeries),
      note: markerNote(markers),
      draw: (plot, options) =>
        drawColumns(plot, {
          ...options,
          labels,
          series: outcomeSeries,
          markers,
          describe: (index) => [
            describeBucket(work.buckets[index]),
            ...outcomeSeries
              .filter((entry) => !options.hidden.has(entry.key))
              .map(
                (entry) =>
                  `${entry.label.replace(', below the line', '')} ${formatNumber(entry.values[index])}`
              )
          ]
        }),
      table: {
        columns: [
          'Point',
          'Resolved',
          "Can't resolve",
          'Reopened',
          'Suppressed'
        ],
        rows: work.outcomes.map((point, index) => [
          describeBucket(work.buckets[index]),
          point.resolved,
          point.cantResolve,
          point.reopened,
          point.suppressed
        ])
      }
    }),
    openOverTimeFigure(doc, model, panel, actions),
    waterfallFigure(model, panel)
  )
  nodes.push(charts)
  nodes.push(
    el(
      doc,
      'p',
      'govuk-body-s app-secondary-text',
      "Work counts only what people did in Cleanse. Changes from SPOL imports, the rules and suppressions ending are no one's work. They do change the open figures, so the last chart shows them. Its Resolved bar counts only issues that stopped being open, so it can be smaller than the headline figure, which also counts outcomes for suppressed and inactive issues."
    )
  )
  return nodes
}

function openOverTimeFigure(doc, model, panel, actions) {
  const { backlog, filters } = model
  const labels = timeLabels(backlog.buckets, backlog.period.interval)
  const series = statusSeries(openStates, backlog.byStatus)
  const unitWord = backlog.unit === 'holdings' ? 'holdings' : 'issues'
  const first = backlog.openAtStart
  const last = backlog.openAtEnd
  const figure = panel.add({
    id: 'open-over-time',
    time: true,
    title: `Open ${unitWord}`,
    summary:
      first === last
        ? `${formatNumber(last)} open ${unitWord}, the same as at the start.`
        : `Open ${unitWord} ${last < first ? 'fell' : 'rose'} from ${formatNumber(first)} to ${formatNumber(last)}. For the whole group, whoever is chosen.`,
    legend: legendOf(series),
    draw: (plot, options) =>
      drawAreas(plot, {
        ...options,
        labels,
        series,
        markers: markersFor(backlog.buckets, backlog.markers),
        onSelect:
          backlog.unit === 'issues'
            ? (state) => actions.openIssues(state)
            : undefined,
        describe: (index) => [
          describeBucket(backlog.buckets[index]),
          ...series
            .filter((entry) => !options.hidden.has(entry.key))
            .map(
              (entry) => `${entry.label} ${formatNumber(entry.values[index])}`
            )
        ]
      }),
    table: {
      columns: ['Point', ...series.map((entry) => entry.label)],
      rows: backlog.byStatus.map((point, index) => [
        describeBucket(backlog.buckets[index]),
        ...series.map((entry) => entry.values[index])
      ])
    }
  })
  if (backlog.unit === 'issues') {
    figure.append(issuesLinks(doc, openStates, { ruleId: filters.ruleId }))
  }
  return figure
}

function waterfallFigure(model, panel) {
  const { backlog } = model
  const unitWord = backlog.unit === 'holdings' ? 'holdings' : 'issues'
  const steps = backlog.waterfall.steps.map((step) => ({
    reason: step.reason,
    label: waterfallReasons[step.reason] ?? step.reason,
    up: step.up,
    down: step.down
  }))
  const phrase = (step, count) =>
    `${formatNumber(count)} ${waterfallPhrases[step.reason] ?? step.label}`
  const ups = steps
    .filter((step) => step.up)
    .map((step) => phrase(step, step.up))
  const downs = steps
    .filter((step) => step.down)
    .map((step) => phrase(step, step.down))
  const startDay = formatDay(backlog.period.from)
  const moves = [
    ups.length ? `up ${listOf(ups)}` : null,
    downs.length ? `down ${listOf(downs)}` : null
  ].filter(Boolean)
  return panel.add({
    id: 'why-open-changed',
    wide: true,
    title: `Why the number of open ${unitWord} changed`,
    summary: `${formatNumber(backlog.waterfall.start)} open at the start of ${startDay}${moves.length ? `, then ${moves.join(', and ')}` : ', and nothing changed'}: ${formatNumber(backlog.waterfall.end)} open at the end.`,
    draw: (plot, options) =>
      drawWaterfall(plot, {
        ...options,
        start: backlog.waterfall.start,
        end: backlog.waterfall.end,
        steps,
        startLabel: `Open at the start`,
        endLabel: 'Open at the end',
        upStyle: { colour: '#b04500', pattern: 'hatch' },
        downStyle: { colour: '#00703c', pattern: 'solid' },
        totalStyle: { colour: '#505a5f', pattern: 'solid' }
      }),
    table: {
      columns: ['Reason', 'Up', 'Down'],
      rows: [
        ['Open at the start', backlog.waterfall.start, 0],
        ...steps.map((step) => [step.label, step.up, step.down]),
        ['Open at the end', backlog.waterfall.end, 0]
      ]
    }
  })
}

function personNotice(doc, work, actions) {
  const person = work.people.find((entry) => entry.userId === work.userId)
  const notice = el(doc, 'div', 'govuk-inset-text app-dashboard__person')
  notice.append(
    doc.createTextNode(
      `Showing the work of ${person?.name ?? 'one person'} alone. `
    )
  )
  const clear = el(doc, 'button', 'app-link-button govuk-link', 'Show everyone')
  clear.type = 'button'
  clear.addEventListener('click', () =>
    actions.setFilters({ userId: undefined })
  )
  notice.append(clear)
  return notice
}

const peopleColumns = [
  { key: 'resolved', label: 'Resolved' },
  { key: 'cantResolve', label: "Can't resolve" },
  { key: 'suppressed', label: 'Suppressed' },
  { key: 'actions', label: 'Actions' },
  { key: 'notes', label: 'Notes' },
  { key: 'holdingsWorked', label: 'Holdings worked' },
  { key: 'holdingsClosed', label: 'Holdings closed' },
  { key: 'openHoldingsAssigned', label: 'Open holdings assigned now' }
]

function peopleTable(doc, model, actions) {
  const { work } = model
  const wrapper = el(doc, 'div', 'app-dashboard__table-wrapper')
  const table = el(doc, 'table', 'govuk-table app-table--compact app-people')
  table.append(
    el(
      doc,
      'caption',
      'govuk-table__caption govuk-table__caption--s',
      'Work by person'
    )
  )
  let sort = { key: 'name', direction: 'ascending' }
  const largest = Object.fromEntries(
    peopleColumns.map((column) => [
      column.key,
      Math.max(0, ...work.people.map((person) => person[column.key] ?? 0))
    ])
  )

  const head = el(doc, 'thead', 'govuk-table__head')
  const body = el(doc, 'tbody', 'govuk-table__body')
  const foot = el(doc, 'tfoot', 'govuk-table__body app-people__team')

  const headers = [
    { key: 'name', label: 'Person' },
    ...peopleColumns,
    { key: 'lastActiveUtc', label: 'Last active' }
  ]
  const headRow = el(doc, 'tr', 'govuk-table__row')
  const sortButtons = headers.map((column) => {
    const th = el(
      doc,
      'th',
      `govuk-table__header${column.key === 'name' || column.key === 'lastActiveUtc' ? '' : ' govuk-table__header--numeric'}`
    )
    th.scope = 'col'
    const button = el(doc, 'button', 'app-sort-button', column.label)
    button.type = 'button'
    button.addEventListener('click', () => {
      sort = {
        key: column.key,
        direction:
          sort.key === column.key && sort.direction === 'descending'
            ? 'ascending'
            : sort.key === column.key
              ? 'descending'
              : column.key === 'name'
                ? 'ascending'
                : 'descending'
      }
      renderRows()
    })
    th.append(button)
    headRow.append(th)
    return { th, key: column.key }
  })
  head.append(headRow)

  function renderRows() {
    for (const { th, key } of sortButtons) {
      th.setAttribute('aria-sort', key === sort.key ? sort.direction : 'none')
    }
    const people = [...work.people].sort((a, b) => {
      const by = sort.key
      const order = sort.direction === 'ascending' ? 1 : -1
      if (by === 'name') {
        return order * a.name.localeCompare(b.name, 'en-GB')
      }
      if (by === 'lastActiveUtc') {
        return (
          order *
          String(a.lastActiveUtc ?? '').localeCompare(
            String(b.lastActiveUtc ?? '')
          )
        )
      }
      return (
        order * ((a[by] ?? 0) - (b[by] ?? 0)) ||
        a.name.localeCompare(b.name, 'en-GB')
      )
    })

    body.replaceChildren(
      ...people.map((person) => {
        const row = el(doc, 'tr', 'govuk-table__row')
        const nameCell = el(doc, 'th', 'govuk-table__header')
        nameCell.scope = 'row'
        if (person.named && person.userId) {
          const choose = el(
            doc,
            'button',
            'app-link-button govuk-link',
            person.name
          )
          choose.type = 'button'
          choose.setAttribute(
            'aria-label',
            `${person.name}: show the dashboard for their work alone`
          )
          choose.addEventListener('click', () =>
            actions.setFilters({ userId: person.userId })
          )
          nameCell.append(choose)
        } else {
          nameCell.textContent = person.name
        }
        row.append(nameCell)

        for (const column of peopleColumns) {
          const cell = el(
            doc,
            'td',
            'govuk-table__cell govuk-table__cell--numeric'
          )
          const value = person[column.key] ?? 0
          if (
            column.key === 'openHoldingsAssigned' &&
            person.userId &&
            value > 0
          ) {
            const link = el(doc, 'a', 'govuk-link', formatNumber(value))
            link.href = issuesUrl(openStates, { userId: person.userId })
            cell.append(link)
          } else {
            cell.append(doc.createTextNode(formatNumber(value)))
          }
          if (value > 0) {
            cell.append(inlineBar(doc, value, largest[column.key]))
          }
          row.append(cell)
        }

        row.append(
          el(
            doc,
            'td',
            'govuk-table__cell',
            person.lastActiveUtc
              ? formatInstantDay(person.lastActiveUtc)
              : 'Not this period'
          )
        )
        return row
      })
    )
  }

  const team = work.team
  const teamRow = el(doc, 'tr', 'govuk-table__row')
  const teamName = el(
    doc,
    'th',
    'govuk-table__header',
    `Team (${plural(team.people, 'person', 'people')})`
  )
  teamName.scope = 'row'
  teamRow.append(teamName)
  for (const column of peopleColumns) {
    const cell = el(doc, 'td', 'govuk-table__cell govuk-table__cell--numeric')
    cell.append(el(doc, 'strong', null, formatNumber(team[column.key] ?? 0)))
    if (column.key === 'openHoldingsAssigned') {
      const link = el(
        doc,
        'a',
        'govuk-link app-people__unassigned',
        `and ${formatNumber(team.unassignedOpenHoldings)} unassigned`
      )
      link.href = issuesUrl(openStates, { userId: 'unassigned' })
      cell.append(doc.createElement('br'), link)
    }
    teamRow.append(cell)
  }
  teamRow.append(el(doc, 'td', 'govuk-table__cell'))
  foot.append(teamRow)

  renderRows()
  table.append(head, body, foot)
  wrapper.append(table)
  return wrapper
}

function whoDoesWhat(doc, model) {
  const { work } = model
  const types = work.actionTypes.filter((type) => type.count > 0)
  const counts = new Map(
    work.actionsByPerson.map((entry) => [
      `${entry.userId ?? ''}|${entry.actionTypeId}`,
      entry.count
    ])
  )
  const people = work.people.filter((person) =>
    types.some((type) => counts.get(`${person.userId ?? ''}|${type.id}`))
  )
  const container = el(doc, 'div', 'app-chart app-chart--wide')
  container.append(el(doc, 'h3', 'govuk-heading-s', 'Who does what'))
  if (types.length === 0 || people.length === 0) {
    container.append(
      el(doc, 'p', 'govuk-body', 'Nothing was recorded in this period.')
    )
    return container
  }

  const largest = Math.max(...counts.values())
  container.append(
    el(
      doc,
      'p',
      'govuk-body-s app-chart__summary',
      'Each person against each action type. Darker cells hold more actions.'
    )
  )
  const wrapper = el(doc, 'div', 'app-dashboard__table-wrapper')
  const table = el(doc, 'table', 'govuk-table app-table--compact app-heatmap')
  table.append(
    el(
      doc,
      'caption',
      'govuk-table__caption govuk-visually-hidden',
      'Actions by person and action type'
    )
  )
  const head = el(doc, 'thead', 'govuk-table__head')
  const headRow = el(doc, 'tr', 'govuk-table__row')
  const corner = el(doc, 'th', 'govuk-table__header', 'Person')
  corner.scope = 'col'
  headRow.append(corner)
  for (const type of types) {
    const th = el(
      doc,
      'th',
      'govuk-table__header govuk-table__header--numeric',
      listEntryName(type, 'Other')
    )
    th.scope = 'col'
    headRow.append(th)
  }
  head.append(headRow)
  const body = el(doc, 'tbody', 'govuk-table__body')
  for (const person of people) {
    const row = el(doc, 'tr', 'govuk-table__row')
    const name = el(doc, 'th', 'govuk-table__header', person.name)
    name.scope = 'row'
    row.append(name)
    for (const type of types) {
      const value = counts.get(`${person.userId ?? ''}|${type.id}`) ?? 0
      const level =
        value === 0 ? 0 : Math.min(4, Math.ceil((value / largest) * 4))
      row.append(
        el(
          doc,
          'td',
          `govuk-table__cell govuk-table__cell--numeric app-heat app-heat--${level}`,
          formatNumber(value)
        )
      )
    }
    body.append(row)
  }
  table.append(head, body)
  wrapper.append(table)
  container.append(wrapper)
  return container
}

function people(doc, model, panel, actions) {
  const { work, today } = model
  const nodes = [
    el(
      doc,
      'p',
      'govuk-body',
      `${describePeriod(work.period, today, { compared: false })} Select a person to see the dashboard for their work alone.`
    )
  ]
  if (model.filters.userId) {
    nodes.push(personNotice(doc, work, actions))
  }
  nodes.push(peopleTable(doc, model, actions))

  const labels = timeLabels(work.buckets, work.period.interval)
  const withOutcomes = work.people.filter(
    (person) => sumOf(person.outcomes) > 0
  )
  const yMax = Math.max(1, ...withOutcomes.flatMap((person) => person.outcomes))
  nodes.push(
    panel.add({
      id: 'outcomes-by-person',
      time: true,
      wide: true,
      title: `Outcomes ${eachInterval(work.period.interval)}, by person`,
      summary: withOutcomes.length
        ? 'Resolved and Can\u2019t resolve together. Every row has the same scale, so the heights compare.'
        : 'Nothing was recorded in this period.',
      empty:
        withOutcomes.length === 0
          ? 'Nothing was recorded in this period.'
          : undefined,
      draw: (plot, options) =>
        drawMultiples(doc, plot, {
          ...options,
          labels,
          yMax,
          rows: withOutcomes,
          buckets: work.buckets
        }),
      table: {
        columns: ['Point', ...withOutcomes.map((person) => person.name)],
        rows: work.buckets.map((bucket, index) => [
          describeBucket(bucket),
          ...withOutcomes.map((person) => person.outcomes[index])
        ])
      }
    }),
    whoDoesWhat(doc, model)
  )
  nodes.push(
    el(
      doc,
      'p',
      'govuk-body-s app-secondary-text',
      'The Team row counts each holding once, so it can be less than the rows added up. A holding closed is credited to whoever made the change that closed it. Each open holdings figure links to the Issues list, filtered to that person\u2019s open issues.'
    )
  )
  return nodes
}

function actionsTab(doc, model, panel) {
  const { work, today } = model
  const nodes = [
    el(
      doc,
      'p',
      'govuk-body',
      describePeriod(work.period, today, { compared: false, byInterval: true })
    )
  ]
  const types = [...work.actionTypes].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'en-GB')
  )
  const charts = section(doc)
  const typeSeries = [
    {
      key: 'count',
      label: 'Actions',
      style: { colour: '#1d70b8', pattern: 'solid' },
      values: types.map((type) => type.count)
    }
  ]
  charts.append(
    panel.add({
      id: 'actions-by-type',
      title: 'Actions by type',
      summary: types.some((type) => type.count)
        ? `${types
            .filter((type) => type.count)
            .map(
              (type) =>
                `${listEntryName(type, 'Other')} ${formatNumber(type.count)}`
            )
            .join('. ')}.`
        : 'Nothing was recorded in this period.',
      empty: types.length === 0 ? 'There are no action types yet.' : undefined,
      draw: (plot, options) =>
        drawBars(plot, {
          ...options,
          categories: types.map((type) => ({
            key: type.id,
            label: listEntryName(type, 'Other')
          })),
          series: typeSeries
        }),
      table: {
        columns: ['Action type', 'Actions'],
        rows: types.map((type) => [listEntryName(type, 'Other'), type.count])
      }
    })
  )

  const labels = timeLabels(work.buckets, work.period.interval)
  const overTime = work.actionsOverTime.map((entry, index) => ({
    key: entry.id ?? 'other',
    label: entry.id === null ? 'Other' : entry.name,
    style: categoryStyle(index, entry.id === null),
    values: entry.points
  }))
  charts.append(
    panel.add({
      id: 'actions-over-time',
      time: true,
      title: `Actions ${eachInterval(work.period.interval)}, by type`,
      summary: overTime.length
        ? `${plural(sumOf(overTime.flatMap((entry) => entry.values)), 'action')} in the period. The most used types have their own colour, and the rest are Other.`
        : 'Nothing was recorded in this period.',
      legend: legendOf(overTime),
      draw: (plot, options) =>
        drawColumns(plot, {
          ...options,
          labels,
          series: overTime,
          markers: markersFor(work.buckets, work.markers)
        }),
      table: {
        columns: ['Point', ...overTime.map((entry) => entry.label)],
        rows: work.buckets.map((bucket, index) => [
          describeBucket(bucket),
          ...overTime.map((entry) => entry.values[index])
        ])
      }
    })
  )

  const bands = work.actionsPerHoldingClosed
  const closed = sumOf(bands.map((band) => band.count))
  charts.append(
    panel.add({
      id: 'actions-per-holding-closed',
      wide: true,
      title: 'Actions recorded on each holding closed in the period',
      summary: closed
        ? `Of ${plural(closed, 'holding')} closed: ${bands.map((band) => `${(actionBands[band.band] ?? band.band).toLowerCase()} ${formatNumber(band.count)}`).join(', ')}.${work.medianActionsPerHoldingClosed === null ? '' : ` Median ${formatNumber(work.medianActionsPerHoldingClosed)}.`} Counted from when each last became open.`
        : 'No holdings were closed in this period.',
      draw: (plot, options) =>
        drawColumns(plot, {
          ...options,
          height: 200,
          wrapLabels: true,
          labels: bands.map((band) => actionBands[band.band] ?? band.band),
          series: [
            {
              key: 'count',
              label: 'Holdings closed',
              style: { colour: '#505a5f', pattern: 'solid' },
              values: bands.map((band) => band.count)
            }
          ]
        }),
      table: {
        columns: ['Actions recorded', 'Holdings closed'],
        rows: bands.map((band) => [
          actionBands[band.band] ?? band.band,
          band.count
        ])
      }
    })
  )
  nodes.push(charts)
  nodes.push(
    el(
      doc,
      'p',
      'govuk-body-s app-secondary-text',
      'Actions belong to holdings, not rules, so the Rule filter does not apply on this tab. Every active action type is shown, even with no actions. A type no longer offered is shown only if it was used in the period.'
    )
  )
  return nodes
}

function outcomesTab(doc, model, panel, actions) {
  const { work, rules, today } = model
  const nodes = [
    el(
      doc,
      'p',
      'govuk-body',
      describePeriod(work.period, today, { compared: false })
    )
  ]
  const charts = section(doc)

  const resolved = work.resolvedByReason
  const resolvedSeries = [
    {
      key: 'noLongerFound',
      label: 'No longer found by the rules',
      style: { colour: '#00703c', pattern: 'solid' },
      values: resolved.map((reason) => reason.noLongerFound)
    },
    {
      key: 'stillFound',
      label: 'Still found',
      style: { colour: '#00703c', pattern: 'hatch' },
      values: resolved.map((reason) => reason.count - reason.noLongerFound)
    }
  ]
  charts.append(
    panel.add({
      id: 'resolved-by-reason',
      title: 'Resolved, by reason',
      summary: sumOf(resolved.map((reason) => reason.count))
        ? `${resolved
            .filter((reason) => reason.count)
            .map(
              (reason) =>
                `${listEntryName(reason, 'No reason given')} ${formatNumber(reason.count)}, ${formatPercent(reason.noLongerFound / reason.count)} no longer found`
            )
            .join('. ')}.`
        : 'Nothing was resolved in this period.',
      legend: legendOf(resolvedSeries),
      draw: (plot, options) =>
        drawBars(plot, {
          ...options,
          categories: resolved.map((reason) => ({
            key: reason.id ?? 'none',
            label: listEntryName(reason, 'No reason given')
          })),
          series: resolvedSeries
        }),
      table: {
        columns: [
          'Reason',
          'Resolved',
          'No longer found by the rules',
          'Still found'
        ],
        rows: resolved.map((reason) => [
          listEntryName(reason, 'No reason given'),
          reason.count,
          reason.noLongerFound,
          reason.count - reason.noLongerFound
        ])
      }
    })
  )

  const cantResolve = [...work.cantResolveByReason].sort(
    (a, b) => b.count - a.count
  )
  const cantTotal = sumOf(cantResolve.map((reason) => reason.count))
  charts.append(
    panel.add({
      id: 'cant-resolve-by-reason',
      title: "Can't resolve, by reason",
      summary: cantTotal
        ? `Largest first, with a dashed line for the running total. ${cantResolve
            .filter((reason) => reason.count)
            .map(
              (reason) =>
                `${listEntryName(reason, 'No reason given')} ${formatNumber(reason.count)}`
            )
            .join('. ')}.`
        : "Nothing was marked Can't resolve in this period.",
      draw: (plot, options) =>
        drawBars(plot, {
          ...options,
          pareto: cantTotal > 0,
          categories: cantResolve.map((reason) => ({
            key: reason.id ?? 'none',
            label: listEntryName(reason, 'No reason given')
          })),
          series: [
            {
              key: 'count',
              label: "Can't resolve",
              style: statusStyle('nonactionable'),
              values: cantResolve.map((reason) => reason.count)
            }
          ]
        }),
      table: {
        columns: ['Reason', "Can't resolve", 'Running total'],
        rows: cantResolve.map((reason, index) => [
          listEntryName(reason, 'No reason given'),
          reason.count,
          cantTotal
            ? formatPercent(
                sumOf(
                  cantResolve.slice(0, index + 1).map((entry) => entry.count)
                ) / cantTotal
              )
            : '0%'
        ])
      }
    })
  )

  const transitions = work.transitions.filter((link) => link.count > 0)
  const busiest = [...transitions].sort((a, b) => b.count - a.count)[0]
  charts.append(
    panel.add({
      id: 'how-issues-moved',
      title: 'How issues moved',
      summary: busiest
        ? `${plural(sumOf(transitions.map((link) => link.count)), 'change')} made in Cleanse. The most common was ${statusStyle(busiest.from).label} to ${statusStyle(busiest.to).label}, ${formatNumber(busiest.count)}.`
        : 'No statuses were changed in Cleanse in this period.',
      empty:
        transitions.length === 0
          ? 'Nothing was recorded in this period.'
          : undefined,
      draw: (plot, options) =>
        drawFlow(plot, {
          ...options,
          links: transitions,
          styleOf: statusStyle
        }),
      table: {
        columns: ['From', 'To', 'Changes'],
        rows: transitions.map((link) => [
          statusStyle(link.from).label,
          statusStyle(link.to).label,
          link.count
        ])
      }
    })
  )

  const time = work.timeToOutcome
  const timeSeries = [
    {
      key: 'resolved',
      label: 'Resolved',
      style: statusStyle('resolved'),
      values: time.bands.map((band) => band.resolved)
    },
    {
      key: 'cantResolve',
      label: "Can't resolve",
      style: statusStyle('nonactionable'),
      values: time.bands.map((band) => band.cantResolve)
    }
  ]
  charts.append(
    panel.add({
      id: 'time-to-outcome',
      title: 'Time to an outcome',
      summary:
        time.medianDays === null
          ? 'Nothing was resolved or marked Can\u2019t resolve in this period.'
          : `Days from when the rules first raised an issue to its outcome. Half took ${plural(time.medianDays, 'day')} or less, and 85% took ${plural(time.percentile85Days, 'day')} or less.`,
      legend: legendOf(timeSeries),
      draw: (plot, options) =>
        drawColumns(plot, {
          ...options,
          height: 210,
          wrapLabels: true,
          labels: time.bands.map((band) => ageBands[band.band] ?? band.band),
          series: timeSeries
        }),
      table: {
        columns: ['Time to the outcome', 'Resolved', "Can't resolve"],
        rows: time.bands.map((band) => [
          ageBands[band.band] ?? band.band,
          band.resolved,
          band.cantResolve
        ])
      }
    })
  )

  const byRule = work.outcomesByRule
  const ruleSeries = [
    {
      key: 'resolved',
      label: 'Resolved',
      style: statusStyle('resolved'),
      values: byRule.map((rule) => rule.resolved)
    },
    {
      key: 'cantResolve',
      label: "Can't resolve",
      style: statusStyle('nonactionable'),
      values: byRule.map((rule) => rule.cantResolve)
    }
  ]
  charts.append(
    panel.add({
      id: 'outcomes-by-rule',
      wide: true,
      title: 'Outcomes by rule',
      summary: byRule.length
        ? 'Resolved and Can\u2019t resolve for each rule. Select a rule to see the dashboard for it alone.'
        : 'Nothing was recorded in this period.',
      empty:
        byRule.length === 0
          ? 'Nothing was recorded in this period.'
          : undefined,
      legend: legendOf(ruleSeries),
      draw: (plot, options) =>
        drawBars(plot, {
          ...options,
          categories: byRule.map((rule) => ({
            key: rule.ruleId,
            label: ruleName(rules, rule.ruleId)
          })),
          series: ruleSeries,
          onSelect: (index) =>
            actions.setFilters({ ruleId: byRule[index].ruleId, unit: 'issues' })
        }),
      table: {
        columns: ['Rule', 'Resolved', "Can't resolve"],
        rows: byRule.map((rule) => [
          ruleName(rules, rule.ruleId),
          rule.resolved,
          rule.cantResolve
        ])
      }
    })
  )

  nodes.push(charts)
  return nodes
}

function holdingRows(doc, holdings, { caption }) {
  const table = el(doc, 'table', 'govuk-table app-table--compact')
  table.append(
    el(doc, 'caption', 'govuk-table__caption govuk-table__caption--s', caption)
  )
  const head = el(doc, 'thead', 'govuk-table__head')
  const headRow = el(doc, 'tr', 'govuk-table__row')
  for (const label of [
    'CPH',
    'Status',
    'Open issues',
    'First raised',
    'Assigned to',
    'Last worked on'
  ]) {
    const th = el(
      doc,
      'th',
      `govuk-table__header${label === 'Open issues' ? ' govuk-table__header--numeric' : ''}`,
      label
    )
    th.scope = 'col'
    headRow.append(th)
  }
  head.append(headRow)
  const body = el(doc, 'tbody', 'govuk-table__body')
  for (const holding of holdings) {
    const row = el(doc, 'tr', 'govuk-table__row')
    const cph = el(doc, 'th', 'govuk-table__header')
    cph.scope = 'row'
    const link = el(doc, 'a', 'govuk-link', holding.cph)
    link.href = `/holdings/${holding.cph.split('/').map(encodeURIComponent).join('/')}`
    cph.append(link)
    row.append(
      cph,
      el(doc, 'td', 'govuk-table__cell', statusStyle(holding.status).label),
      el(
        doc,
        'td',
        'govuk-table__cell govuk-table__cell--numeric',
        formatNumber(holding.openIssues)
      ),
      el(
        doc,
        'td',
        'govuk-table__cell',
        formatInstantDay(holding.firstRaisedAtUtc)
      ),
      el(doc, 'td', 'govuk-table__cell', holding.assignedTo ?? 'Unassigned'),
      el(
        doc,
        'td',
        'govuk-table__cell',
        holding.lastWorkedAtUtc
          ? formatInstantDay(holding.lastWorkedAtUtc)
          : 'Never'
      )
    )
    body.append(row)
  }
  table.append(head, body)
  return table
}

function backlogTab(doc, model, panel, actions) {
  const { backlog, filters, rules, today } = model
  const unitWord = backlog.unit === 'holdings' ? 'holdings' : 'issues'
  const nodes = [
    el(
      doc,
      'p',
      'govuk-body',
      `${describePeriod(backlog.period, today, { compared: false, byInterval: true })} All of the group\u2019s ${unitWord}, whoever changed them. The Person filter does not apply to this tab.`
    )
  ]
  const labels = timeLabels(backlog.buckets, backlog.period.interval)
  const markers = markersFor(backlog.buckets, backlog.markers)
  const zoom = (from, to) =>
    actions.setFilters({
      period: 'custom',
      from: backlog.buckets[from].start,
      to: backlog.buckets[to].end
    })

  const states = backlog.states
  const byStatus = statusSeries(states, backlog.byStatus)
  const charts = section(doc)
  const statusFigure = panel.add({
    id: 'active-by-status',
    time: true,
    wide: true,
    title:
      backlog.unit === 'holdings'
        ? 'Holdings with active issues, by holding status'
        : 'Active issues, by workflow status',
    summary: `${formatNumber(sumOf(byStatus.map((entry) => entry.values.at(-1))))} at the end. Drag across the chart to zoom in.${backlog.unit === 'issues' ? ' Select a band to list its issues.' : ''} ${markerNote(markers)}`,
    legend: legendOf(byStatus),
    draw: (plot, options) =>
      drawAreas(plot, {
        ...options,
        labels,
        series: byStatus,
        markers,
        onBrush: backlog.buckets.length > 2 ? zoom : undefined,
        onSelect:
          backlog.unit === 'issues'
            ? (state) => actions.openIssues(state)
            : undefined,
        describe: (index) => [
          describeBucket(backlog.buckets[index]),
          ...byStatus
            .filter((entry) => !options.hidden.has(entry.key))
            .map(
              (entry) => `${entry.label} ${formatNumber(entry.values[index])}`
            )
        ]
      }),
    table: {
      columns: ['Point', ...byStatus.map((entry) => entry.label)],
      rows: backlog.byStatus.map((point, index) => [
        describeBucket(backlog.buckets[index]),
        ...byStatus.map((entry) => entry.values[index])
      ])
    }
  })
  if (backlog.unit === 'issues') {
    statusFigure.append(issuesLinks(doc, states, { ruleId: filters.ruleId }))
  }
  charts.append(statusFigure)

  const activity = backlog.activeInactive
  const lineSeries = [
    {
      key: 'active',
      label: backlog.unit === 'holdings' ? 'With an active issue' : 'Active',
      style: { colour: '#1d70b8' },
      values: activity.map((point) => point.active)
    },
    {
      key: 'inactive',
      label: backlog.unit === 'holdings' ? 'With none' : 'Inactive',
      style: { colour: '#505a5f', dashed: true },
      values: activity.map((point) => point.inactive)
    }
  ]
  const changeSeries = [
    {
      key: 'raised',
      label: backlog.unit === 'holdings' ? 'First issue' : 'Raised',
      style: { colour: '#1d70b8', pattern: 'solid' },
      values: activity.map((point) => point.raised)
    },
    {
      key: 'cameBack',
      label: 'Came back',
      style: { colour: '#4c2c92', pattern: 'hatch' },
      values: activity.map((point) => point.cameBack)
    },
    {
      key: 'noLongerFound',
      label: 'No longer found, below the line',
      style: { colour: '#505a5f', pattern: 'dots' },
      values: activity.map((point) => point.noLongerFound),
      below: true
    }
  ]
  const activityTable = {
    columns: [
      'Point',
      lineSeries[0].label,
      lineSeries[1].label,
      changeSeries[0].label,
      'Came back',
      'No longer found'
    ],
    rows: activity.map((point, index) => [
      describeBucket(backlog.buckets[index]),
      point.active,
      point.inactive,
      point.raised,
      point.cameBack,
      point.noLongerFound
    ])
  }
  charts.append(
    panel.add({
      id: 'active-and-inactive',
      time: true,
      title:
        backlog.unit === 'holdings'
          ? 'Holdings with and without active issues'
          : 'Active and inactive issues',
      summary: activity.length
        ? `${formatNumber(activity.at(-1).active)} ${lineSeries[0].label.toLowerCase()} and ${formatNumber(activity.at(-1).inactive)} ${lineSeries[1].label.toLowerCase()} at the end.`
        : 'Nothing was recorded in this period.',
      legend: legendOf(lineSeries).map((entry) => ({ ...entry, line: true })),
      draw: (plot, options) =>
        drawLines(plot, { ...options, labels, series: lineSeries, markers }),
      table: activityTable
    }),
    panel.add({
      id: 'rules-changes',
      time: true,
      title:
        backlog.unit === 'holdings'
          ? 'What the rules changed for holdings'
          : 'What the rules found',
      summary: `${formatNumber(sumOf(changeSeries[0].values))} ${changeSeries[0].label.toLowerCase()}, ${formatNumber(sumOf(changeSeries[1].values))} came back and ${formatNumber(sumOf(changeSeries[2].values))} no longer found.`,
      legend: legendOf(changeSeries),
      draw: (plot, options) =>
        drawColumns(plot, {
          ...options,
          height: 160,
          labels,
          series: changeSeries,
          markers
        }),
      table: activityTable
    }),
    waterfallFigure(model, panel)
  )

  const age = backlog.age
  const ageSeries = [
    {
      key: 'todo',
      label: 'To do',
      style: statusStyle('todo'),
      values: age.map((band) => band.todo)
    },
    {
      key: 'inProgress',
      label: 'In progress',
      style: statusStyle('in-progress'),
      values: age.map((band) => band.inProgress)
    }
  ]
  const tooNew = sumOf(age.map((band) => band.tooNewToList))
  charts.append(
    panel.add({
      id: 'age-of-open',
      title: `Age of open ${unitWord}`,
      summary: `${backlog.unit === 'holdings' ? 'By the first raised date of each holding\u2019s oldest open issue.' : 'By when the rules first raised each issue.'} ${backlog.minimumIssueAgeDays > 0 ? `${formatNumber(tooNew)} too new to list (under ${plural(backlog.minimumIssueAgeDays, 'day')}).` : 'Every open issue is old enough to list.'}`,
      legend: legendOf(ageSeries),
      draw: (plot, options) =>
        drawColumns(plot, {
          ...options,
          height: 210,
          wrapLabels: true,
          labels: age.map((band) => ageBands[band.band] ?? band.band),
          series: ageSeries
        }),
      table: {
        columns: ['Age', 'To do', 'In progress', 'Too new to list'],
        rows: age.map((band) => [
          ageBands[band.band] ?? band.band,
          band.todo,
          band.inProgress,
          band.tooNewToList
        ])
      }
    })
  )

  if (backlog.unit === 'issues') {
    const ruleSeries = [
      {
        key: 'todo',
        label: 'To do',
        style: statusStyle('todo'),
        values: backlog.byRule.map((rule) => rule.todo)
      },
      {
        key: 'inProgress',
        label: 'In progress',
        style: statusStyle('in-progress'),
        values: backlog.byRule.map((rule) => rule.inProgress)
      }
    ]
    charts.append(
      panel.add({
        id: 'open-by-rule',
        title: 'Open issues by rule',
        summary: backlog.byRule.length
          ? 'Select a rule to see the dashboard for it alone.'
          : 'No issues are open.',
        empty: backlog.byRule.length === 0 ? 'No issues are open.' : undefined,
        legend: legendOf(ruleSeries),
        draw: (plot, options) =>
          drawBars(plot, {
            ...options,
            categories: backlog.byRule.map((rule) => ({
              key: rule.ruleId,
              label: ruleName(rules, rule.ruleId)
            })),
            series: ruleSeries,
            onSelect: (index) =>
              actions.setFilters({
                ruleId: backlog.byRule[index].ruleId,
                unit: 'issues'
              })
          }),
        table: {
          columns: ['Rule', 'To do', 'In progress'],
          rows: backlog.byRule.map((rule) => [
            ruleName(rules, rule.ruleId),
            rule.todo,
            rule.inProgress
          ])
        }
      })
    )
  } else {
    const note = el(doc, 'div', 'app-chart')
    note.append(
      el(doc, 'h3', 'govuk-heading-s', 'Open issues by rule'),
      el(
        doc,
        'p',
        'govuk-body-s',
        'Shown for issues only: a holding can have issues for several rules.'
      )
    )
    charts.append(note)
  }
  nodes.push(charts)

  const lists = el(doc, 'div', 'app-dashboard__lists')
  lists.append(
    backlog.oldestOpenHoldings.length
      ? holdingRows(doc, backlog.oldestOpenHoldings, {
          caption: 'Oldest open holdings'
        })
      : el(doc, 'p', 'govuk-body', 'No holdings are open.')
  )
  const unassigned = el(doc, 'p', 'govuk-body')
  unassigned.textContent = `${plural(backlog.unassignedOpenHoldings, 'open holding')} ${backlog.unassignedOpenHoldings === 1 ? 'is' : 'are'} unassigned. `
  if (backlog.unassignedOpenHoldings > 0) {
    const link = el(doc, 'a', 'govuk-link', 'List their issues')
    link.href = issuesUrl(openStates, { userId: 'unassigned' })
    unassigned.append(link)
  }
  lists.append(unassigned)

  const stalled = backlog.stalled
  if (stalled.count > 0) {
    const warning = el(doc, 'div', 'govuk-warning-text')
    const icon = el(doc, 'span', 'govuk-warning-text__icon', '!')
    icon.setAttribute('aria-hidden', 'true')
    const words = el(doc, 'strong', 'govuk-warning-text__text')
    words.append(
      el(doc, 'span', 'govuk-visually-hidden', 'Warning'),
      doc.createTextNode(
        `${plural(stalled.count, 'holding')} ${stalled.count === 1 ? 'is' : 'are'} In progress with nothing recorded against ${stalled.count === 1 ? 'it' : 'them'} in Cleanse for ${plural(stalled.days, 'day')} or more.`
      )
    )
    warning.append(icon, words)
    lists.append(
      warning,
      holdingRows(doc, stalled.holdings, {
        caption: `Stalled holdings${stalled.count > stalled.holdings.length ? `, the ${stalled.holdings.length} longest untouched` : ''}`
      })
    )
  } else {
    lists.append(
      el(
        doc,
        'p',
        'govuk-body',
        `No holdings have been In progress without anything recorded for ${plural(stalled.days, 'day')} or more.`
      )
    )
  }
  nodes.push(lists)
  return nodes
}

/** Each tab's contents, for the figures in `model`. */
export const tabBuilders = {
  overview,
  people,
  actions: (doc, model, panel) => actionsTab(doc, model, panel),
  outcomes: outcomesTab,
  backlog: backlogTab
}
