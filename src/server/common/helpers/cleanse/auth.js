import { STSClient, GetWebIdentityTokenCommand } from '@aws-sdk/client-sts'

import { config } from '#/config/config.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

const logger = createLogger()

/**
 * STS caps a web identity token at 900 seconds. Asking for more fails with a misleading
 * "no identity-based policy allows the sts:GetWebIdentityToken action".
 */
const tokenLifetimeSeconds = 300

/** Re-mint this long before expiry, so a token never expires mid-flight. */
const refreshMarginMs = 30_000

/**
 * STS answers in well under a second. The AWS SDK sets no timeout of its own, and this call runs
 * before the backend request's own timeout starts, so without this a stalled STS would hold a
 * page open indefinitely.
 */
export const tokenRequestTimeoutMs = 10_000

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
 * Asks STS for a short-lived JWT signed by AWS, using the container credentials CDP provisions.
 * No credential is ever issued, stored or rotated by us.
 */
function stsJwtStrategy({ timeoutMs = tokenRequestTimeoutMs } = {}) {
  const audience = config.get('cleanse.audience')
  const client = new STSClient({ region: config.get('aws.region') })

  let cached = null

  async function mint() {
    const { WebIdentityToken } = await client.send(
      new GetWebIdentityTokenCommand({
        SigningAlgorithm: 'RS256',
        Audience: [audience],
        DurationSeconds: tokenLifetimeSeconds
        // Tags are deliberately absent: supplying them is rejected by STS.
      }),
      { abortSignal: AbortSignal.timeout(timeoutMs) }
    )

    return {
      token: WebIdentityToken,
      expiresAt: Date.now() + tokenLifetimeSeconds * 1000 - refreshMarginMs
    }
  }

  return {
    name: 'stsJwt',
    async headers() {
      if (!cached || cached.expiresAt <= Date.now()) {
        cached = await mint()
        logger.debug('Minted a web identity token for %s', audience)
      }

      return { authorization: `Bearer ${cached.token}` }
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
