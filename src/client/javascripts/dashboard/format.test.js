import {
  describeChange,
  formatAsAt,
  formatBucket,
  formatRange
} from './format.js'

describe('#dashboard formats', () => {
  test('Should write a period as briefly as its dates allow', () => {
    expect(formatRange('2026-11-21', '2026-11-27')).toBe(
      '21 to 27 November 2026'
    )
    expect(formatRange('2026-10-31', '2026-11-27')).toBe(
      '31 October to 27 November 2026'
    )
    expect(formatRange('2025-11-28', '2026-11-27')).toBe(
      '28 November 2025 to 27 November 2026'
    )
    expect(formatRange('2026-11-27', '2026-11-27')).toBe('27 November 2026')
  })

  test('Should compare a figure with the period before', () => {
    expect(describeChange(412, 349, 7)).toBe('Up 63 (18%) on the 7 days before')
    expect(describeChange(57, 61, 7)).toBe('Down 4 (7%) on the 7 days before')
    expect(describeChange(14, 14, 7)).toBe('The same as the 7 days before')
    expect(describeChange(3, 0, 1)).toBe('New: none in the day before')
  })

  test('Should name each point as its interval does', () => {
    const bucket = { start: '2026-11-23', end: '2026-11-29' }

    expect(formatBucket(bucket, 'day')).toBe('23 Nov')
    expect(formatBucket(bucket, 'week')).toBe('w/c 23 Nov')
    expect(
      formatBucket({ start: '2026-11-01', end: '2026-11-30' }, 'month')
    ).toBe('Nov 2026')
  })

  test('Should say when the figures date from in UK time', () => {
    const now = new Date('2026-07-15T12:00:00Z')

    expect(formatAsAt('2026-07-15T09:42:00Z', now)).toBe('10:42 today')
    expect(formatAsAt('2026-07-14T17:05:00Z', now)).toBe('18:05 yesterday')
    expect(formatAsAt('2026-07-01T09:42:00Z', now)).toBe('10:42 on 1 July 2026')
  })
})
