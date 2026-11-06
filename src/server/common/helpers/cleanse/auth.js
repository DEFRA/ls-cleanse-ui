import { config } from '#/config/config.js'
import {
  createWebIdentityTokenSource,
  tokenRequestTimeoutMs
} from '#/server/common/helpers/web-identity-token.js'

export { tokenRequestTimeoutMs }

/**
 * Sends the shared key. The backend compares it in constant time against its own copy.
 */
function apiKeyStrategy() {
  const key = config.get('cleanse.apiKey')

  return {
    name: 'apiKey',
    async headers() {
      return { 'x-cleanse-api-key': key }
    }
  }
}

/**
 * Presents a short-lived JWT from STS, signed by AWS with the container credentials CDP
 * provisions. No credential is ever issued, stored or rotated by us.
 */
function stsJwtStrategy({ timeoutMs = tokenRequestTimeoutMs } = {}) {
  const token = createWebIdentityTokenSource({
    audience: config.get('cleanse.audience'),
    timeoutMs
  })

  return {
    name: 'stsJwt',
    async headers() {
      return { authorization: `Bearer ${await token()}` }
    }
  }
}

/**
 * `options.timeoutMs` exists for tests; production always uses `tokenRequestTimeoutMs`.
 */
export function createAuthStrategy(
  strategy = config.get('cleanse.auth'),
  options = {}
) {
  return strategy === 'stsJwt' ? stsJwtStrategy(options) : apiKeyStrategy()
}
