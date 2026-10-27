import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { CleanseApiError } from '#/server/common/helpers/cleanse/client.js'
import { signedInAsAdmin } from '#/test-helpers/sign-in.js'
import { describeFailure, summarise } from './status-controller.js'

// The credential is swappable per test, so a token that cannot be minted can be simulated.
const { authHeaders } = vi.hoisted(() => ({ authHeaders: vi.fn() }))
vi.mock('../../common/helpers/cleanse/auth.js', () => ({
  createAuthStrategy: () => ({ name: 'stsJwt', headers: authHeaders })
}))

const diagnostics = {
  service: {
    name: 'cleanse',
    version: '0.5.0',
    environment: 'dev',
    runtime: '.NET 10.0.13',
    startedAtUtc: '2026-10-23T08:00:00Z'
  },
  database: {
    provider: 'Postgres',
    target: 'db.example:5432/cleanse',
    state: 'ok',
    detail: '12 issues',
    elapsedMilliseconds: 4.2
  },
  storage: {
    provider: 'S3',
    target: 'dev-cleanse-c63f2',
    state: 'ok',
    detail: 'Bucket reachable in eu-west-2',
    elapsedMilliseconds: 36.4
  },
  krds: {
    provider: 'DataBridge',
    target: 'krds.example',
    state: 'failed',
    detail: 'Unhealthy, 503 from /health.',
    elapsedMilliseconds: 31
  },
  krdsAccess: {
    provider: 'DataBridge',
    target: 'krds.example',
    state: 'ok',
    detail:
      'API key accepted, 200 from /api/etl/staging/sqlite/latest. Latest snapshot views/krds-db_20261019070003.sqlite, 812 MB, last modified 2026-10-19 07:00 UTC',
    elapsedMilliseconds: 85.4
  },
  issues: {
    state: 'ok',
    detail: null,
    total: 12,
    breakdown: [
      { status: 'active', workflowStatus: 'todo', count: 7 },
      { status: 'active', workflowStatus: 'in-progress', count: 3 },
      { status: 'inactive', workflowStatus: 'resolved', count: 2 }
    ]
  },
  lastResetAtUtc: '2026-10-01T09:30:00Z'
}

const healthy = {
  ...diagnostics,
  krds: {
    ...diagnostics.krds,
    state: 'ok',
    detail: 'Healthy, 200 from /health'
  }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

/** The check table, as [state, check, detail] for each row. */
function checksIn(html) {
  return [
    ...html.matchAll(
      /aria-label="([^"]+)">[^<]*<\/span>\s*<\/td>\s*<th scope="row" class="govuk-table__header">([^<]+)<\/th>\s*<td class="govuk-table__cell app-status__detail">([\s\S]*?)<\/td>/g
    )
  ].map(([, state, name, detail]) => [
    state,
    name.trim(),
    detail
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  ])
}

describe('#admin status', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    authHeaders.mockResolvedValue({ authorization: 'Bearer test' })
  })

  const get = (url = '/admin/status') =>
    server.inject({ method: 'GET', url, auth: signedInAsAdmin })

  test('Should check the backend and each of its dependencies', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(diagnostics))

    const { statusCode, result } = await get()

    expect(statusCode).toBe(statusCodes.ok)
    expect(checksIn(result)).toEqual([
      [
        'OK',
        'Cleanse service',
        expect.stringMatching(/^http:\/\/localhost:8085 Answered in \d+ms$/)
      ],
      [
        'OK',
        'Database',
        'Postgres db.example:5432/cleanse 12 issues. Answered in 4ms'
      ],
      [
        'OK',
        'Import storage',
        'S3 dev-cleanse-c63f2 Bucket reachable in eu-west-2. Answered in 36ms'
      ],
      [
        'Problem',
        'KRDS health',
        'DataBridge krds.example Unhealthy, 503 from /health. Answered in 31ms'
      ],
      [
        'OK',
        'KRDS read access',
        'DataBridge krds.example API key accepted, 200 from /api/etl/staging/sqlite/latest. Latest snapshot views/krds-db_20261019070003.sqlite, 812 MB, last modified 2026-10-19 07:00 UTC. Answered in 85ms'
      ]
    ])
  })

  /** The health check is anonymous, so only the read shows whether the key gets the backend in. */
  test('Should show a refused KRDS key as a problem even while KRDS is healthy', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({
        ...healthy,
        krdsAccess: {
          ...diagnostics.krdsAccess,
          state: 'failed',
          detail:
            'The Data Bridge refused the API key, 401 Unauthorized from /api/etl/staging/sqlite/latest. Rules:Krds:ApiKey must be the key the KRDS team issued for this environment.',
          elapsedMilliseconds: 12
        }
      })
    )

    const { result } = await get()

    expect(checksIn(result).slice(-2)).toEqual([
      [
        'OK',
        'KRDS health',
        'DataBridge krds.example Healthy, 200 from /health. Answered in 31ms'
      ],
      [
        'Problem',
        'KRDS read access',
        'DataBridge krds.example The Data Bridge refused the API key, 401 Unauthorized from /api/etl/staging/sqlite/latest. Rules:Krds:ApiKey must be the key the KRDS team issued for this environment. Answered in 12ms'
      ]
    ])
    expect(result).toContain('1 problem')
  })

  test('Should sum up the checks at the top of the page', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(diagnostics))
    expect((await get()).result).toContain('1 problem')

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(healthy))
    expect((await get()).result).toContain('All 5 checks OK')
  })

  test('Should say which build of each service is running, and where', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(healthy))

    const { result } = await get()

    // Front end: the test host has no SERVICE_VERSION or ENVIRONMENT, as locally.
    expect(result).toContain('ls-cleanse-ui')
    expect(result).toContain(process.version)
    expect(result).toContain('local')
    expect(result).toContain('In an encrypted cookie')

    // Back end: as the diagnostics report it.
    expect(result).toContain('0.5.0')
    expect(result).toContain('.NET 10.0.13')
    expect(result).toContain('23 October 2026 at 8:00am')
  })

  test('Should say so when the backend is too old to report a storage check or its build', async () => {
    const { service, storage, ...older } = healthy
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(older))

    const { result } = await get()

    expect(checksIn(result)).toContainEqual([
      'Unknown',
      'Import storage',
      'Not reported by this version of the backend.'
    ])
    expect(result).toContain('does not say which build it is')
  })

  test('Should say so when the backend is too old to check its KRDS key', async () => {
    const { krdsAccess, ...older } = healthy
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(older))

    const { result } = await get()

    expect(checksIn(result)).toContainEqual([
      'Unknown',
      'KRDS read access',
      'Not reported by this version of the backend.'
    ])
    expect(result).toContain('1 not confirmed')
  })

  test('Should count every status against every workflow status, including the empty ones', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(diagnostics))

    const { result } = await get()

    // Workflow statuses with no issues still get a row, so "none suppressed" is readable.
    expect(result).toContain('Suppressed')
    expect(result).toContain('Not actionable')
    expect(result).toContain('12 issues in')
  })

  test('Should report the last reset', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(diagnostics))

    const { result } = await get()

    expect(result).toContain('1 October 2026')
  })

  test('Should say never reset when the backend has no record', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ ...diagnostics, lastResetAtUtc: null })
    )

    const { result } = await get()

    expect(result).toContain('Never reset.')
  })

  /**
   * The point of the page is to be readable when something is broken, so the one dependency it
   * cannot delegate — the backend itself — must degrade rather than throw.
   */
  test('Should still render when the backend cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))

    const { statusCode, result } = await get()

    expect(statusCode).toBe(statusCodes.ok)
    expect(checksIn(result)[0]).toEqual([
      'Problem',
      'Cleanse service',
      'http://localhost:8085 The Cleanse service is unavailable'
    ])
    expect(
      checksIn(result)
        .slice(1)
        .map(([state]) => state)
    ).toEqual(['Unknown', 'Unknown', 'Unknown', 'Unknown'])
    expect(result).toContain('The Cleanse backend did not answer')
    expect(result).toContain('Unknown.')
  })

  /** Deployed, the credential is an STS token; failing to mint one used to break the whole page. */
  test('Should show a credential that cannot be had as a problem, not an error page', async () => {
    authHeaders.mockRejectedValue(
      new Error('Could not load credentials from any providers')
    )
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const { statusCode, result } = await get()

    expect(statusCode).toBe(statusCodes.ok)
    expect(checksIn(result)[0]).toEqual([
      'Problem',
      'Cleanse service',
      'http://localhost:8085 Could not get an STS web identity token: Could not load credentials from any providers'
    ])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('Should mark an unrecognised state as unknown rather than trusting it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({
        ...diagnostics,
        krds: { ...diagnostics.krds, state: 'something-new' }
      })
    )

    const { result } = await get()

    expect(result).toContain('app-status--unknown')
  })
})

describe('#describeFailure', () => {
  test('Should name the expired developer key when going through the gateway', () => {
    const forbidden = new CleanseApiError({ status: 403 })

    expect(describeFailure(forbidden, { gatewayInUse: true })).toContain(
      'Developer keys last 24 hours'
    )
    expect(describeFailure(forbidden)).not.toContain('Developer keys')
  })

  test('Should say a credential was refused rather than echo a bare status', () => {
    expect(describeFailure(new CleanseApiError({ status: 401 }))).toBe(
      "The backend refused this service's credential (401)."
    )
  })

  test("Should otherwise use the backend's own explanation", () => {
    expect(
      describeFailure(
        new CleanseApiError({ status: 503, detail: 'Database is down.' })
      )
    ).toBe('Database is down.')
  })
})

describe('#summarise', () => {
  const states = (...ids) => ids.map((id) => ({ stateDetail: { id } }))

  test('Should put problems first, then anything unconfirmed', () => {
    expect(summarise(states('ok', 'failed', 'unknown', 'failed'))).toEqual({
      colour: 'red',
      text: '2 problems'
    })
    expect(summarise(states('ok', 'unknown'))).toEqual({
      colour: 'grey',
      text: '1 not confirmed'
    })
    expect(summarise(states('ok', 'ok'))).toEqual({
      colour: 'green',
      text: 'All 2 checks OK'
    })
  })
})
