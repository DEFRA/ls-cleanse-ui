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
      // A holding is where its issues are worked, so it sits under Issues.
      current: path.startsWith('/issues') || path.startsWith('/holdings/')
    },
    {
      text: 'Sign out',
      href: '/logout',
      current: false
    }
  ]
}
