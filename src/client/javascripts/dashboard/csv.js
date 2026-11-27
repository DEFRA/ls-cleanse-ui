/**
 * What a chart shows, as a CSV file. A cell a spreadsheet would run as a formula, one starting
 * with = + - @, a tab or a carriage return, is written with an apostrophe in front. Numbers are
 * written as they are, so a count stays a number.
 */

const formulaStart = /^[=+\-@\t\r]/

export function safeCell(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : ''
  }

  const text = value === null || value === undefined ? '' : String(value)
  const guarded = formulaStart.test(text) ? `'${text}` : text
  return /[",\r\n]/.test(guarded)
    ? `"${guarded.replaceAll('"', '""')}"`
    : guarded
}

export function toCsv(columns, rows) {
  const lines = [columns, ...rows].map((row) => row.map(safeCell).join(','))
  return `${lines.join('\r\n')}\r\n`
}

const slug = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/**
 * The chart, the period and the filters, as a file name. A person is "one-person", never their
 * name, so a file passed around does not say whose work it is from its name alone.
 */
export function csvFileName(chart, { filters, period }) {
  const parts = [
    'cleanse',
    chart,
    `${period.from}-to-${period.to}`,
    period.interval
  ]

  if (filters.ruleId) {
    parts.push(`rule-${filters.ruleId}`)
  }

  if (filters.userId) {
    parts.push('one-person')
  }

  if (filters.unit === 'holdings') {
    parts.push('holdings')
  }

  return `${parts.map(slug).filter(Boolean).join('-')}.csv`
}

/** Saves the text as a file, as a download the browser offers. */
export function download(text, fileName, doc = document) {
  // The byte order mark makes Excel read the file as UTF-8, so Can't resolve keeps its apostrophe.
  const blob = new Blob([`\uFEFF${text}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = doc.createElement('a')
  link.href = url
  link.download = fileName
  link.hidden = true
  doc.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
