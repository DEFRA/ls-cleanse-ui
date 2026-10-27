import {
  readFilters,
  buildQuery,
  buildPagination,
  rememberableQuery,
  maxRememberedQueryLength,
  issuesBackLink
} from './list-controller.js'

describe('#readFilters', () => {
  test('Should default to the working queue on a first visit', () => {
    const filters = readFilters({})

    expect(filters.status).toEqual(['active'])
    expect(filters.workflowStatus).toEqual(['todo', 'in-progress'])
    expect(filters.isDefault).toBe(true)
  })

  test('Should honour an empty selection once the user has chosen', () => {
    // Unticking everything must widen the list, not empty it.
    const filters = readFilters({ filtered: 'true' })

    expect(filters.status).toEqual([])
    expect(filters.workflowStatus).toEqual([])
    expect(filters.isDefault).toBe(false)
  })

  test('Should accept a single checkbox value as well as several', () => {
    expect(readFilters({ filtered: 'true', status: 'active' }).status).toEqual([
      'active'
    ])
    expect(
      readFilters({ filtered: 'true', status: ['active', 'inactive'] }).status
    ).toEqual(['active', 'inactive'])
  })

  test('Should trim the search term and floor the page at one', () => {
    const filters = readFilters({ searchTerm: '  01/036/8000 ', page: '-3' })

    expect(filters.searchTerm).toBe('01/036/8000')
    expect(filters.page).toBe(1)
  })

  test('Should default to any assignee and retain explicit user or unassigned choices', () => {
    expect(readFilters({}).assignee).toBe('all')
    expect(readFilters({ assignee: 'unassigned' }).assignee).toBe('unassigned')
    expect(readFilters({ assignee: 'user-id' }).assignee).toBe('user-id')
  })
})

describe('#buildQuery', () => {
  test('Should round-trip the filters it was given', () => {
    const query = buildQuery(readFilters({}), 1)

    expect(
      readFilters(Object.fromEntries(new URLSearchParams(query)))
    ).toMatchObject({
      isDefault: false
    })
    expect(query).toContain('filtered=true')
    expect(query).toContain('status=active')
  })

  test('Should omit page one, a rule of all, and an empty search', () => {
    const query = buildQuery(readFilters({}), 1)

    expect(query).not.toContain('page=')
    expect(query).not.toContain('ruleId=')
    expect(query).not.toContain('searchTerm=')
  })

  test('Should encode a CPH search term', () => {
    const query = buildQuery(readFilters({ searchTerm: '01/036/8000' }), 2)

    expect(query).toContain('searchTerm=01%2F036%2F8000')
    expect(query).toContain('page=2')
  })

  test.each(['unassigned', 'user-id'])(
    'Should preserve assignee %s in pagination',
    (assignee) => {
      const filters = readFilters({
        filtered: 'true',
        assignee,
        ruleId: '2',
        searchTerm: 'holding'
      })
      const query = buildQuery(filters, 2)
      expect(
        readFilters(Object.fromEntries(new URLSearchParams(query)))
      ).toMatchObject({
        assignee,
        ruleId: '2',
        searchTerm: 'holding',
        page: 2
      })
      expect(buildPagination(filters, 1, 3).next.href).toContain(
        `assignee=${assignee}`
      )
    }
  )
})

describe('#buildPagination', () => {
  const filters = readFilters({})

  test('Should not paginate a single page', () => {
    expect(buildPagination(filters, 1, 1)).toBeNull()
  })

  test('Should mark the current page and offer only the moves that exist', () => {
    const first = buildPagination(filters, 1, 5)

    expect(first.previous).toBeUndefined()
    expect(first.next).toBeDefined()
    expect(first.items.find((item) => item.current).number).toBe(1)

    expect(buildPagination(filters, 5, 5).next).toBeUndefined()
  })

  test('Should insert an ellipsis only where pages are skipped', () => {
    const middle = buildPagination(filters, 10, 20)
    const numbers = middle.items
      .filter((item) => !item.ellipsis)
      .map((item) => item.number)

    expect(numbers).toEqual([1, 9, 10, 11, 20])
    expect(middle.items.filter((item) => item.ellipsis)).toHaveLength(2)

    // Consecutive pages need no gap marker.
    const tight = buildPagination(filters, 2, 3)
    expect(tight.items.filter((item) => item.ellipsis)).toHaveLength(0)
  })
})

describe('#rememberableQuery', () => {
  const url = (search) => new URL(`http://localhost/issues${search}`)

  test('Should remember the filters and page to return to', () => {
    expect(rememberableQuery(url('?filtered=true&status=active&page=3'))).toBe(
      '/issues?filtered=true&status=active&page=3'
    )
  })

  /** The session is a cookie, so an absurd query must not be what pushes it past its limit. */
  test('Should fall back to the plain list rather than carry an oversized query', () => {
    const long = `?searchTerm=${'x'.repeat(maxRememberedQueryLength)}`

    expect(rememberableQuery(url(long))).toBe('/issues')
  })
})

describe('#issuesBackLink', () => {
  test('Should link back to the remembered list', () => {
    expect(issuesBackLink('/issues')).toBe('/issues')
    expect(issuesBackLink('/issues?filtered=true&page=3')).toBe(
      '/issues?filtered=true&page=3'
    )
  })

  /** The session is held by the browser, so a forged one must not be able to choose the link. */
  test.each([
    undefined,
    null,
    42,
    '',
    'javascript:alert(1)',
    'https://example.com/issues',
    '//example.com/issues',
    '/issues/../admin',
    '/issuesx',
    '/admin/status'
  ])('Should link to the plain list instead of %j', (remembered) => {
    expect(issuesBackLink(remembered)).toBe('/issues')
  })
})
