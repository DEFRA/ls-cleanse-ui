import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  gates,
  isConfigured,
  isPassword,
  isSignedInTo,
  signIn,
  signOut
} from '#/server/plugins/auth.js'

/** The wording for each gate. Both share one template. */
const pages = {
  service: {
    pageTitle: 'Sign in',
    lead: 'Enter the password to use this service.',
    label: 'Password',
    missing: 'Enter the password',
    wrong: 'The password is not correct',
    unavailable:
      'You cannot sign in, because no password has been set up for this service yet.'
  },
  admin: {
    pageTitle: 'Sign in to admin',
    lead: 'The admin area has a password of its own.',
    label: 'Admin password',
    missing: 'Enter the admin password',
    wrong: 'The admin password is not correct',
    unavailable:
      'The admin area cannot be opened, because no admin password has been set up for this service yet.'
  }
}

/** Never redirected to after signing in: the sign-in page again, or signing straight back out. */
const notDestinations = new Set([
  '/login',
  '/logout',
  '/auth/entra/login',
  '/auth/entra/callback'
])
const origin = 'http://cleanse-app.invalid'

/**
 * Where to go once signed in: a page of this service, or the fallback. Anything else would make
 * the sign-in page an open redirect, so the address is resolved as a browser would resolve it
 * and must stay on this service. Resolving removes dot segments, which can leave a path starting
 * '//', as from '/.//evil.example': a browser reads that as an address on another site.
 */
export function safeNext(next, fallback) {
  if (typeof next !== 'string' || !next.startsWith('/')) {
    return fallback
  }

  try {
    const url = new URL(next, origin)
    return url.origin === origin &&
      !url.pathname.startsWith('//') &&
      !notDestinations.has(url.pathname)
      ? url.pathname + url.search
      : fallback
  } catch {
    return fallback
  }
}

function authenticationEvent(action, outcome, reason) {
  return { event: { category: 'authentication', action, outcome, reason } }
}

function render(h, gate, { error = null, notification = null } = {}) {
  const configured = isConfigured(gate)
  const view = h.view('login/index', {
    ...pages[gate],
    error,
    notification,
    unavailable: configured ? null : pages[gate].unavailable
  })

  if (!configured) {
    return view.code(statusCodes.serviceUnavailable)
  }

  return error ? view.code(statusCodes.badRequest) : view
}

export function signInController(gate) {
  const nextFrom = (request) => safeNext(request.query.next, gates[gate].home)

  return {
    show(request, h) {
      if (isSignedInTo(request, gate)) {
        return h.redirect(nextFrom(request))
      }

      return render(h, gate, {
        notification: request.yar.flash('notification')[0] ?? null
      })
    },

    submit(request, h) {
      if (!isConfigured(gate)) {
        return render(h, gate)
      }

      const password = request.payload?.password

      if (typeof password !== 'string' || password.trim() === '') {
        return render(h, gate, { error: pages[gate].missing })
      }

      // The attempt itself is never logged, only that it failed.
      if (!isPassword(gate, password)) {
        request.logger.warn(
          authenticationEvent(
            `sign-in-${gate}`,
            'failure',
            'The password was not correct'
          ),
          'Sign-in refused'
        )
        return render(h, gate, { error: pages[gate].wrong })
      }

      signIn(request, gate)
      request.logger.info(
        authenticationEvent(`sign-in-${gate}`, 'success'),
        'Signed in'
      )

      return h.redirect(nextFrom(request))
    }
  }
}

export const signOutController = {
  handler(request, h) {
    signOut(request)
    request.logger.info(
      authenticationEvent('sign-out', 'success'),
      'Signed out'
    )

    request.yar.flash('notification', 'You have signed out.')
    return h.redirect(gates.service.signInPath)
  }
}
