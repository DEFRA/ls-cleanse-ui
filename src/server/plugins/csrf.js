import crumb from '@hapi/crumb'

import { config } from '#/config/config.js'

/**
 * CSRF protection for the POST forms every action goes through.
 *
 * `restful` is deliberately off: the service has to work without JavaScript, so the token
 * travels as a hidden field rather than a header, and the crumb is exposed to Nunjucks so each
 * form can render it.
 */
export const csrf = {
  plugin: crumb,
  options: {
    key: 'crumb',
    cookieOptions: {
      isSecure: config.get('session.cookie.secure'),
      isHttpOnly: true,
      isSameSite: 'Lax',
      path: '/'
    },
    logUnauthorized: true
  }
}
