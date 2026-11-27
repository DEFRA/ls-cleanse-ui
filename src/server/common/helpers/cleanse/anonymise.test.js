import { vi } from 'vitest'

import { anonymiseClient, createAnonymiser } from './anonymise.js'
import { createCleanseClient } from './client.js'
import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { signedIn } from '#/test-helpers/sign-in.js'

const key = 'test-demo-key'

const realIssue = {
  id: 'ISSUEID',
  groupId: 'cts-sam',
  ruleId: 'rule-02',
  status: 'active',
  workflowStatus: 'todo',
  assignedTo: 'Real Assignee',
  notes: 'Real internal note about Mr Realname',
  externalNotes: 'Real SPOL note about Mr Realname',
  context: {
    cph: '12/345/6789',
    ruleNumber: '2',
    errorCode: '02',
    errorDescription: 'CTS-CPH-missing-in-Sam',
    ctsLocationNumber: 'AH-12/345/6789',
    ctsPremisesType: 'AH',
    ctsCountyName: 'Bedfordshire',
    ctsKeeperSurname: 'REALNAME',
    ctsKeeperPostCode: 'ZZ9 9ZZ',
    samHoldingId: 'a8c4dd20-10ad-5f1e-86b3-9b0fdc54db57',
    samFeatureName: 'Realplace Farm',
    samSpeciesCodes: 'CHK,SHP',
    samSomethingNew: 'Realvalue 42'
  },
  createdAtUtc: '2026-01-01T00:00:00Z',
  updatedAtUtc: '2026-01-02T00:00:00Z',
  version: 3
}

const realHolding = {
  groupId: 'cts-sam',
  cph: '12/345/6789',
  status: 'todo',
  assignedTo: 'Real Assignee',
  assignedUserId: 'a1b2c3d4-0000-4000-8000-000000000001',
  assignedUserFullName: 'Real Assignee',
  version: 2,
  issues: [realIssue],
  notes: [
    {
      id: 'n1',
      text: 'Spoke to Mr Realname on 07700 900123',
      context: 'Recorded: Phoned the keeper',
      createdAtUtc: '2026-01-03T00:00:00Z',
      createdById: 'real.person@defra.gov.uk',
      createdByDisplayName: 'Real Person'
    }
  ],
  history: [
    {
      kind: 'actions-recorded',
      atUtc: '2026-01-03T00:00:00Z',
      actorId: 'real.person@defra.gov.uk',
      actorDisplayName: 'Real Person',
      actions: ['Phoned the keeper']
    },
    {
      kind: 'assignment-changed',
      atUtc: '2026-01-02T00:00:00Z',
      actorId: 'real.person@defra.gov.uk',
      actorDisplayName: 'Real Person',
      assignedTo: 'Real Assignee',
      actions: []
    }
  ]
}

const realValues = [
  '12/345/6789',
  'Real Assignee',
  'Realname',
  'REALNAME',
  'ZZ9 9ZZ',
  'a8c4dd20-10ad-5f1e-86b3-9b0fdc54db57',
  'Realplace',
  'Realvalue',
  '07700 900123',
  'real.person@defra.gov.uk',
  'Real Person'
]

function expectNoRealValues(text) {
  for (const value of realValues) {
    expect(text).not.toContain(value)
  }
}

describe('#createAnonymiser', () => {
  test('Should hide login identities and reverse fake assignment IDs', async () => {
    const real = {
      id: crypto.randomUUID(),
      fullName: 'Real Person',
      email: 'real.person@defra.gov.uk',
      subject: 'Real Subject',
      objectId: crypto.randomUUID()
    }
    const calls = {
      searchUsers: vi.fn().mockResolvedValue({ items: [real], totalCount: 1 }),
      registerUsers: vi
        .fn()
        .mockResolvedValue({ created: [real], existing: [real] }),
      searchIssues: vi
        .fn()
        .mockResolvedValue({ items: [realIssue], totalCount: 1 }),
      assignHolding: vi.fn().mockResolvedValue({
        cph: realIssue.context.cph,
        assignedTo: real.fullName,
        assignedUserId: real.id,
        assignedUserFullName: real.fullName,
        version: 1
      })
    }
    const wrapped = anonymiseClient(
      { forRequest: () => calls },
      createAnonymiser(key)
    )
    const page = await wrapped.searchUsers()
    const fake = page.items[0]
    expect(fake.id).not.toBe(real.id)
    expect(fake.fullName).not.toBe(real.fullName)
    expect(fake.email).not.toBe(real.email)
    expect(fake.email).toMatch(/@example\.test$/)
    expect(fake.subject).not.toBe(real.subject)
    expect(fake.objectId).not.toBe(real.objectId)
    const registered = await wrapped.registerUsers({ emails: [real.email] })
    expect(registered.created[0]).toEqual(fake)
    expect(registered.existing[0]).toEqual(fake)
    const shown = (await wrapped.searchIssues({})).items[0]
    const assigned = await wrapped.assignHolding({
      groupId: 'cts-sam',
      cph: shown.context.cph,
      userId: fake.id,
      expectedVersion: 0
    })
    expect(calls.assignHolding).toHaveBeenCalledWith({
      groupId: 'cts-sam',
      cph: realIssue.context.cph,
      userId: real.id,
      expectedVersion: 0
    })
    expectNoRealValues(JSON.stringify(assigned))
    expect(assigned.assignedUserId).toBe(fake.id)
    await wrapped.searchIssues({
      assignedUserId: fake.id,
      unassigned: undefined
    })
    expect(calls.searchIssues).toHaveBeenLastCalledWith({
      assignedUserId: real.id,
      unassigned: undefined,
      searchTerm: undefined
    })
  })

  test('Should name the real person behind a fake signed-in id, and nobody it cannot map back', async () => {
    const anonymiser = createAnonymiser(key)
    const real = { id: crypto.randomUUID(), fullName: 'Real Person' }
    const fake = anonymiser.responses.recordLogin(real)
    const forRequest = vi.fn(() => ({}))
    const client = anonymiseClient({ forRequest }, anonymiser)

    client.forRequest('trace', { actingUserId: () => fake.id })
    client.forRequest('trace', { actingUserId: crypto.randomUUID() })

    expect(forRequest.mock.calls[1][1].actingUserId()).toBe(real.id)
    expect(forRequest.mock.calls[2][1].actingUserId()).toBeUndefined()
  })
  test('Should refuse to start without a key', () => {
    expect(() => createAnonymiser('')).toThrow(/DEMO_ANONYMISE_KEY/)
  })

  test('Should anonymise a grouped search with the same fake CPH as its issues', async () => {
    const searchIssuesByCph = vi.fn(async () => ({
      items: [
        {
          cph: realIssue.context.cph,
          issueCount: 1,
          latestUpdatedAtUtc: realIssue.updatedAtUtc,
          issues: [realIssue]
        }
      ],
      totalCount: 1
    }))
    const wrapped = anonymiseClient(
      { forRequest: () => ({ searchIssuesByCph }) },
      createAnonymiser(key)
    )

    const page = await wrapped.searchIssuesByCph({})
    const group = page.items[0]

    expectNoRealValues(JSON.stringify(page))
    expect(group.cph).toBe(group.issues[0].context.cph)

    await wrapped.searchIssuesByCph({ searchTerm: group.cph })
    expect(searchIssuesByCph).toHaveBeenLastCalledWith({
      assignedUserId: undefined,
      searchTerm: realIssue.context.cph
    })
  })

  test('Should give the same fakes for the same key, and different ones for another key', () => {
    const first = createAnonymiser(key).responses.getIssue(realIssue)
    const again = createAnonymiser(key).responses.getIssue(realIssue)
    const other = createAnonymiser('another-key').responses.getIssue(realIssue)

    expect(again).toEqual(first)
    expect(other.context.cph).not.toBe(first.context.cph)
  })

  test('Should replace every personal field and keep the rule fields', () => {
    const issue = createAnonymiser(key).responses.getIssue(realIssue)

    expectNoRealValues(JSON.stringify(issue))
    expect(issue.context).toMatchObject({
      ruleNumber: '2',
      errorCode: '02',
      errorDescription: 'CTS-CPH-missing-in-Sam',
      ctsPremisesType: 'AH',
      ctsCountyName: 'Bedfordshire',
      samSpeciesCodes: 'CHK,SHP'
    })
    expect(issue.id).toBe('ISSUEID')
    expect(issue.version).toBe(3)
  })

  test('Should keep formats realistic and consistent with each other', () => {
    const { context } = createAnonymiser(key).responses.getIssue(realIssue)

    // The county prefix survives, and the location number embeds the same fake CPH.
    expect(context.cph).toMatch(/^12\/\d{3}\/\d{4}$/)
    expect(context.ctsLocationNumber).toBe(`AH-${context.cph}`)
    expect(context.ctsKeeperSurname).toBe(
      context.ctsKeeperSurname.toUpperCase()
    )
    expect(context.ctsKeeperPostCode).toMatch(/^[A-Z0-9]{2,4} [A-Z0-9]{3}$/)
    expect(context.samHoldingId).toMatch(/^[0-9a-f-]{36}$/)
    expect(context.samFeatureName).not.toBe('')
  })

  test('Should mask a context key it does not know, keeping its shape', () => {
    const { context } = createAnonymiser(key).responses.getIssue(realIssue)

    expect(context.samSomethingNew).toMatch(/^[A-Z][a-z]{8} \d{2}$/)
  })

  test('Should anonymise holdings, runs and imports', () => {
    const { responses } = createAnonymiser(key)

    const holding = responses.getHolding(realHolding)
    expectNoRealValues(JSON.stringify(holding))
    expect(holding.notes[0].context).toBe('Recorded: Phoned the keeper')
    expect(holding.history[0].actions).toEqual(['Phoned the keeper'])
    expect(holding.cph).toBe(holding.issues[0].context.cph)
    expectNoRealValues(
      JSON.stringify(responses.addHoldingNote(realHolding.notes[0]))
    )
    expectNoRealValues(
      JSON.stringify(
        responses.updateHoldingIssues({
          issues: [realIssue],
          note: realHolding.notes[0]
        })
      )
    )

    expect(
      responses.getRun({ runId: 'r1', failureMessage: 'Bad CPH 12/345/6789' })
    ).toEqual({ runId: 'r1', failureMessage: 'Hidden in demo mode.' })

    const job = responses.getImport({
      fileName: 'Realname extract.csv',
      requestedBy: 'Real Person',
      totalRows: 10
    })
    expectNoRealValues(JSON.stringify(job))
    expect(job.fileName).toMatch(/^spol-extract-[a-z0-9]{6}\.csv$/)
    expect(job.totalRows).toBe(10)

    expect(
      responses.getImportRejections({
        items: [{ rowNumber: 4, reason: 'issue_not_found', detail: 'Realname' }]
      }).items[0]
    ).toEqual({
      rowNumber: 4,
      reason: 'issue_not_found',
      detail: 'Hidden in demo mode.'
    })
  })

  test('Should leave nulls and missing fields alone', () => {
    const { responses } = createAnonymiser(key)

    expect(responses.getIssue({ id: 'x', notes: null })).toEqual({
      id: 'x',
      notes: null
    })
    expect(responses.getGroupSummary({ latestRun: null })).toEqual({
      latestRun: null
    })
  })

  test('Should turn a fake shown on screen back into the real search term', () => {
    const anonymiser = createAnonymiser(key)
    const { context } = anonymiser.responses.getIssue(realIssue)

    expect(anonymiser.realSearchTerm(context.cph)).toBe('12/345/6789')
    expect(anonymiser.realSearchTerm(` ${context.ctsKeeperPostCode} `)).toBe(
      'ZZ9 9ZZ'
    )
    expect(
      anonymiser.realSearchTerm(context.ctsKeeperSurname.toLowerCase())
    ).toBe('REALNAME')
    expect(anonymiser.realSearchTerm('unknown')).toBe('unknown')
  })
})

describe('#anonymiseClient', () => {
  const auth = { headers: async () => ({}) }

  test('Should have a rule for every client method', () => {
    expect(() =>
      anonymiseClient(
        createCleanseClient({ baseUrl: 'http://backend', auth }),
        createAnonymiser(key)
      )
    ).not.toThrow()
  })

  test('Should refuse a client method it has no rule for', () => {
    const client = { forRequest: () => ({ getSecrets: async () => ({}) }) }

    expect(() => anonymiseClient(client, createAnonymiser(key))).toThrow(
      /getSecrets/
    )
  })

  test('Should search the backend with the real value behind a fake', async () => {
    const anonymiser = createAnonymiser(key)
    const searchIssues = vi.fn(async () => ({ items: [realIssue] }))
    const client = anonymiseClient(
      { forRequest: () => ({ searchIssues }) },
      anonymiser
    )

    const fakeCph = anonymiser.responses.getIssue(realIssue).context.cph
    const result = await client
      .forRequest('trace')
      .searchIssues({ searchTerm: fakeCph, pageSize: 5 })

    expect(searchIssues).toHaveBeenCalledWith({
      searchTerm: '12/345/6789',
      pageSize: 5
    })
    expect(result.items[0].context.cph).toBe(fakeCph)
  })
})

describe('#demo anonymisation end to end', () => {
  let server

  beforeAll(async () => {
    config.set('demo.anonymise', true)
    config.set('demo.anonymiseKey', key)
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
    config.set('demo.anonymise', false)
    config.set('demo.anonymiseKey', '')
  })

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const path = new URL(url).pathname
      const body =
        path === '/v1/holdings'
          ? realHolding
          : path === '/v1/users'
            ? { items: [], totalCount: 0 }
            : path.startsWith('/v1/lists/')
              ? []
              : realIssue
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('Should open the holding page from an issue without any real value', async () => {
    const redirect = await server.inject({
      method: 'GET',
      url: '/issues/ISSUEID',
      auth: signedIn
    })
    expect(redirect.statusCode).toBe(302)
    expect(redirect.headers.location).toMatch(
      /^\/holdings\/12\/\d{3}\/\d{4}#issue-ISSUEID$/
    )
    expectNoRealValues(redirect.headers.location)

    const response = await server.inject({
      method: 'GET',
      url: redirect.headers.location.split('#')[0],
      auth: signedIn
    })

    expect(response.statusCode).toBe(200)
    expectNoRealValues(response.payload)
    expect(response.payload).toMatch(/CPH 12\/\d{3}\/\d{4}/)
    expect(response.payload).toContain('Bedfordshire')

    // The backend is asked for the holding the fake CPH stands for.
    const asked = globalThis.fetch.mock.calls
      .map(([url]) => new URL(url))
      .find((url) => url.pathname === '/v1/holdings')
    expect(asked.searchParams.get('cph')).toBe('12/345/6789')
  })
})
