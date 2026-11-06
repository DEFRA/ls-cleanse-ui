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
 * before the request the token is for, so without this a stalled STS would hold a page open
 * indefinitely.
 */
export const tokenRequestTimeoutMs = 10_000

/**
 * Short-lived JWTs for one audience, signed by AWS with the container credentials CDP provisions,
 * each reused until shortly before it expires. No credential is ever issued, stored or rotated by
 * us. RS256 suits both receivers: the backend, and Entra, which accepts nothing else.
 */
export function createWebIdentityTokenSource({
  audience,
  timeoutMs = tokenRequestTimeoutMs
}) {
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

  return async function token() {
    if (!cached || cached.expiresAt <= Date.now()) {
      cached = await mint()
      logger.debug('Minted a web identity token for %s', audience)
    }

    return cached.token
  }
}
