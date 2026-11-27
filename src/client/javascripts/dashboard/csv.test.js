import { csvFileName, safeCell, toCsv } from './csv.js'

describe('#dashboard CSV', () => {
  test('Should stop a spreadsheet running a cell as a formula', () => {
    expect(safeCell('=HYPERLINK("http://evil")')).toBe(
      '"\'=HYPERLINK(""http://evil"")"'
    )
    expect(safeCell('+1')).toBe("'+1")
    expect(safeCell('-1')).toBe("'-1")
    expect(safeCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(safeCell('\tTab')).toBe("'\tTab")
    expect(safeCell('\rReturn')).toBe('"\'\rReturn"')
  })

  test('Should write numbers as numbers, negative ones included', () => {
    expect(safeCell(-3)).toBe('-3')
    expect(safeCell(1234)).toBe('1234')
  })

  test('Should quote what needs quoting', () => {
    expect(
      toCsv(['Reason', 'Count'], [["Can't resolve, keeper gone", 2]])
    ).toBe('Reason,Count\r\n"Can\'t resolve, keeper gone",2\r\n')
  })

  test('Should name the file after the chart, period and filters, but never a person', () => {
    const period = { from: '2026-11-21', to: '2026-11-27', interval: 'day' }

    expect(
      csvFileName('outcomes', { filters: { unit: 'issues' }, period })
    ).toBe('cleanse-outcomes-2026-11-21-to-2026-11-27-day.csv')
    expect(
      csvFileName('outcomes', {
        filters: {
          ruleId: 'rule-1',
          userId: '0a1ce000-0000-4000-8000-000000000001',
          unit: 'holdings'
        },
        period
      })
    ).toBe(
      'cleanse-outcomes-2026-11-21-to-2026-11-27-day-rule-rule-1-one-person-holdings.csv'
    )
  })
})
