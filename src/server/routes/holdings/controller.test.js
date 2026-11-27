import { vi } from 'vitest'
import { load } from 'cheerio'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { signedIn } from '#/test-helpers/sign-in.js'

const cph = '01/036/8000'
const page = '/holdings/01/036/8000'

const ids = {
  alice: '11111111-1111-4111-8111-111111111111',
  bob: '22222222-2222-4222-8222-222222222222',
  phoned: '33333333-3333-4333-8333-333333333333',
  updated: '44444444-4444-4444-8444-444444444444',
  fixed: '55555555-5555-4555-8555-555555555555',
  died: '66666666-6666-4666-8666-666666666666'
}

const issue = (id, ruleNumber, workflowStatus, extra = {}) => ({
  id,
  groupId: 'cts-sam',
  ruleId: ruleNumber,
  status: 'active',
  workflowStatus,
  version: 3,
  createdAtUtc: '2026-10-12T09:00:00Z',
  updatedAtUtc: '2026-10-13T09:00:00Z',
  context: {
    cph,
    ruleNumber,
    errorCode: `0${ruleNumber}`,
    errorDescription: `Finding ${ruleNumber}`,
    samFeatureName: 'Mount Farm',
    ctsCountyName: 'Devon'
  },
  ...extra
})

const holding = {
  groupId: 'cts-sam',
  cph,
  status: 'in-progress',
  suppressedUntilUtc: null,
  assignedTo: 'Alice Smith',
  assignedUserId: ids.alice,
  assignedUserFullName: 'Alice Smith',
  version: 2,
  issues: [
    issue('3-AAAA', '3', 'todo'),
    issue('10-BBBB', '10', 'in-progress'),
    issue('1-CCCC', '1', 'resolved', {
      status: 'inactive',
      outcomeReason: 'Fixed in SAM',
      outcomeReasonId: ids.fixed
    })
  ],
  notes: [
    {
      id: 'n2',
      text: 'Keeper confirmed they keep cattle.',
      context: 'Recorded: Phoned the keeper',
      issueId: null,
      createdAtUtc: '2026-11-24T10:42:00Z',
      createdById: ids.alice,
      createdByDisplayName: 'Alice Smith'
    },
    {
      id: 'n1',
      text: 'Keeper is away until the end of the month.',
      context: null,
      issueId: '1-CCCC',
      createdAtUtc: '2026-11-03T14:20:00Z',
      createdById: ids.bob,
      createdByDisplayName: 'Bob Jones'
    }
  ],
  history: [
    {
      kind: 'status-changed',
      atUtc: '2026-11-24T10:45:00Z',
      actorDisplayName: 'Alice Smith',
      issueId: '1-CCCC',
      workflowStatus: 'resolved',
      outcomeReason: 'Fixed in SAM',
      actions: []
    },
    {
      kind: 'actions-recorded',
      atUtc: '2026-11-24T10:42:00Z',
      actorDisplayName: 'Alice Smith',
      actions: ['Phoned the keeper', 'Updated SAM']
    },
    {
      kind: 'assignment-changed',
      atUtc: '2026-11-18T09:02:00Z',
      actorDisplayName: 'Bob Jones',
      assignedTo: 'Alice Smith',
      actions: []
    },
    {
      kind: 'contact',
      atUtc: '2026-11-01T00:00:00Z',
      actorDisplayName: 'spol-import',
      issueId: '3-AAAA',
      actions: ['PhoneCall'],
      detail: '1st Contact Date'
    }
  ]
}

const lists = {
  'action-types': [
    { id: ids.phoned, name: 'Phoned the keeper', isActive: true },
    { id: ids.updated, name: 'Updated SAM', isActive: true }
  ],
  'resolved-reasons': [{ id: ids.fixed, name: 'Fixed in SAM', isActive: true }],
  'cant-resolve-reasons': [
    { id: ids.died, name: 'Keeper has died', isActive: true }
  ]
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

/** Answers each backend call the page makes, and records the writes. */
function stubBackend({ current = holding, listsNow = lists, onWrite } = {}) {
  const writes = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init = {}) => {
    const { pathname } = new URL(url)
    const method = init.method ?? 'GET'

    if (method !== 'GET') {
      const write = {
        method,
        pathname,
        headers: init.headers,
        body: JSON.parse(init.body)
      }
      writes.push(write)
      return onWrite ? onWrite(write) : json({ actions: [], ...current })
    }
    if (pathname === '/v1/holdings') {
      return json(current)
    }
    if (pathname === '/v1/users') {
      return json({
        items: [
          { id: ids.alice, fullName: 'Alice Smith' },
          { id: ids.bob, fullName: 'Bob Jones' }
        ],
        totalCount: 2
      })
    }
    if (pathname.startsWith('/v1/lists/')) {
      return json(listsNow[pathname.slice('/v1/lists/'.length)] ?? [])
    }
    if (pathname.startsWith('/v1/issues/')) {
      return json(current.issues[0])
    }
    return json({})
  })
  return writes
}

describe('#holding page', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  const get = (url = page, headers = {}) =>
    server.inject({ method: 'GET', url, headers, auth: signedIn })

  /** Every cookie the responses set, later ones winning, as a browser would send them back. */
  const cookiesFrom = (...responses) =>
    [
      ...new Map(
        responses
          .flatMap((response) => response.headers['set-cookie'] ?? [])
          .map((cookie) => cookie.split(';')[0].split(/=(.*)/s))
      )
    ]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ')

  /** A POST needs a valid crumb, so take one from the rendered page the way a browser would. */
  async function post(payload, url = page) {
    const shown = await get(url)
    const crumb = /name="crumb" value="([^"]+)"/.exec(shown.result)?.[1]
    const response = await server.inject({
      method: 'POST',
      url,
      headers: { cookie: cookiesFrom(shown) },
      payload: { crumb, ...payload },
      auth: signedIn
    })
    response.cookies = cookiesFrom(shown, response)
    return response
  }

  describe('Showing a holding', () => {
    test('Should show the holding, its status and every issue, with the open ones selected', async () => {
      stubBackend()

      const { statusCode, result } = await get()

      expect(statusCode).toBe(statusCodes.ok)
      const $ = load(result)
      expect($('h1').text()).toBe('Mount Farm')
      expect($('.govuk-caption-l').text()).toBe(`CPH ${cph}`)
      expect($('main').text()).toContain('In progress')
      expect($('main').text()).toContain('2 open issues')
      expect($('main').text()).toContain('1 closed')

      const boxes = $('input[name="issues"]')
      expect(boxes.map((_, box) => $(box).val()).get()).toEqual([
        '3:3-AAAA',
        '3:10-BBBB',
        '3:1-CCCC'
      ])
      expect(boxes.map((_, box) => $(box).is(':checked')).get()).toEqual([
        true,
        true,
        false
      ])
      expect($('#issue-1-CCCC').text()).toContain('Reason: Fixed in SAM')
      expect($('#issue-3-AAAA').text()).toContain('Devon')
    })

    test('Should ask which status to give the selected issues, with the reasons for each outcome', async () => {
      stubBackend()

      const $ = load((await get()).result)

      expect(
        $('input[name="workflowStatus"]')
          .map((_, radio) => $(radio).val())
          .get()
      ).toEqual([
        'in-progress',
        'resolved',
        'nonactionable',
        'suppressed',
        'todo'
      ])
      expect(
        $('#resolvedReason option')
          .map((_, option) => $(option).text())
          .get()
      ).toEqual(['No reason given', 'Fixed in SAM'])
      expect($('#cantResolveReason option').last().val()).toBe(ids.died)
      expect($('#period option').length).toBeGreaterThan(1)
    })

    test("Should not offer Can't resolve while it has no reason to choose", async () => {
      stubBackend({ listsNow: { ...lists, 'cant-resolve-reasons': [] } })

      const $ = load((await get()).result)

      expect(
        $('input[name="workflowStatus"]')
          .map((_, radio) => $(radio).val())
          .get()
      ).not.toContain('nonactionable')
    })

    test('Should show the assignee, the actions to record, the notes and the history', async () => {
      stubBackend()

      const $ = load((await get()).result)

      expect($('#userId option:selected').text()).toBe('Alice Smith')
      expect($('input[name="expectedVersion"]').val()).toBe('2')
      expect(
        $('input[name="actionTypes"]')
          .map((_, box) => $(box).val())
          .get()
      ).toEqual([ids.phoned, ids.updated])

      const notes = $('.app-notes__item')
      expect(notes.first().text()).toContain('Recorded: Phoned the keeper')
      expect(notes.last().text()).toContain('Comment on Rule 1')

      const history = $('table tbody tr')
        .map((_, row) => $(row).find('td').last().text().trim())
        .get()
      expect(history).toEqual([
        'Rule 1 moved to Resolved. Reason: Fixed in SAM',
        'Actions: Phoned the keeper, Updated SAM',
        'Assigned to Alice Smith',
        'Rule 3: Phone call (1st Contact Date)'
      ])
    })

    test('Should answer a CPH with no issues with the page not found', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
        new URL(url).pathname === '/v1/holdings'
          ? json(
              { title: 'Not found', code: 'holding.not_found' },
              statusCodes.notFound
            )
          : json({ items: [], totalCount: 0 })
      )

      const { statusCode, result } = await get('/holdings/99/999/9999')

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Page not found')
    })

    test("Should open an issue's holding page at that issue", async () => {
      stubBackend()

      const { statusCode, headers } = await get('/issues/3-AAAA')

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toBe(`${page}#issue-3-AAAA`)
    })
  })

  describe('Changing the status of the selected issues', () => {
    test('Should give every selected issue the new status, reason and note in one call', async () => {
      const writes = stubBackend()

      const { statusCode, headers } = await post({
        form: 'issues',
        issues: ['3:3-AAAA', '3:10-BBBB'],
        workflowStatus: 'resolved',
        resolvedReason: ids.fixed,
        note: 'Fixed both in SAM'
      })

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toBe(page)
      expect(writes).toHaveLength(1)
      expect(writes[0].pathname).toBe('/v1/holdings/workflow-status')
      expect(writes[0].body).toEqual({
        groupId: 'cts-sam',
        cph,
        workflowStatus: 'resolved',
        issues: [
          { id: '3-AAAA', expectedVersion: 3 },
          { id: '10-BBBB', expectedVersion: 3 }
        ],
        reasonId: ids.fixed,
        note: 'Fixed both in SAM'
      })
    })

    test('Should suppress the selected issues until the end of the chosen period', async () => {
      const writes = stubBackend()

      await post({
        form: 'issues',
        issues: '3:3-AAAA',
        workflowStatus: 'suppressed',
        period: '30'
      })

      const until = new Date(writes[0].body.suppressUntilUtc)
      const days = (until - Date.now()) / 86400000
      expect(days).toBeGreaterThan(29.9)
      expect(days).toBeLessThan(30.1)
      expect(writes[0].body.reasonId).toBeUndefined()
    })

    test.each([
      [
        'no issue selected',
        { workflowStatus: 'in-progress' },
        'Select the issues to update'
      ],
      ['no status chosen', { issues: '3:3-AAAA' }, 'Select a new status'],
      [
        "Can't resolve without a reason",
        { issues: '3:3-AAAA', workflowStatus: 'nonactionable' },
        "Select why the issues can't be resolved"
      ],
      [
        'suppression without a period',
        { issues: '3:3-AAAA', workflowStatus: 'suppressed' },
        'Select how long to suppress the issues for'
      ],
      [
        'a resolved issue suppressed',
        {
          issues: ['3:3-AAAA', '3:1-CCCC'],
          workflowStatus: 'suppressed',
          period: '7'
        },
        "Rule 1 is Resolved, so it can't be moved to Suppressed"
      ]
    ])(
      'Should change nothing and explain when there is %s',
      async (_case, payload, message) => {
        const writes = stubBackend()

        const { statusCode, result } = await post({
          form: 'issues',
          ...payload
        })

        expect(statusCode).toBe(statusCodes.badRequest)
        expect(load(result)('.govuk-error-summary').text()).toContain(message)
        expect(writes).toHaveLength(0)
      }
    )

    test('Should keep what was chosen when the form is shown again', async () => {
      stubBackend()

      const { result } = await post({
        form: 'issues',
        issues: '3:1-CCCC',
        workflowStatus: 'nonactionable',
        note: 'Tried everything'
      })

      const $ = load(result)
      expect($('input[value="3:1-CCCC"]').is(':checked')).toBe(true)
      expect($('input[value="3:3-AAAA"]').is(':checked')).toBe(false)
      expect(
        $('input[name="workflowStatus"][value="nonactionable"]').is(':checked')
      ).toBe(true)
      expect($('#issuesNote').text()).toBe('Tried everything')
    })

    test('Should say so, and change nothing, when an issue has changed since the page was shown', async () => {
      stubBackend({
        onWrite: () =>
          json(
            {
              title: 'Conflict',
              code: 'issue.concurrency_conflict',
              subject: '3-AAAA'
            },
            statusCodes.conflict
          )
      })

      const { statusCode, result } = await post({
        form: 'issues',
        issues: '3:3-AAAA',
        workflowStatus: 'in-progress'
      })

      expect(statusCode).toBe(statusCodes.conflict)
      expect(result).toContain(
        'Someone has changed these issues since you opened this page'
      )
    })

    test('Should reject a POST that carries no CSRF token', async () => {
      stubBackend()

      const { statusCode } = await server.inject({
        method: 'POST',
        url: page,
        payload: { form: 'note', text: 'Hello' },
        auth: signedIn
      })

      expect(statusCode).toBe(statusCodes.forbidden)
    })
  })

  describe('Assigning, recording actions and adding notes', () => {
    test('Should assign the holding with the version the page showed', async () => {
      const writes = stubBackend({
        onWrite: () => json({ ...holding, assignedTo: 'Bob Jones', version: 3 })
      })

      const { statusCode, headers } = await post({
        form: 'assignee',
        userId: ids.bob,
        expectedVersion: '2'
      })

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toBe(page)
      expect(writes[0]).toMatchObject({
        method: 'PUT',
        pathname: '/v1/holdings/assignee',
        body: { groupId: 'cts-sam', cph, userId: ids.bob, expectedVersion: 2 }
      })
    })

    test('Should unassign the holding when Unassigned is chosen', async () => {
      const writes = stubBackend({
        onWrite: () => json({ ...holding, assignedTo: null })
      })

      await post({ form: 'assignee', userId: '', expectedVersion: '2' })

      expect(writes[0].body.userId).toBeNull()
    })

    test('Should explain when someone else changed the assignee first', async () => {
      stubBackend({
        onWrite: () =>
          json({ code: 'holding.concurrency_conflict' }, statusCodes.conflict)
      })

      const { statusCode, result } = await post({
        form: 'assignee',
        userId: ids.bob,
        expectedVersion: '2'
      })

      expect(statusCode).toBe(statusCodes.conflict)
      expect(result).toContain(
        'Someone has changed who this holding is assigned to'
      )
    })

    test('Should record each ticked action, with the note', async () => {
      const writes = stubBackend({
        onWrite: () =>
          json(
            { actions: ['Phoned the keeper', 'Updated SAM'], note: null },
            201
          )
      })

      const { statusCode } = await post({
        form: 'actions',
        actionTypes: [ids.phoned, ids.updated],
        note: 'No answer'
      })

      expect(statusCode).toBe(statusCodes.found)
      expect(writes[0]).toMatchObject({
        pathname: '/v1/holdings/actions',
        body: {
          groupId: 'cts-sam',
          cph,
          actionTypeIds: [ids.phoned, ids.updated],
          note: 'No answer'
        }
      })
    })

    test('Should ask for an action when none is ticked', async () => {
      const writes = stubBackend()

      const { statusCode, result } = await post({ form: 'actions', note: 'Hi' })

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('Select at least one action')
      expect(writes).toHaveLength(0)
    })

    test('Should add a note, and refuse an empty one', async () => {
      const writes = stubBackend({ onWrite: () => json({ id: 'n3' }, 201) })

      const empty = await post({ form: 'note', text: '   ' })
      const added = await post({ form: 'note', text: ' Rang the keeper ' })

      expect(empty.statusCode).toBe(statusCodes.badRequest)
      expect(empty.result).toContain('Enter a note')
      expect(added.statusCode).toBe(statusCodes.found)
      expect(writes).toHaveLength(1)
      expect(writes[0]).toMatchObject({
        pathname: '/v1/holdings/notes',
        body: { groupId: 'cts-sam', cph, text: 'Rang the keeper' }
      })
    })

    test('Should say what was done after the change', async () => {
      stubBackend({ onWrite: () => json({ id: 'n3' }, 201) })

      const added = await post({ form: 'note', text: 'Rang the keeper' })
      const shown = await get(page, { cookie: added.cookies })

      expect(load(shown.result)('.govuk-notification-banner').text()).toContain(
        'Note added'
      )
    })
  })
})
