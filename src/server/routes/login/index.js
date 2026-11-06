import { safeNext, signInController, signOutController } from './controller.js'
import { createEntraHandlers, validateEntraConfig } from './entra.js'
import { isEntra, isSignedInTo, signOut } from '#/server/plugins/auth.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

const adminRoleMissing = (h) =>
  h
    .view('login/entra-error', {
      pageTitle: 'You cannot use the admin area',
      message:
        'The admin area is only for admins. If you have just been made an admin, sign out and sign in again.',
      linkHref: '/logout',
      linkText: 'Sign out'
    })
    .code(statusCodes.forbidden)

/**
 * Signing in and out. The service sign-in page is the only page open to everyone; the admin one
 * is behind the service password, so the admin password is only asked of someone signed in. In
 * Entra mode there is no admin password: the cleanse-admin app role opens the admin area.
 */
export const login = {
  plugin: {
    name: 'login',
    register(server) {
      validateEntraConfig()
      const entra = createEntraHandlers()
      const service = signInController('service')
      const admin = signInController('admin')

      server.route([
        {
          method: 'GET',
          path: '/login',
          options: { auth: false },
          handler(request, h) {
            if (!isEntra()) {
              return service.show(request, h)
            }
            const next = safeNext(request.query.next, '/')
            return isSignedInTo(request, 'service')
              ? h.redirect(next)
              : h.view('login/entra', {
                  pageTitle: 'Sign in',
                  loginPath: `/auth/entra/login?${new URLSearchParams({ next })}`
                })
          }
        },
        {
          method: 'POST',
          path: '/login',
          options: { auth: false },
          handler: (request, h) =>
            isEntra()
              ? h.response('Use Microsoft sign-in.').code(405)
              : service.submit(request, h)
        },
        {
          method: 'GET',
          path: '/auth/entra/login',
          options: { auth: false },
          handler: (request, h) =>
            isEntra()
              ? entra.login(request, h)
              : h.response('Not found').code(404)
        },
        {
          method: 'GET',
          path: '/auth/entra/callback',
          options: { auth: false },
          handler: (request, h) =>
            isEntra()
              ? entra.callback(request, h)
              : h.response('Not found').code(404)
        },
        {
          method: 'GET',
          path: '/admin/login',
          options: { auth: 'service' },
          handler: (request, h) =>
            isEntra() && !isSignedInTo(request, 'admin')
              ? adminRoleMissing(h)
              : admin.show(request, h)
        },
        {
          method: 'POST',
          path: '/admin/login',
          options: { auth: 'service' },
          handler: (request, h) =>
            isEntra()
              ? h
                  .response('Admin access comes from your Microsoft account.')
                  .code(405)
              : admin.submit(request, h)
        },
        {
          method: 'GET',
          path: '/logout',
          options: { auth: false },
          handler(request, h) {
            if (!isEntra()) {
              return signOutController.handler(request, h)
            }
            signOut(request)
            return entra.logout(request, h)
          }
        }
      ])
    }
  }
}
