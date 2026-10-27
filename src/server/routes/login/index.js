import { safeNext, signInController, signOutController } from './controller.js'
import { createEntraHandlers, validateEntraConfig } from './entra.js'
import { isEntra, isSignedInTo, signOut } from '#/server/plugins/auth.js'

/**
 * Signing in and out. The service sign-in page is the only page open to everyone; the admin one
 * is behind the service password, so the admin password is only asked of someone signed in.
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
          handler: admin.show
        },
        {
          method: 'POST',
          path: '/admin/login',
          options: { auth: 'service' },
          handler: admin.submit
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
