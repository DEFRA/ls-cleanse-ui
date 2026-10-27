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

const realHistory = {
  items: [
    {
      id: 'h1',
      issueId: 'ISSUEID',
      actionType: 'Comment',
      comments: 'Spoke to Mr Realname on 07700 900123',
      createdAtUtc: '2026-01-03T00:00:00Z',
      createdById: 'real.person@defra.gov.uk',
      createdByDisplayName: 'Real Person'
    }
  ],
  totalCount: 1,
  pageNumber: 1,
  pageSize: 100
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
      subject: 'Real Subject',
      objectId: crypto.randomUUID()
    }
    const calls = {
      searchUsers: vi.fn().mockResolvedValue({ items: [real], totalCount: 1 }),
      searchIssues: vi
        .fn()
        .mockResolvedValue({ items: [realIssue], totalCount: 1 }),
      assignUser: vi.fn().mockResolvedValue(realIssue)
    }
    const wrapped = anonymiseClient(
      { forRequest: () => calls },
      createAnonymiser(key)
    )
    const page = await wrapped.searchUsers()
    const fake = page.items[0]
    expect(fake.id).not.toBe(real.id)
    expect(fake.fullName).not.toBe(real.fullName)
    expect(fake.subject).not.toBe(real.subject)
    expect(fake.objectId).not.toBe(real.objectId)
    await wrapped.assignUser('ISSUEID', { userId: fake.id, expectedVersion: 3 })
    expect(calls.assignUser).toHaveBeenCalledWith('ISSUEID', {
      userId: real.id,
      expectedVersion: 3
    })
    await wrapped.searchIssues({
      assignedUserId: fake.id,
      unassigned: undefined
    })
    expect(calls.searchIssues).toHaveBeenCalledWith({
      assignedUserId: real.id,
      unassigned: undefined,
      searchTerm: undefined
    })
  })
  test('Should refuse to start without a key', () => {
    expect(() => createAnonymiser('')).toThrow(/DEMO_ANONYMISE_KEY/)
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

  test('Should anonymise history, runs and imports', () => {
    const { responses } = createAnonymiser(key)

    const history = responses.getIssueHistory(realHistory)
    expectNoRealValues(JSON.stringify(history))
    expect(history.items[0].actionType).toBe('Comment')

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
      const body = String(url).includes('/history') ? realHistory : realIssue
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('Should render the issue page without any real value', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/issues/ISSUEID',
      auth: signedIn
    })

    expect(response.statusCode).toBe(200)
    expectNoRealValues(response.payload)
    expect(response.payload).toMatch(/CPH 12\/\d{3}\/\d{4}/)
    expect(response.payload).toContain('Bedfordshire')
  })
})
