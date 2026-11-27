import { max, sum } from 'd3-array'
import { axisBottom, axisLeft, axisTop } from 'd3-axis'
import { brushX } from 'd3-brush'
import { format } from 'd3-format'
import { scaleBand, scaleLinear, scalePoint } from 'd3-scale'
import { select } from 'd3-selection'
import { area, line, stack } from 'd3-shape'
import 'd3-transition'

/**
 * The dashboard's charts, drawn as SVG with D3. Everything is set as an SVG attribute or as text,
 * never as a style attribute or as HTML, so the content security policy holds and no name can
 * become markup. Each function draws into `plot` and returns what the figure around it needs:
 * how many points there are, the figures for one, and how to highlight one.
 */

const margin = { top: 14, right: 16, bottom: 34, left: 52 }
const whole = format(',d')
const percent = format('.0%')
const duration = (motion) => (motion ? 350 : 0)

let uid = 0

function frame(plot, width, height) {
  return select(plot)
    .append('svg')
    .attr('class', 'app-chart__svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('aria-hidden', 'true')
    .attr('focusable', 'false')
}

/** Solid colours, or a pattern on the colour, so series differ by more than colour alone. */
function definePatterns(svg, styles) {
  uid += 1
  const defs = svg.append('defs')
  const fills = new Map()

  for (const [key, style] of styles) {
    if (!style.pattern || style.pattern === 'solid') {
      fills.set(key, style.colour)
      continue
    }

    const id = `app-pattern-${uid}-${String(key).replace(/[^a-zA-Z0-9_-]/g, '-')}`
    const pattern = defs
      .append('pattern')
      .attr('id', id)
      .attr('patternUnits', 'userSpaceOnUse')
      .attr('width', 6)
      .attr('height', 6)
    pattern
      .append('rect')
      .attr('width', 6)
      .attr('height', 6)
      .attr('fill', style.colour)

    if (style.pattern === 'hatch') {
      pattern
        .append('path')
        .attr('d', 'M-1,1 l2,-2 M0,6 l6,-6 M5,7 l2,-2')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 1.3)
    } else if (style.pattern === 'cross') {
      pattern
        .append('path')
        .attr('d', 'M0,0 L6,6 M6,0 L0,6')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 1)
    } else if (style.pattern === 'dots') {
      pattern
        .append('circle')
        .attr('cx', 3)
        .attr('cy', 3)
        .attr('r', 1.3)
        .attr('fill', '#ffffff')
    }

    fills.set(key, `url(#${id})`)
  }

  return (key) => fills.get(key) ?? '#505a5f'
}

/** Every n-th label, so the axis is readable however many points there are. */
function thinned(count, room, spacing = 72) {
  const step = Math.max(
    1,
    Math.ceil(count / Math.max(1, Math.floor(room / spacing)))
  )
  return Array.from({ length: count }, (_, index) => index).filter(
    (index) => index % step === 0
  )
}

function leftAxis(svg, y, width, m) {
  svg
    .append('g')
    .attr('class', 'app-chart__grid')
    .attr('transform', `translate(${m.left},0)`)
    .call(
      axisLeft(y)
        .ticks(4)
        .tickSize(-(width - m.left - m.right))
        .tickFormat((value) => (Number.isInteger(value) ? whole(value) : ''))
    )
    .call((axis) => axis.select('.domain').remove())
}

function bottomAxis(svg, x, labels, height, m, width) {
  const ticks = thinned(labels.length, width - m.left - m.right)
  svg
    .append('g')
    .attr('class', 'app-chart__axis')
    .attr('transform', `translate(0,${height - m.bottom})`)
    .call(
      axisBottom(x)
        .tickValues(ticks)
        .tickFormat((index) => labels[index])
        .tickSizeOuter(0)
    )
}

/** Dashed lines for SPOL imports, and a dotted one where the history starts. */
function drawMarkers(svg, markers, position, top, bottom) {
  const group = svg.append('g').attr('class', 'app-chart__markers')
  for (const marker of markers) {
    group
      .append('line')
      .attr('class', `app-chart__marker app-chart__marker--${marker.kind}`)
      .attr('x1', position(marker.index))
      .attr('x2', position(marker.index))
      .attr('y1', top)
      .attr('y2', bottom)
      .attr('stroke', marker.kind === 'history-start' ? '#0b0c0c' : '#505a5f')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', marker.kind === 'history-start' ? '1 3' : '5 3')
  }
}

const defaultDescribe = (labels, series) => (index) => [
  labels[index],
  ...series.map((entry) => `${entry.label} ${whole(entry.values[index] ?? 0)}`)
]

/**
 * Columns, stacked, at each point or category. A series marked `below` stacks downwards from
 * zero, as reopened does under the outcomes. `yMax` fixes the scale, so small multiples compare.
 */
export function drawColumns(plot, options) {
  const {
    labels,
    series,
    width,
    hidden = new Set(),
    motion,
    onPoint,
    onLeave,
    onSelect,
    markers = [],
    yMax,
    compact = false,
    wrapLabels = false,
    height = compact ? 44 : 230,
    describe
  } = options
  const visible = series.filter((entry) => !hidden.has(entry.key))
  const m = compact
    ? { top: 2, right: 2, bottom: 2, left: 2 }
    : wrapLabels
      ? { ...margin, bottom: 52 }
      : margin
  const svg = frame(plot, width, height)
  const fill = definePatterns(
    svg,
    series.map((entry) => [entry.key, entry.style])
  )

  const x = scaleBand()
    .domain(labels.map((_, index) => index))
    .range([m.left, width - m.right])
    .paddingInner(compact ? 0.15 : 0.22)
    .paddingOuter(0.1)

  const totalAbove = labels.map((_, index) =>
    sum(
      visible.filter((entry) => !entry.below),
      (entry) => entry.values[index] ?? 0
    )
  )
  const totalBelow = labels.map((_, index) =>
    sum(
      visible.filter((entry) => entry.below),
      (entry) => entry.values[index] ?? 0
    )
  )
  const top = yMax ?? Math.max(1, max(totalAbove) ?? 0)
  const bottom = max(totalBelow) ?? 0
  const y = scaleLinear()
    .domain([-bottom, top])
    .range([height - m.bottom, m.top])
  if (!yMax) {
    y.nice(4)
  }

  if (!compact) {
    leftAxis(svg, y, width, m)
    if (wrapLabels) {
      labels.forEach((label, index) => {
        const text = svg
          .append('text')
          .attr('class', 'app-chart__tick-label')
          .attr('x', x(index) + x.bandwidth() / 2)
          .attr('y', height - m.bottom + 4)
          .attr('text-anchor', 'middle')
        wrapLabel(text, label, x.step())
      })
    } else {
      bottomAxis(svg, x, labels, height, m, width)
    }
  }

  const bars = svg.append('g').attr('class', 'app-chart__bars')
  labels.forEach((_, index) => {
    let up = 0
    let down = 0
    for (const entry of visible) {
      const value = entry.values[index] ?? 0
      if (!value) {
        continue
      }
      const from = entry.below ? -down : up
      const to = entry.below ? -(down + value) : up + value
      if (entry.below) {
        down += value
      } else {
        up += value
      }

      const rect = bars
        .append('rect')
        .attr('x', x(index))
        .attr('width', x.bandwidth())
        .attr('fill', fill(entry.key))
        .attr('stroke', '#ffffff')
        .attr('stroke-width', compact ? 0 : 1)
        .attr('y', y(0))
        .attr('height', 0)
      rect
        .transition()
        .duration(duration(motion))
        .attr('y', Math.min(y(from), y(to)))
        .attr('height', Math.abs(y(from) - y(to)))
    }
  })

  svg
    .append('line')
    .attr('class', 'app-chart__zero')
    .attr('x1', m.left)
    .attr('x2', width - m.right)
    .attr('y1', y(0))
    .attr('y2', y(0))
    .attr('stroke', '#0b0c0c')

  drawMarkers(
    svg,
    markers,
    (index) => x(index) + x.bandwidth() / 2,
    m.top,
    height - m.bottom
  )

  const highlight = svg
    .append('rect')
    .attr('class', 'app-chart__highlight')
    .attr('y', m.top)
    .attr('height', height - m.top - m.bottom)
    .attr('width', x.step())
    .attr('fill', 'none')
    .attr('stroke', '#0b0c0c')
    .attr('stroke-width', 2)
    .attr('visibility', 'hidden')

  const overlay = svg.append('g').attr('class', 'app-chart__overlay')
  labels.forEach((_, index) => {
    overlay
      .append('rect')
      .attr('x', x(index) - (x.step() - x.bandwidth()) / 2)
      .attr('y', m.top)
      .attr('width', x.step())
      .attr('height', height - m.top - m.bottom)
      .attr('fill', 'transparent')
      .attr(
        'class',
        onSelect
          ? 'app-chart__hit app-chart__hit--selectable'
          : 'app-chart__hit'
      )
      .on('mouseenter', () => onPoint?.(index))
      .on('click', () => onSelect?.(index))
  })
  svg.on('mouseleave', () => onLeave?.())

  return {
    points: labels.length,
    describe: describe ?? defaultDescribe(labels, visible),
    select: onSelect,
    highlight(index) {
      highlight
        .attr('visibility', index < 0 ? 'hidden' : 'visible')
        .attr('x', index < 0 ? 0 : x(index) - (x.step() - x.bandwidth()) / 2)
    }
  }
}

function nearestIndex(x, count, position) {
  if (count <= 1) {
    return 0
  }
  const [start, end] = x.range()
  const step = (end - start) / (count - 1)
  return Math.max(0, Math.min(count - 1, Math.round((position - start) / step)))
}

function pointer(event, svg) {
  const node = svg.node()
  const box = node.getBoundingClientRect?.()
  const scale = box?.width ? node.viewBox.baseVal.width / box.width : 1
  return (event.clientX - (box?.left ?? 0)) * scale
}

/**
 * Stacked areas over time. With `onBrush`, dragging across the chart picks a stretch of it,
 * which the dashboard turns into a custom period. One point is drawn as a column instead.
 */
export function drawAreas(plot, options) {
  const {
    labels,
    series,
    width,
    hidden = new Set(),
    motion,
    onPoint,
    onLeave,
    onSelect,
    onBrush,
    markers = [],
    height = 250,
    describe
  } = options
  if (labels.length < 2) {
    return drawColumns(plot, options)
  }

  const visible = series.filter((entry) => !hidden.has(entry.key))
  const m = margin
  const svg = frame(plot, width, height)
  const fill = definePatterns(
    svg,
    series.map((entry) => [entry.key, entry.style])
  )
  const x = scalePoint()
    .domain(labels.map((_, index) => index))
    .range([m.left, width - m.right])
  const rows = labels.map((_, index) =>
    Object.fromEntries(
      visible.map((entry) => [entry.key, entry.values[index] ?? 0])
    )
  )
  const stacked = stack().keys(visible.map((entry) => entry.key))(rows)
  const top = Math.max(1, max(rows, (row) => sum(Object.values(row))) ?? 0)
  const y = scaleLinear()
    .domain([0, top])
    .nice(4)
    .range([height - m.bottom, m.top])

  leftAxis(svg, y, width, m)
  bottomAxis(svg, x, labels, height, m, width)

  const flat = area()
    .x((_, index) => x(index))
    .y0(y(0))
    .y1(y(0))
  const shaped = area()
    .x((_, index) => x(index))
    .y0((point) => y(point[0]))
    .y1((point) => y(point[1]))

  const layers = svg.append('g').attr('class', 'app-chart__areas')
  stacked.forEach((layer) => {
    const index = visible.findIndex((entry) => entry.key === layer.key)
    layers
      .append('path')
      .attr(
        'class',
        onSelect
          ? 'app-chart__band app-chart__band--selectable'
          : 'app-chart__band'
      )
      .attr('fill', fill(layer.key))
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1)
      .attr('d', flat(layer))
      .on('click', () => onSelect?.(visible[index].key))
      .transition()
      .duration(duration(motion))
      .attr('d', shaped(layer))
  })

  drawMarkers(svg, markers, (index) => x(index), m.top, height - m.bottom)

  const crosshair = svg
    .append('line')
    .attr('class', 'app-chart__crosshair')
    .attr('y1', m.top)
    .attr('y2', height - m.bottom)
    .attr('stroke', '#0b0c0c')
    .attr('stroke-width', 1.5)
    .attr('visibility', 'hidden')

  svg.on('mousemove', (event) =>
    onPoint?.(nearestIndex(x, labels.length, pointer(event, svg)))
  )
  svg.on('mouseleave', () => onLeave?.())

  if (onBrush) {
    const brush = brushX()
      .extent([
        [m.left, m.top],
        [width - m.right, height - m.bottom]
      ])
      .on('end', (event) => {
        if (!event.selection || !event.sourceEvent) {
          return
        }
        const [from, to] = event.selection.map((position) =>
          nearestIndex(x, labels.length, position)
        )
        svg.select('.app-chart__brush').call(brush.move, null)
        if (to > from) {
          onBrush(from, to)
        }
      })
    svg.append('g').attr('class', 'app-chart__brush').call(brush)
  }

  return {
    points: labels.length,
    describe: describe ?? defaultDescribe(labels, visible),
    highlight(index) {
      crosshair
        .attr('visibility', index < 0 ? 'hidden' : 'visible')
        .attr('x1', index < 0 ? 0 : x(index))
        .attr('x2', index < 0 ? 0 : x(index))
    }
  }
}

/** Lines over time, with a dashed line for a series marked `dashed`. */
export function drawLines(plot, options) {
  const {
    labels,
    series,
    width,
    hidden = new Set(),
    motion,
    onPoint,
    onLeave,
    markers = [],
    height = 180,
    describe
  } = options
  const visible = series.filter((entry) => !hidden.has(entry.key))
  const m = margin
  const svg = frame(plot, width, height)
  const x = scalePoint()
    .domain(labels.map((_, index) => index))
    .range([m.left, width - m.right])
    .padding(labels.length < 2 ? 0.5 : 0)
  const top = Math.max(1, max(visible, (entry) => max(entry.values)) ?? 0)
  const y = scaleLinear()
    .domain([0, top])
    .nice(4)
    .range([height - m.bottom, m.top])

  leftAxis(svg, y, width, m)
  bottomAxis(svg, x, labels, height, m, width)

  const path = line()
    .x((_, index) => x(index))
    .y((value) => y(value ?? 0))

  for (const entry of visible) {
    const drawn = svg
      .append('path')
      .attr('fill', 'none')
      .attr('stroke', entry.style.colour)
      .attr('stroke-width', 2.5)
      .attr('stroke-dasharray', entry.style.dashed ? '6 4' : null)
      .attr('d', path(entry.values.map(() => 0)))
    drawn.transition().duration(duration(motion)).attr('d', path(entry.values))

    if (labels.length <= 62) {
      svg
        .append('g')
        .selectAll('circle')
        .data(entry.values)
        .join('circle')
        .attr('cx', (_, index) => x(index))
        .attr('cy', (value) => y(value ?? 0))
        .attr('r', 3)
        .attr('fill', entry.style.dashed ? '#ffffff' : entry.style.colour)
        .attr('stroke', entry.style.colour)
        .attr('stroke-width', 1.5)
    }
  }

  drawMarkers(svg, markers, (index) => x(index), m.top, height - m.bottom)

  const crosshair = svg
    .append('line')
    .attr('y1', m.top)
    .attr('y2', height - m.bottom)
    .attr('stroke', '#0b0c0c')
    .attr('stroke-width', 1.5)
    .attr('visibility', 'hidden')

  svg.on('mousemove', (event) =>
    onPoint?.(nearestIndex(x, labels.length, pointer(event, svg)))
  )
  svg.on('mouseleave', () => onLeave?.())

  return {
    points: labels.length,
    describe: describe ?? defaultDescribe(labels, visible),
    highlight(index) {
      crosshair
        .attr('visibility', index < 0 ? 'hidden' : 'visible')
        .attr('x1', index < 0 ? 0 : x(index))
        .attr('x2', index < 0 ? 0 : x(index))
    }
  }
}

function truncate(text, room) {
  const fits = Math.max(4, Math.floor(room / 7))
  return text.length > fits ? `${text.slice(0, fits - 1)}…` : text
}

/**
 * Horizontal bars, one row a category, stacked by series, with each row's total at its end.
 * `pareto` adds the running total as a share, as a line against a percentage axis on top.
 */
export function drawBars(plot, options) {
  const {
    categories,
    series,
    width,
    hidden = new Set(),
    motion,
    onPoint,
    onLeave,
    onSelect,
    pareto = false,
    describe
  } = options
  const visible = series.filter((entry) => !hidden.has(entry.key))
  const rowHeight = 30
  const m = { top: pareto ? 34 : 8, right: 56, bottom: 26, left: 8 }
  const height = m.top + categories.length * rowHeight + m.bottom
  const labelRoom = Math.min(
    width * 0.42,
    16 + 7 * (max(categories, (category) => category.label.length) ?? 8)
  )
  const svg = frame(plot, width, height)
  const fill = definePatterns(
    svg,
    series.map((entry) => [entry.key, entry.style])
  )

  const y = scaleBand()
    .domain(categories.map((_, index) => index))
    .range([m.top, height - m.bottom])
    .padding(0.25)
  const totals = categories.map((_, index) =>
    sum(visible, (entry) => entry.values[index] ?? 0)
  )
  const x = scaleLinear()
    .domain([0, Math.max(1, max(totals) ?? 0)])
    .nice(4)
    .range([m.left + labelRoom, width - m.right])

  svg
    .append('g')
    .attr('class', 'app-chart__grid')
    .attr('transform', `translate(0,${height - m.bottom})`)
    .call(
      axisBottom(x)
        .ticks(4)
        .tickSize(-(height - m.top - m.bottom))
        .tickFormat((value) => (Number.isInteger(value) ? whole(value) : ''))
    )
    .call((axis) => axis.select('.domain').remove())

  const labels = svg.append('g').attr('class', 'app-chart__category-labels')
  categories.forEach((category, index) => {
    const text = labels
      .append('text')
      .attr('x', m.left + labelRoom - 8)
      .attr('y', y(index) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(truncate(category.label, labelRoom - 12))
    text.append('title').text(category.label)
  })

  const bars = svg.append('g').attr('class', 'app-chart__bars')
  categories.forEach((_, index) => {
    let offset = 0
    for (const entry of visible) {
      const value = entry.values[index] ?? 0
      if (!value) {
        continue
      }
      bars
        .append('rect')
        .attr('y', y(index))
        .attr('height', y.bandwidth())
        .attr('x', x(offset))
        .attr('width', 0)
        .attr('fill', fill(entry.key))
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 1)
        .transition()
        .duration(duration(motion))
        .attr('width', x(offset + value) - x(offset))
      offset += value
    }

    svg
      .append('text')
      .attr('class', 'app-chart__value')
      .attr('x', x(totals[index]) + 6)
      .attr('y', y(index) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(whole(totals[index]))
  })

  if (pareto) {
    const all = sum(totals)
    let running = 0
    const shares = totals.map((total) => {
      running += total
      return all ? running / all : 0
    })
    const share = scaleLinear().domain([0, 1]).range(x.range())
    svg
      .append('g')
      .attr('class', 'app-chart__axis')
      .attr('transform', `translate(0,${m.top - 6})`)
      .call(axisTop(share).ticks(4).tickFormat(percent))
    svg
      .append('path')
      .attr('fill', 'none')
      .attr('stroke', '#0b0c0c')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4 3')
      .attr(
        'd',
        line()
          .x((value) => share(value))
          .y((_, index) => y(index) + y.bandwidth() / 2)(shares)
      )
    svg
      .append('g')
      .selectAll('circle')
      .data(shares)
      .join('circle')
      .attr('cx', (value) => share(value))
      .attr('cy', (_, index) => y(index) + y.bandwidth() / 2)
      .attr('r', 3.5)
      .attr('fill', '#ffffff')
      .attr('stroke', '#0b0c0c')
      .attr('stroke-width', 2)
  }

  const highlight = svg
    .append('rect')
    .attr('x', m.left)
    .attr('width', width - m.left - m.right + 50)
    .attr('height', y.step())
    .attr('fill', 'none')
    .attr('stroke', '#0b0c0c')
    .attr('stroke-width', 2)
    .attr('visibility', 'hidden')

  categories.forEach((_, index) => {
    svg
      .append('rect')
      .attr(
        'class',
        onSelect
          ? 'app-chart__hit app-chart__hit--selectable'
          : 'app-chart__hit'
      )
      .attr('x', m.left)
      .attr('y', y(index) - (y.step() - y.bandwidth()) / 2)
      .attr('width', width - m.left)
      .attr('height', y.step())
      .attr('fill', 'transparent')
      .on('mouseenter', () => onPoint?.(index))
      .on('click', () => onSelect?.(index))
  })
  svg.on('mouseleave', () => onLeave?.())

  return {
    points: categories.length,
    describe:
      describe ??
      defaultDescribe(
        categories.map((category) => category.label),
        visible
      ),
    select: onSelect,
    highlight(index) {
      highlight
        .attr('visibility', index < 0 ? 'hidden' : 'visible')
        .attr('y', index < 0 ? 0 : y(index) - (y.step() - y.bandwidth()) / 2)
    }
  }
}

/** Words on up to three lines under a column, so long reasons fit. */
function wrapLabel(text, label, room) {
  const words = label.split(' ')
  const lines = []
  for (const word of words) {
    const last = lines.at(-1)
    if (last && (last + ' ' + word).length * 6.5 <= room) {
      lines[lines.length - 1] = `${last} ${word}`
    } else {
      lines.push(word)
    }
  }
  lines.slice(0, 3).forEach((part, index) => {
    text
      .append('tspan')
      .attr('x', text.attr('x'))
      .attr('dy', index === 0 ? '1em' : '1.1em')
      .text(index === 2 && lines.length > 3 ? `${part}…` : part)
  })
}

/**
 * The number open at the start, a column for each reason it went up or down, and the number open
 * at the end. Reasons that moved nothing are left out of the drawing, but not of the table.
 */
export function drawWaterfall(plot, options) {
  const {
    start,
    end,
    steps,
    width,
    motion,
    onPoint,
    onLeave,
    startLabel,
    endLabel,
    height = 270,
    upStyle,
    downStyle,
    totalStyle
  } = options
  const items = [{ label: startLabel, kind: 'total', from: 0, to: start }]
  let level = start
  for (const step of steps) {
    if (step.up) {
      items.push({
        label: step.label,
        kind: 'up',
        from: level,
        to: level + step.up,
        value: step.up
      })
      level += step.up
    }
    if (step.down) {
      items.push({
        label: step.label,
        kind: 'down',
        from: level,
        to: level - step.down,
        value: step.down
      })
      level -= step.down
    }
  }
  items.push({ label: endLabel, kind: 'total', from: 0, to: end })

  const m = { top: 22, right: 12, bottom: 60, left: 52 }
  const svg = frame(plot, width, height)
  const fill = definePatterns(svg, [
    ['up', upStyle],
    ['down', downStyle],
    ['total', totalStyle]
  ])
  const x = scaleBand()
    .domain(items.map((_, index) => index))
    .range([m.left, width - m.right])
    .padding(0.2)

  // A backlog of thousands that moves by tens would show no changes on a scale from zero, so the
  // scale then starts just below the lowest level, and the axis is marked as broken.
  const levels = items.flatMap((item) =>
    item.kind === 'total' ? [item.to] : [item.from, item.to]
  )
  const high = Math.max(1, max(levels) ?? 0)
  const low = Math.min(...levels)
  const zoomed = low > 0 && high - low < high * 0.3
  const y = scaleLinear()
    .domain([
      zoomed ? Math.max(0, low - Math.max(1, (high - low) * 0.6)) : 0,
      high
    ])
    .nice(4)
    .range([height - m.bottom, m.top])
  const base = y.domain()[0]
  for (const item of items) {
    if (item.kind === 'total') {
      item.from = base
    }
  }

  leftAxis(svg, y, width, m)
  if (zoomed && base > 0) {
    svg
      .append('path')
      .attr('class', 'app-chart__axis-break')
      .attr(
        'd',
        `M${m.left - 6},${height - m.bottom - 2} l12,-6 M${m.left - 6},${height - m.bottom + 4} l12,-6`
      )
      .attr('stroke', '#0b0c0c')
      .attr('stroke-width', 1.5)
      .attr('fill', 'none')
  }

  items.forEach((item, index) => {
    svg
      .append('rect')
      .attr('x', x(index))
      .attr('width', x.bandwidth())
      .attr('fill', fill(item.kind))
      .attr('stroke', '#ffffff')
      .attr('y', y(item.from))
      .attr('height', 0)
      .transition()
      .duration(duration(motion))
      .attr('y', y(Math.max(item.from, item.to)))
      .attr('height', Math.max(1, Math.abs(y(item.from) - y(item.to))))

    if (index < items.length - 1) {
      svg
        .append('line')
        .attr('class', 'app-chart__connector')
        .attr('x1', x(index) + x.bandwidth())
        .attr('x2', x(index + 1))
        .attr('y1', y(item.kind === 'total' ? item.to : item.to))
        .attr('y2', y(item.kind === 'total' ? item.to : item.to))
        .attr('stroke', '#505a5f')
        .attr('stroke-dasharray', '2 2')
    }

    svg
      .append('text')
      .attr('class', 'app-chart__value')
      .attr('x', x(index) + x.bandwidth() / 2)
      .attr('y', y(Math.max(item.from, item.to)) - 5)
      .attr('text-anchor', 'middle')
      .text(
        item.kind === 'total'
          ? whole(item.to)
          : `${item.kind === 'up' ? '+' : '−'}${whole(item.value)}`
      )

    const label = svg
      .append('text')
      .attr('class', 'app-chart__tick-label')
      .attr('x', x(index) + x.bandwidth() / 2)
      .attr('y', height - m.bottom + 4)
      .attr('text-anchor', 'middle')
    wrapLabel(label, item.label, x.step())
  })

  const highlight = svg
    .append('rect')
    .attr('y', m.top)
    .attr('height', height - m.top - m.bottom)
    .attr('width', x.step())
    .attr('fill', 'none')
    .attr('stroke', '#0b0c0c')
    .attr('stroke-width', 2)
    .attr('visibility', 'hidden')

  items.forEach((_, index) => {
    svg
      .append('rect')
      .attr('class', 'app-chart__hit')
      .attr('x', x(index) - (x.step() - x.bandwidth()) / 2)
      .attr('y', m.top)
      .attr('width', x.step())
      .attr('height', height - m.top)
      .attr('fill', 'transparent')
      .on('mouseenter', () => onPoint?.(index))
  })
  svg.on('mouseleave', () => onLeave?.())

  return {
    points: items.length,
    items,
    describe: (index) => {
      const item = items[index]
      return item.kind === 'total'
        ? [item.label, `${whole(item.to)} open`]
        : [
            item.label,
            `${item.kind === 'up' ? 'Up' : 'Down'} ${whole(item.value)}`,
            `Then ${whole(item.to)} open`
          ]
    },
    highlight(index) {
      highlight
        .attr('visibility', index < 0 ? 'hidden' : 'visible')
        .attr('x', index < 0 ? 0 : x(index) - (x.step() - x.bandwidth()) / 2)
    }
  }
}

/**
 * Status before, on the left, to status after, on the right. The width of a band is the number of
 * changes it holds, and it takes the colour of the status it goes to.
 */
export function drawFlow(plot, options) {
  const {
    links,
    styleOf,
    width,
    motion,
    onPoint,
    onLeave,
    height = 280
  } = options
  const m = { top: 10, right: 150, bottom: 10, left: 150 }
  const svg = frame(plot, width, height)
  const order = [
    'todo',
    'in-progress',
    'suppressed',
    'resolved',
    'nonactionable'
  ]
  const rank = (state) =>
    order.includes(state) ? order.indexOf(state) : order.length
  const nodes = (side) => {
    const totals = new Map()
    for (const link of links) {
      totals.set(link[side], (totals.get(link[side]) ?? 0) + link.count)
    }
    return [...totals]
      .sort((a, b) => rank(a[0]) - rank(b[0]))
      .map(([key, total]) => ({ key, total }))
  }
  const left = nodes('from')
  const right = nodes('to')
  const total = sum(links, (link) => link.count)
  const gap = 10
  const room = height - m.top - m.bottom
  const k = Math.max(
    0,
    (room - gap * (Math.max(left.length, right.length) - 1)) /
      Math.max(1, total)
  )
  const place = (column) => {
    let y = m.top
    for (const node of column) {
      node.y = y
      node.height = Math.max(1, node.total * k)
      node.offset = 0
      y += node.height + gap
    }
    return new Map(column.map((node) => [node.key, node]))
  }
  const from = place(left)
  const to = place(right)
  const x0 = m.left
  const x1 = width - m.right
  const nodeWidth = 12

  const sorted = [...links].sort(
    (a, b) => rank(a.from) - rank(b.from) || rank(a.to) - rank(b.to)
  )
  const bands = svg.append('g').attr('class', 'app-chart__flows')
  sorted.forEach((link, index) => {
    const source = from.get(link.from)
    const target = to.get(link.to)
    const thickness = link.count * k
    const sy = source.y + source.offset
    const ty = target.y + target.offset
    source.offset += thickness
    target.offset += thickness
    const a = x0 + nodeWidth
    const b = x1
    const mid = (a + b) / 2
    bands
      .append('path')
      .attr('class', 'app-chart__flow')
      .attr(
        'd',
        `M${a},${sy}C${mid},${sy} ${mid},${ty} ${b},${ty}L${b},${ty + thickness}C${mid},${ty + thickness} ${mid},${sy + thickness} ${a},${sy + thickness}Z`
      )
      .attr('fill', styleOf(link.to).colour)
      .attr('fill-opacity', 0)
      .on('mouseenter', () => onPoint?.(index))
      .transition()
      .duration(duration(motion))
      .attr('fill-opacity', 0.45)
  })

  const drawNodes = (column, x, anchor, dx) => {
    for (const node of column) {
      svg
        .append('rect')
        .attr('x', x)
        .attr('y', node.y)
        .attr('width', nodeWidth)
        .attr('height', node.height)
        .attr('fill', styleOf(node.key).colour)
      svg
        .append('text')
        .attr('class', 'app-chart__node-label')
        .attr('x', x + dx)
        .attr('y', node.y + node.height / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', anchor)
        .text(`${styleOf(node.key).label} ${whole(node.total)}`)
    }
  }
  drawNodes(left, x0, 'end', -6)
  drawNodes(right, x1, 'start', nodeWidth + 6)
  svg.on('mouseleave', () => onLeave?.())

  return {
    points: sorted.length,
    describe: (index) => {
      const link = sorted[index]
      return [
        `${styleOf(link.from).label} to ${styleOf(link.to).label}`,
        `${whole(link.count)} changes`
      ]
    },
    highlight(index) {
      bands
        .selectAll('path')
        .attr('stroke', (_, at) => (at === index ? '#0b0c0c' : null))
        .attr('stroke-width', (_, at) => (at === index ? 2 : null))
    }
  }
}

/** A small line for a headline figure: no axes, its last point marked. */
export function drawSparkline(
  plot,
  values,
  { width = 180, height = 36, colour = '#1d70b8' } = {}
) {
  const svg = frame(plot, width, height)
  const x = scalePoint()
    .domain(values.map((_, index) => index))
    .range([3, width - 3])
    .padding(values.length < 2 ? 0.5 : 0)
  const y = scaleLinear()
    .domain([0, Math.max(1, max(values) ?? 0)])
    .range([height - 4, 4])

  if (values.length > 1) {
    svg
      .append('path')
      .attr('fill', 'none')
      .attr('stroke', colour)
      .attr('stroke-width', 2)
      .attr(
        'd',
        line()
          .x((_, index) => x(index))
          .y((value) => y(value))(values)
      )
  }

  if (values.length > 0) {
    svg
      .append('circle')
      .attr('cx', x(values.length - 1))
      .attr('cy', y(values.at(-1)))
      .attr('r', 3)
      .attr('fill', colour)
  }

  return svg.node()
}

/** A bar for a table cell, scaled to the largest value in its column. */
export function inlineBar(
  doc,
  value,
  largest,
  { width = 72, height = 6, colour = '#1d70b8' } = {}
) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'app-inline-bar')
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const track = doc.createElementNS('http://www.w3.org/2000/svg', 'rect')
  track.setAttribute('width', String(width))
  track.setAttribute('height', String(height))
  track.setAttribute('fill', '#f3f2f1')
  const bar = doc.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bar.setAttribute(
    'width',
    String(
      largest > 0 ? Math.max(value > 0 ? 2 : 0, (value / largest) * width) : 0
    )
  )
  bar.setAttribute('height', String(height))
  bar.setAttribute('fill', colour)
  svg.append(track, bar)
  return svg
}
