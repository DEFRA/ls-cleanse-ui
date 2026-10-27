import yar from '@hapi/yar'

import { config } from '#/config/config.js'

const sessionConfig = config.get('session')

/**
 * The largest sealed session yar keeps in the cookie. Browsers cap a cookie at about 4KB, and the
 * session never holds more than a flash message and the last issues query, so this leaves room.
 */
export const maxSessionCookieBytes = 3500

/**
 * Sessions live in the cookie itself, sealed and encrypted with the cookie password, so there is
 * no session store to run and any instance can read any session.
 *
 * Above maxSessionCookieBytes yar would quietly fall back to a server-side store, which here is
 * the per-instance memory cache: another instance would then not see the session. Callers keep
 * what they store small so that never happens; see lastIssuesQuery in the issues list.
 */
export const session = {
  plugin: yar,
  options: {
    name: 'session',
    maxCookieSize: maxSessionCookieBytes,
    storeBlank: false,
    cache: {
      expiresIn: sessionConfig.cookie.ttl
    },
    cookieOptions: {
      password: sessionConfig.cookie.password,
      ttl: sessionConfig.cookie.ttl,
      isSecure: sessionConfig.cookie.secure,
      clearInvalid: true
    }
  }
}
