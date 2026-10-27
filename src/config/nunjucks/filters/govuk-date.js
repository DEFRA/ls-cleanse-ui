import { differenceInCalendarDays, format, isDate, parseISO } from 'date-fns'

const toDate = (value) => (isDate(value) ? value : parseISO(value))

/** "4 March 2026" — the GOV.UK date format. */
export function govukDate(value) {
  return value ? format(toDate(value), 'd MMMM yyyy') : ''
}

/** "4 March 2026 at 9:15am" — the GOV.UK date and time format. */
export function govukDateTime(value) {
  if (!value) {
    return ''
  }

  const date = toDate(value)
  const time = format(date, 'h:mmaaa').replace(':00', ':00')

  return `${format(date, 'd MMMM yyyy')} at ${time}`
}

/** Whole days from today until a date, floored at zero. Used for suppression countdowns. */
export function daysUntil(value) {
  return value
    ? Math.max(0, differenceInCalendarDays(toDate(value), new Date()))
    : 0
}

/** Seconds as "1h 7m 3s", dropping the units that would read as zero. */
export function duration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))

  if (total < 1) {
    return 'Less than a second'
  }

  const parts = [
    [Math.floor(total / 3600), 'h'],
    [Math.floor((total % 3600) / 60), 'm'],
    [total % 60, 's']
  ]

  return parts
    .filter(([amount]) => amount > 0)
    .map(([amount, unit]) => `${amount}${unit}`)
    .join(' ')
}
