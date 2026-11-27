/**
 * Dashboard figures as the backend sends them, for three days. They add up: the outcomes match
 * the headline, and the backlog's waterfall goes from its start to its end.
 */

const buckets = [
  { start: '2026-11-25', end: '2026-11-25' },
  { start: '2026-11-26', end: '2026-11-26' },
  { start: '2026-11-27', end: '2026-11-27' }
]

const period = {
  from: '2026-11-25',
  to: '2026-11-27',
  interval: 'day',
  days: 3,
  previousFrom: '2026-11-22',
  previousTo: '2026-11-24',
  hasPrevious: true
}

export const status = {
  groupId: 'cts-sam',
  built: true,
  asAtUtc: '2026-11-27T10:42:00Z',
  builtAtUtc: '2026-11-27T10:40:00Z',
  historyFromUtc: '2026-11-03T01:00:00Z',
  durationMilliseconds: 950,
  issues: 120,
  events: 480,
  mismatches: 0,
  stale: false,
  building: false
}

export const alice = '0a1ce000-0000-4000-8000-000000000001'
export const bob = '0b0b0000-0000-4000-8000-000000000002'
const phoned = 'a0000000-0000-4000-8000-00000000000a'
const updatedSam = 'b0000000-0000-4000-8000-00000000000b'
const fixedInSam = 'c0000000-0000-4000-8000-00000000000c'
const keeperGone = 'd0000000-0000-4000-8000-00000000000d'

const figure = (series, previous) => ({
  value: series.reduce((sum, value) => sum + value, 0),
  previous,
  series
})

export const work = {
  groupId: 'cts-sam',
  status,
  period,
  ruleId: null,
  userId: null,
  buckets,
  headline: {
    resolved: figure([4, 6, 2], 10),
    cantResolve: figure([1, 0, 1], 2),
    holdingsClosed: figure([2, 3, 1], 6),
    actions: figure([5, 7, 3], 12),
    peopleWorking: { value: 2, previous: 2, series: [2, 2, 1] },
    holdingsWorked: { value: 9, previous: 7, series: [4, 5, 2] },
    confirmed: {
      resolved: 12,
      noLongerFound: 9,
      previousResolved: 10,
      previousNoLongerFound: 6
    }
  },
  outcomes: [
    {
      start: '2026-11-25',
      end: '2026-11-25',
      resolved: 4,
      cantResolve: 1,
      reopened: 0,
      suppressed: 1
    },
    {
      start: '2026-11-26',
      end: '2026-11-26',
      resolved: 6,
      cantResolve: 0,
      reopened: 1,
      suppressed: 0
    },
    {
      start: '2026-11-27',
      end: '2026-11-27',
      resolved: 2,
      cantResolve: 1,
      reopened: 0,
      suppressed: 0
    }
  ],
  people: [
    {
      userId: alice,
      name: 'Alice Smith',
      named: true,
      resolved: 8,
      cantResolve: 1,
      suppressed: 1,
      reopened: 1,
      actions: 10,
      notes: 3,
      holdingsWorked: 6,
      holdingsClosed: 4,
      openHoldingsAssigned: 5,
      lastActiveUtc: '2026-11-27T09:15:00Z',
      outcomes: [3, 5, 1]
    },
    {
      userId: bob,
      name: 'Bob Jones',
      named: true,
      resolved: 3,
      cantResolve: 1,
      suppressed: 0,
      reopened: 0,
      actions: 5,
      notes: 1,
      holdingsWorked: 3,
      holdingsClosed: 2,
      openHoldingsAssigned: 0,
      lastActiveUtc: '2026-11-26T15:00:00Z',
      outcomes: [2, 1, 1]
    },
    {
      userId: null,
      name: 'Not named',
      named: false,
      resolved: 1,
      cantResolve: 0,
      suppressed: 0,
      reopened: 0,
      actions: 0,
      notes: 0,
      holdingsWorked: 1,
      holdingsClosed: 0,
      openHoldingsAssigned: 0,
      lastActiveUtc: '2026-11-25T11:00:00Z',
      outcomes: [0, 0, 1]
    }
  ],
  team: {
    people: 2,
    resolved: 12,
    cantResolve: 2,
    suppressed: 1,
    reopened: 1,
    actions: 15,
    notes: 4,
    holdingsWorked: 9,
    holdingsClosed: 6,
    openHoldingsAssigned: 5,
    unassignedOpenHoldings: 7
  },
  actionTypes: [
    { id: phoned, name: 'Phoned the keeper', active: true, count: 9 },
    { id: updatedSam, name: 'Updated SAM', active: false, count: 6 }
  ],
  actionsOverTime: [
    { id: phoned, name: 'Phoned the keeper', points: [3, 4, 2] },
    { id: updatedSam, name: 'Updated SAM', points: [2, 3, 1] }
  ],
  actionsByPerson: [
    { userId: alice, actionTypeId: phoned, count: 6 },
    { userId: alice, actionTypeId: updatedSam, count: 4 },
    { userId: bob, actionTypeId: phoned, count: 3 },
    { userId: bob, actionTypeId: updatedSam, count: 2 }
  ],
  actionsPerHoldingClosed: [
    { band: '0', count: 1 },
    { band: '1', count: 2 },
    { band: '2', count: 2 },
    { band: '3', count: 1 },
    { band: '4', count: 0 },
    { band: '5-or-more', count: 0 }
  ],
  medianActionsPerHoldingClosed: 2,
  resolvedByReason: [
    {
      id: fixedInSam,
      name: 'Fixed in SAM',
      active: true,
      count: 10,
      noLongerFound: 8
    },
    {
      id: null,
      name: 'No reason given',
      active: true,
      count: 2,
      noLongerFound: 1
    }
  ],
  cantResolveByReason: [
    {
      id: keeperGone,
      name: 'Keeper not contactable',
      active: true,
      count: 2,
      noLongerFound: 0
    }
  ],
  transitions: [
    { from: 'todo', to: 'resolved', count: 9 },
    { from: 'in-progress', to: 'resolved', count: 3 },
    { from: 'todo', to: 'nonactionable', count: 2 },
    { from: 'resolved', to: 'todo', count: 1 }
  ],
  timeToOutcome: {
    bands: [
      { band: 'under-1-week', resolved: 2, cantResolve: 0 },
      { band: '1-2-weeks', resolved: 6, cantResolve: 1 },
      { band: '2-4-weeks', resolved: 4, cantResolve: 1 },
      { band: '1-2-months', resolved: 0, cantResolve: 0 },
      { band: '2-3-months', resolved: 0, cantResolve: 0 },
      { band: '3-6-months', resolved: 0, cantResolve: 0 },
      { band: 'over-6-months', resolved: 0, cantResolve: 0 }
    ],
    medianDays: 10,
    percentile85Days: 20
  },
  outcomesByRule: [
    { ruleId: 'rule-1', resolved: 8, cantResolve: 2 },
    { ruleId: 'rule-3', resolved: 4, cantResolve: 0 }
  ],
  markers: [
    { atUtc: '2026-11-26T14:00:00Z', day: '2026-11-26', kind: 'spol-import' }
  ]
}

export const backlog = {
  groupId: 'cts-sam',
  status,
  period,
  unit: 'issues',
  ruleId: null,
  buckets,
  states: ['todo', 'in-progress', 'suppressed', 'resolved', 'nonactionable'],
  byStatus: [
    {
      start: '2026-11-25',
      end: '2026-11-25',
      counts: {
        todo: 50,
        'in-progress': 20,
        suppressed: 3,
        resolved: 30,
        nonactionable: 5
      }
    },
    {
      start: '2026-11-26',
      end: '2026-11-26',
      counts: {
        todo: 46,
        'in-progress': 19,
        suppressed: 3,
        resolved: 36,
        nonactionable: 5
      }
    },
    {
      start: '2026-11-27',
      end: '2026-11-27',
      counts: {
        todo: 45,
        'in-progress': 18,
        suppressed: 3,
        resolved: 38,
        nonactionable: 6
      }
    }
  ],
  activeInactive: [
    {
      start: '2026-11-25',
      end: '2026-11-25',
      active: 108,
      inactive: 10,
      raised: 3,
      cameBack: 0,
      noLongerFound: 1
    },
    {
      start: '2026-11-26',
      end: '2026-11-26',
      active: 109,
      inactive: 11,
      raised: 2,
      cameBack: 1,
      noLongerFound: 2
    },
    {
      start: '2026-11-27',
      end: '2026-11-27',
      active: 110,
      inactive: 10,
      raised: 1,
      cameBack: 0,
      noLongerFound: 0
    }
  ],
  openOverTime: [70, 65, 63],
  openAtStart: 72,
  openAtEnd: 63,
  waterfall: {
    start: 72,
    end: 63,
    steps: [
      { reason: 'raised', up: 6, down: 0 },
      { reason: 'came-back', up: 1, down: 0 },
      { reason: 'reopened', up: 1, down: 0 },
      { reason: 'suppression-ended', up: 0, down: 0 },
      { reason: 'resolved', up: 0, down: 12 },
      { reason: 'cant-resolve', up: 0, down: 2 },
      { reason: 'suppressed', up: 0, down: 1 },
      { reason: 'no-longer-found', up: 0, down: 3 },
      { reason: 'spol', up: 2, down: 1 },
      { reason: 'correction', up: 0, down: 0 }
    ]
  },
  minimumIssueAgeDays: 14,
  age: [
    { band: 'under-1-week', todo: 10, inProgress: 2, tooNewToList: 12 },
    { band: '1-2-weeks', todo: 15, inProgress: 6, tooNewToList: 8 },
    { band: '2-4-weeks', todo: 20, inProgress: 10, tooNewToList: 0 },
    { band: '1-2-months', todo: 0, inProgress: 0, tooNewToList: 0 },
    { band: '2-3-months', todo: 0, inProgress: 0, tooNewToList: 0 },
    { band: '3-6-months', todo: 0, inProgress: 0, tooNewToList: 0 },
    { band: 'over-6-months', todo: 0, inProgress: 0, tooNewToList: 0 }
  ],
  byRule: [
    { ruleId: 'rule-1', todo: 30, inProgress: 12 },
    { ruleId: 'rule-3', todo: 15, inProgress: 6 }
  ],
  oldestOpenHoldings: [
    {
      cph: '01/036/8000',
      status: 'in-progress',
      openIssues: 2,
      firstRaisedAtUtc: '2026-11-03T01:00:00Z',
      assignedUserId: alice,
      assignedTo: 'Alice Smith',
      lastWorkedAtUtc: '2026-11-04T10:00:00Z',
      inProgressSinceUtc: '2026-11-04T10:00:00Z'
    }
  ],
  stalled: {
    days: 14,
    count: 1,
    holdings: [
      {
        cph: '01/036/8000',
        status: 'in-progress',
        openIssues: 2,
        firstRaisedAtUtc: '2026-11-03T01:00:00Z',
        assignedUserId: alice,
        assignedTo: 'Alice Smith',
        lastWorkedAtUtc: '2026-11-04T10:00:00Z',
        inProgressSinceUtc: '2026-11-04T10:00:00Z'
      }
    ]
  },
  unassignedOpenHoldings: 7,
  markers: work.markers
}

export const rules = [
  { ruleId: 'rule-1', ruleNumber: '1', name: 'Missing keeper' },
  { ruleId: 'rule-3', ruleNumber: '3', name: 'Address mismatch' }
]
