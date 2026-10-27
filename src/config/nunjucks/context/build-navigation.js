import { isSignedIn } from '#/server/plugins/auth.js'

/** Nothing to navigate to before signing in: every page is behind the password. */
export function buildNavigation(request) {
  if (!isSignedIn(request)) {
    return []
  }

  const path = request.path ?? ''

  return [
    {
      text: 'Home',
      href: '/',
      current: path === '/'
    },
    {
      text: 'Issues',
      href: '/issues',
      current: path.startsWith('/issues')
    },
    {
      text: 'Sign out',
      href: '/logout',
      current: false
    }
  ]
}
