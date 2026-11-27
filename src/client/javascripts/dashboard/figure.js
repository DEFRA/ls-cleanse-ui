import { download, toCsv } from './csv.js'

let figureCount = 0

const element = (doc, tag, className, text) => {
  const node = doc.createElement(tag)
  if (className) {
    node.className = className
  }
  if (text !== undefined) {
    node.textContent = text
  }
  return node
}

/** Whether the browser asks for less motion, in which case nothing animates. */
export function prefersLessMotion(win = globalThis) {
  return Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

function buildTable(doc, { caption, columns, rows }) {
  const table = element(
    doc,
    'table',
    'govuk-table app-table--compact app-chart__table'
  )
  const captionNode = element(
    doc,
    'caption',
    'govuk-table__caption govuk-visually-hidden',
    caption
  )
  const head = element(doc, 'thead', 'govuk-table__head')
  const headRow = element(doc, 'tr', 'govuk-table__row')
  const numeric = columns.map(
    (_, index) =>
      rows.length > 0 && rows.every((row) => typeof row[index] === 'number')
  )

  columns.forEach((column, index) => {
    const cell = element(
      doc,
      'th',
      `govuk-table__header${numeric[index] ? ' govuk-table__header--numeric' : ''}`,
      column
    )
    cell.scope = 'col'
    headRow.append(cell)
  })
  head.append(headRow)

  const body = element(doc, 'tbody', 'govuk-table__body')
  for (const row of rows) {
    const tr = element(doc, 'tr', 'govuk-table__row')
    row.forEach((value, index) => {
      const cell =
        index === 0
          ? element(doc, 'th', 'govuk-table__header')
          : element(
              doc,
              'td',
              `govuk-table__cell${numeric[index] ? ' govuk-table__cell--numeric' : ''}`
            )
      if (index === 0) {
        cell.scope = 'row'
      }
      cell.textContent =
        typeof value === 'number'
          ? value.toLocaleString('en-GB')
          : String(value ?? '')
      tr.append(cell)
    })
    body.append(tr)
  }

  table.append(captionNode, head, body)
  return table
}

/**
 * One chart: its heading and summary, a legend whose entries switch series off and on, the plot,
 * the figures for the point in focus, and the figures as a table and as a CSV file. The plot is
 * reached with Tab; the arrow keys move from point to point, Enter selects one where that goes
 * somewhere, and Escape hides the figures. A screen reader hears each point's figures.
 *
 * `spec.draw(plot, context)` draws into the plot and returns `{ points, describe, select,
 * highlight }`, where describe(i) gives the lines of figures for point i.
 */
export function createFigure(doc, spec, { onCrosshair, filtersForFile } = {}) {
  figureCount += 1
  const id = `chart-${spec.id}-${figureCount}`
  const hidden = new Set(spec.hiddenByDefault ?? [])

  const figure = element(
    doc,
    'figure',
    `app-chart${spec.wide ? ' app-chart--wide' : ''}`
  )
  figure.dataset.chart = spec.id
  const caption = element(doc, 'figcaption', 'app-chart__caption')
  const title = element(
    doc,
    'h3',
    'govuk-heading-s app-chart__title',
    spec.title
  )
  title.id = `${id}-title`
  const summary = element(
    doc,
    'p',
    'govuk-body-s app-chart__summary',
    spec.summary
  )
  caption.append(title, summary)
  figure.append(caption)

  const legend = element(doc, 'div', 'app-chart__legend')
  const plot = element(doc, 'div', 'app-chart__plot')
  const readout = element(doc, 'div', 'app-chart__readout')
  readout.setAttribute('aria-hidden', 'true')
  readout.hidden = true
  const live = element(doc, 'div', 'govuk-visually-hidden')
  live.setAttribute('aria-live', 'polite')
  live.setAttribute('role', 'status')

  const actions = element(doc, 'div', 'app-chart__actions')
  const tableToggle = element(
    doc,
    'button',
    'app-link-button govuk-link',
    'Show the figures as a table'
  )
  tableToggle.type = 'button'
  tableToggle.setAttribute('aria-expanded', 'false')
  tableToggle.setAttribute('aria-controls', `${id}-table`)
  const csvButton = element(
    doc,
    'button',
    'app-link-button govuk-link',
    'Download CSV'
  )
  csvButton.type = 'button'
  actions.append(tableToggle, csvButton)

  const tableHolder = element(doc, 'div', 'app-chart__table-holder')
  tableHolder.id = `${id}-table`
  tableHolder.hidden = true

  figure.append(legend, plot, readout, live)
  if (spec.note) {
    figure.append(
      element(
        doc,
        'p',
        'govuk-body-s app-secondary-text app-chart__note',
        spec.note
      )
    )
  }
  figure.append(actions, tableHolder)

  let drawn = null
  let drawnWidth = 0
  const widthNow = () =>
    Math.max(240, Math.round(plot.clientWidth || spec.defaultWidth || 640))
  let focusIndex = -1
  let current = spec

  function renderLegend() {
    legend.replaceChildren()
    const entries = current.legend ?? []
    legend.hidden = entries.length === 0
    for (const entry of entries) {
      const button = element(doc, 'button', 'app-chart__legend-item')
      button.type = 'button'
      button.setAttribute('aria-pressed', String(!hidden.has(entry.key)))
      const swatch = element(
        doc,
        'span',
        `app-chart__swatch app-chart__swatch--${entry.pattern ?? 'solid'}${entry.line ? ' app-chart__swatch--line' : ''}`
      )
      swatch.setAttribute('aria-hidden', 'true')
      swatch.style.setProperty('--swatch-colour', entry.colour)
      const label = element(doc, 'span', null, entry.label)
      button.append(swatch, label)
      button.addEventListener('click', () => {
        if (hidden.has(entry.key)) {
          hidden.delete(entry.key)
        } else {
          hidden.add(entry.key)
        }
        renderLegend()
        draw()
      })
      legend.append(button)
    }
  }

  function showPoint(index, { announce = true, fromCrosshair = false } = {}) {
    if (!drawn || drawn.points === 0) {
      return
    }

    focusIndex = Math.max(0, Math.min(drawn.points - 1, index))
    const lines = drawn.describe(focusIndex)
    readout.replaceChildren(
      ...lines.map((line, at) =>
        element(
          doc,
          at === 0 ? 'strong' : 'span',
          'app-chart__readout-line',
          line
        )
      )
    )
    readout.hidden = false
    drawn.highlight?.(focusIndex)
    if (announce) {
      live.textContent = lines.join('. ')
    }
    if (!fromCrosshair && current.time) {
      onCrosshair?.(focusIndex, figure)
    }
  }

  function hidePoint({ fromCrosshair = false } = {}) {
    readout.hidden = true
    drawn?.highlight?.(-1)
    focusIndex = -1
    if (!fromCrosshair && current.time) {
      onCrosshair?.(-1, figure)
    }
  }

  function draw() {
    plot.replaceChildren()
    if (current.empty) {
      plot.append(
        element(doc, 'p', 'govuk-body app-chart__empty', current.empty)
      )
      plot.removeAttribute('tabindex')
      drawn = { points: 0, describe: () => [] }
      return
    }

    const width = widthNow()
    drawnWidth = width
    drawn = current.draw(plot, {
      hidden,
      width,
      motion: !prefersLessMotion(doc.defaultView ?? globalThis),
      onPoint: (index) => showPoint(index, { announce: false }),
      onLeave: () => hidePoint()
    }) ?? { points: 0, describe: () => [] }

    if (focusIndex >= 0 && focusIndex < drawn.points) {
      drawn.highlight?.(focusIndex)
    }

    plot.tabIndex = drawn.points > 0 ? 0 : -1
    plot.setAttribute('role', 'group')
    plot.setAttribute(
      'aria-label',
      `${current.title}. ${drawn.points > 1 ? 'Use the arrow keys to move between points.' : ''}${drawn.select ? ' Press Enter to open the one in focus.' : ''}`
    )
  }

  plot.addEventListener('keydown', (event) => {
    if (!drawn || drawn.points === 0) {
      return
    }
    const keys = {
      ArrowRight: focusIndex + 1,
      ArrowDown: focusIndex + 1,
      ArrowLeft: focusIndex - 1,
      ArrowUp: focusIndex - 1,
      Home: 0,
      End: drawn.points - 1
    }
    if (event.key in keys) {
      event.preventDefault()
      showPoint(
        focusIndex < 0 && event.key.startsWith('Arrow') ? 0 : keys[event.key]
      )
    } else if (event.key === 'Escape') {
      hidePoint()
    } else if (event.key === 'Enter' && focusIndex >= 0 && drawn.select) {
      event.preventDefault()
      drawn.select(focusIndex)
    }
  })
  plot.addEventListener('focus', () => showPoint(Math.max(focusIndex, 0)))
  plot.addEventListener('blur', () => hidePoint())

  tableToggle.addEventListener('click', () => {
    const open = tableHolder.hidden
    tableHolder.hidden = !open
    tableToggle.setAttribute('aria-expanded', String(open))
    tableToggle.textContent = open
      ? 'Hide the table'
      : 'Show the figures as a table'
  })

  csvButton.addEventListener('click', () => {
    const { columns, rows } = current.table
    download(
      toCsv(columns, rows),
      filtersForFile?.(current.id) ?? `cleanse-${current.id}.csv`,
      doc
    )
  })

  function update(next) {
    current = { ...current, ...next }
    title.textContent = current.title
    summary.textContent = current.summary
    tableHolder.replaceChildren(
      buildTable(doc, { caption: current.title, ...current.table })
    )
    renderLegend()
    draw()
    readout.hidden = true
    focusIndex = -1
  }

  update(spec)

  return {
    element: figure,
    update,
    // A window that only changed height, as printing or a mobile address bar does, needs no redraw.
    redraw: () => {
      if (widthNow() !== drawnWidth) {
        draw()
      }
    },
    isTime: () => Boolean(current.time),
    crosshair: (index) =>
      index < 0
        ? hidePoint({ fromCrosshair: true })
        : showPoint(index, { announce: false, fromCrosshair: true })
  }
}
