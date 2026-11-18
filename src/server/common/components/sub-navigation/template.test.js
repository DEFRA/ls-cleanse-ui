import { renderComponent } from '#/test-helpers/component-helpers.js'

describe('Sub navigation component', () => {
  const $nav = renderComponent('sub-navigation', {
    label: 'Issue views',
    items: [
      { text: 'List', href: '/issues?filtered=true', current: true },
      { text: 'Grouped', href: '/issues/grouped?filtered=true' }
    ]
  })

  test('Should label the navigation landmark', () => {
    expect($nav('nav').attr('aria-label')).toBe('Issue views')
  })

  test('Should link every item and mark only the current one', () => {
    const links = $nav('a')

    expect(links.map((_, link) => $nav(link).text()).get()).toEqual([
      'List',
      'Grouped'
    ])
    expect(links.eq(0).attr('aria-current')).toBe('page')
    expect(links.eq(1).attr('aria-current')).toBeUndefined()
    expect(links.eq(1).attr('href')).toBe('/issues/grouped?filtered=true')
  })
})
