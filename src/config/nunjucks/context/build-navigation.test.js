import { buildNavigation } from './build-navigation.js'

/** As hapi marks a request that got past the password. */
function signedInRequest(options) {
  return { auth: { isAuthenticated: true }, ...options }
}

const signOut = { current: false, text: 'Sign out', href: '/logout' }

describe('#buildNavigation', () => {
  test('Should provide expected navigation details', () => {
    expect(
      buildNavigation(signedInRequest({ path: '/non-existent-path' }))
    ).toEqual([
      {
        current: false,
        text: 'Home',
        href: '/'
      },
      {
        current: false,
        text: 'Issues',
        href: '/issues'
      },
      signOut
    ])
  })

  test('Should provide expected highlighted navigation details', () => {
    expect(buildNavigation(signedInRequest({ path: '/' }))).toEqual([
      {
        current: true,
        text: 'Home',
        href: '/'
      },
      {
        current: false,
        text: 'Issues',
        href: '/issues'
      },
      signOut
    ])
  })

  test('Should highlight Issues for any page beneath it', () => {
    const navigation = buildNavigation(
      signedInRequest({ path: '/issues/2-ABCDEFGH/suppress' })
    )

    expect(navigation[1]).toEqual({
      current: true,
      text: 'Issues',
      href: '/issues'
    })
  })

  test('Should cope with a request that has no path', () => {
    expect(buildNavigation(signedInRequest())).toEqual([
      { current: false, text: 'Home', href: '/' },
      { current: false, text: 'Issues', href: '/issues' },
      signOut
    ])
  })

  /** Every page is behind the password, so before signing in there is nowhere to go. */
  test('Should offer nothing before signing in', () => {
    expect(buildNavigation({ path: '/login' })).toEqual([])
    expect(buildNavigation(undefined)).toEqual([])
  })
})
