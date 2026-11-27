/**
 * How the dashboard writes numbers, dates and comparisons. Days are UK days, sent as yyyy-mm-dd,
 * so they are read as UTC midnights and written in UTC: that keeps a day the same day everywhere.
 */

const whole = new Intl.NumberFormat('en-GB')
const longDay = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC'
})
const dayMonth = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC'
})
const shortDay = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC'
})
const shortMonth = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC'
})
const ukTime = new Intl.DateTimeFormat('en-GB', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Europe/London'
})
const ukDay = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Europe/London'
})

export const formatNumber = (value) => whole.format(value ?? 0)

export const formatPercent = (fraction) =>
  `${Math.round((fraction ?? 0) * 100)}%`

export const parseDay = (day) => new Date(`${day}T00:00:00Z`)

/** 27 November 2026 */
export const formatDay = (day) => longDay.format(parseDay(day))

/** 27 Nov */
export const formatShortDay = (day) => shortDay.format(parseDay(day))

/** 21 to 27 November 2026, 31 October to 27 November 2026, or 1 May 2025 to 27 November 2026. */
export function formatRange(from, to) {
  if (from === to) {
    return formatDay(to)
  }

  const start = parseDay(from)
  const end = parseDay(to)
  if (start.getUTCFullYear() !== end.getUTCFullYear()) {
    return `${formatDay(from)} to ${formatDay(to)}`
  }

  if (start.getUTCMonth() === end.getUTCMonth()) {
    return `${start.getUTCDate()} to ${formatDay(to)}`
  }

  return `${dayMonth.format(start)} to ${formatDay(to)}`
}

/** A point on a time axis: 27 Nov, w/c 23 Nov or Nov 2026. */
export function formatBucket(bucket, interval) {
  if (interval === 'month') {
    return shortMonth.format(parseDay(bucket.start))
  }

  if (interval === 'week') {
    return `w/c ${formatShortDay(bucket.start)}`
  }

  return formatShortDay(bucket.start)
}

/** A point in words, for a screen reader or a table: 27 November 2026, or 23 to 29 November 2026. */
export const describeBucket = (bucket) => formatRange(bucket.start, bucket.end)

const unit = { day: 'day', week: 'week', month: 'month' }

/** The period before, in words: the 7 days before, or the day before. */
export function previousPeriod(days) {
  return days === 1 ? 'the day before' : `the ${formatNumber(days)} days before`
}

/**
 * A figure against the same figure for the period before: up, down or the same, by how much and
 * by what share, or new when there was nothing before.
 */
export function describeChange(value, previous, days) {
  const before = previousPeriod(days)
  if (value === previous) {
    return `The same as ${before}`
  }

  if (!previous) {
    return `New: none in ${before}`
  }

  const difference = value - previous
  const share = Math.round((Math.abs(difference) / previous) * 100)
  return `${difference > 0 ? 'Up' : 'Down'} ${formatNumber(Math.abs(difference))} (${share}%) on ${before}`
}

/** When the figures date from: 10:42 today, 18:05 yesterday, or 10:42 on 3 November 2026. */
export function formatAsAt(iso, now = new Date()) {
  const at = new Date(iso)
  const time = ukTime.format(at)
  const day = ukDay.format(at)
  const today = ukDay.format(now)
  const yesterday = ukDay.format(new Date(now.getTime() - 86400000))

  if (day === today) {
    return `${time} today`
  }

  if (day === yesterday) {
    return `${time} yesterday`
  }

  return `${time} on ${formatDay(day)}`
}

/** A date and time in words, for a table cell: 3 November 2026. */
export const formatInstantDay = (iso) =>
  iso ? formatDay(ukDay.format(new Date(iso))) : ''

/** "the period" as the interval names its points: each day, each week or each month. */
export const eachInterval = (interval) => `each ${unit[interval] ?? 'day'}`

/** Plural nouns for counts: 1 holding, 2 holdings. */
export const plural = (count, singular, pluralForm = `${singular}s`) =>
  `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`
