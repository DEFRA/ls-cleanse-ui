import { vi } from 'vitest'

const send = vi.fn()

// Plain functions, not arrows: both are invoked with `new` by the code under test.
vi.mock('@aws-sdk/client-sts', () => ({
  STSClient: class {
    send = send
  },
  GetWebIdentityTokenCommand: vi.fn(function GetWebIdentityTokenCommand(input) {
    this.input = input
  })
}))

const { createAuthStrategy } = await import('./auth.js')
const { GetWebIdentityTokenCommand } = await import('@aws-sdk/client-sts')

describe('#createAuthStrategy', () => {
  test('Should send the shared key when configured for an API key', async () => {
    const strategy = createAuthStrategy('apiKey')

    expect(strategy.name).toBe('apiKey')
    expect(await strategy.headers()).toHaveProperty('x-cleanse-api-key')
  })

  test('Should fall back to the API key for an unrecognised strategy', () => {
    expect(createAuthStrategy('nonsense').name).toBe('apiKey')
  })

  describe('When configured for STS', () => {
    beforeEach(() => {
      send.mockResolvedValue({ WebIdentityToken: 'a.b.c' })
    })

    test('Should present the token as a bearer credential', async () => {
      const strategy = createAuthStrategy('stsJwt')

      expect(await strategy.headers()).toEqual({
        authorization: 'Bearer a.b.c'
      })
    })

    test('Should stay within the 900 second cap and send no tags', async () => {
      await createAuthStrategy('stsJwt').headers()

      const input = GetWebIdentityTokenCommand.mock.calls.at(-1)[0]
      expect(input.DurationSeconds).toBeLessThanOrEqual(900)
      expect(input.SigningAlgorithm).toBe('RS256')
      expect(input).not.toHaveProperty('Tags')
    })

    test('Should reuse a token rather than mint one per request', async () => {
      const strategy = createAuthStrategy('stsJwt')

      await strategy.headers()
      await strategy.headers()

      expect(send).toHaveBeenCalledTimes(1)
    })

    test('Should mint a replacement once the cached token is close to expiry', async () => {
      vi.useFakeTimers()
      try {
        const strategy = createAuthStrategy('stsJwt')
        await strategy.headers()

        // Past the lifetime minus the refresh margin.
        vi.advanceTimersByTime(300_000)
        await strategy.headers()

        expect(send).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
