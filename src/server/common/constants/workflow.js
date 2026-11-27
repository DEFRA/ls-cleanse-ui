/**
 * The vocabulary the backend owns, restated for display.
 *
 * `workflowStatus` is the official name. Some of the team say "substatus"; the wire never does.
 */

/** Machine-owned. Only a rule run moves an issue between these. */
export const issueStatuses = [
  { id: 'active', name: 'Active', colour: 'teal' },
  { id: 'inactive', name: 'Inactive', colour: 'grey' }
]

/**
 * Human-owned, and orthogonal to the above. A re-detection never changes it. `nonactionable` is
 * shown as "Can't resolve": it took in the former Ignored and Not actionable.
 */
export const workflowStatuses = [
  { id: 'todo', name: 'To do', colour: 'blue' },
  { id: 'in-progress', name: 'In progress', colour: 'purple' },
  { id: 'suppressed', name: 'Suppressed', colour: 'yellow' },
  { id: 'resolved', name: 'Resolved', colour: 'green' },
  { id: 'nonactionable', name: "Can't resolve", colour: 'orange' }
]

/** The queue a caseworker is actually meant to be working through. */
export const openWorkflowStatuses = ['todo', 'in-progress']

/** The two outcomes. Each takes a reason from its own admin list. */
export const outcomeStatuses = ['resolved', 'nonactionable']

const allowedTransitions = {
  todo: ['in-progress', 'resolved', 'suppressed', 'nonactionable'],
  'in-progress': ['todo', 'resolved', 'suppressed', 'nonactionable'],
  suppressed: ['todo', 'in-progress', 'resolved', 'nonactionable'],
  resolved: ['todo', 'in-progress', 'nonactionable'],
  nonactionable: ['todo', 'in-progress']
}

/**
 * Whether a move is worth offering. Mirrors WorkflowTransitions in the backend, minus the
 * identity case: the domain accepts a no-op, but a button that changes nothing is just noise.
 */
export function canMoveTo(from, to) {
  return from !== to && (allowedTransitions[from] ?? []).includes(to)
}

/**
 * What a holding's issues can be given in one step, in the order the form offers them. A reason
 * list belongs to each outcome; suppression takes a period instead.
 */
export const holdingUpdates = [
  { id: 'in-progress', name: 'In progress', done: 'moved to In progress' },
  {
    id: 'resolved',
    name: 'Resolved',
    done: 'marked as resolved',
    reasons: 'resolved-reasons'
  },
  {
    id: 'nonactionable',
    name: "Can't resolve",
    done: "marked as Can't resolve",
    reasons: 'cant-resolve-reasons'
  },
  { id: 'suppressed', name: 'Suppressed', done: 'suppressed' },
  { id: 'todo', name: 'To do', done: 'moved back to To do' }
]

/** A holding's status is worked out from its active issues; the backend sends it ready-made. */
export const holdingStatuses = [
  { id: 'todo', name: 'To do', colour: 'blue' },
  { id: 'in-progress', name: 'In progress', colour: 'purple' },
  { id: 'suppressed', name: 'Suppressed', colour: 'yellow' },
  { id: 'closed', name: 'Closed', colour: 'grey' }
]

/**
 * Suppression is always temporary. To make an issue go away for good a caseworker resolves it,
 * or marks it Can't resolve.
 */
export const suppressionPeriods = [
  { id: '7', name: '7 days', days: 7 },
  { id: '14', name: '14 days', days: 14 },
  { id: '30', name: '30 days', days: 30 },
  { id: '90', name: '90 days', days: 90 },
  { id: '180', name: '6 months', days: 180 }
]

export const runStates = [
  { id: 'running', name: 'Running', colour: 'blue' },
  { id: 'completed', name: 'Completed', colour: 'green' },
  { id: 'abandoned', name: 'Abandoned', colour: 'grey' },
  { id: 'failed', name: 'Failed', colour: 'red' },
  { id: 'cancelled', name: 'Cancelled', colour: 'grey' }
]

export const importStatuses = [
  { id: 'pending', name: 'Pending', colour: 'blue' },
  { id: 'processing', name: 'Processing', colour: 'purple' },
  { id: 'completed', name: 'Completed', colour: 'green' },
  { id: 'failed', name: 'Failed', colour: 'red' },
  { id: 'abandoned', name: 'Abandoned', colour: 'grey' }
]

export const datasetStatuses = [
  { id: 'empty', name: 'Empty', colour: 'grey' },
  { id: 'loading', name: 'Loading', colour: 'yellow' },
  { id: 'ready', name: 'Ready', colour: 'green' }
]

const byId = (list) => new Map(list.map((item) => [item.id, item]))

const issueStatusesById = byId(issueStatuses)
const workflowStatusesById = byId(workflowStatuses)
const holdingStatusesById = byId(holdingStatuses)
const runStatesById = byId(runStates)
const importStatusesById = byId(importStatuses)
const datasetStatusesById = byId(datasetStatuses)

// The audit log still says "ignored" for changes made before it merged into Can't resolve.
workflowStatusesById.set('ignored', workflowStatusesById.get('nonactionable'))

const unknown = (id) => ({ id, name: id, colour: 'grey' })

export const describeIssueStatus = (id) =>
  issueStatusesById.get(id) ?? unknown(id)
export const describeWorkflowStatus = (id) =>
  workflowStatusesById.get(id) ?? unknown(id)
export const describeHoldingStatus = (id) =>
  holdingStatusesById.get(id) ?? unknown(id)
export const describeRunState = (id) => runStatesById.get(id) ?? unknown(id)
export const describeImportStatus = (id) =>
  importStatusesById.get(id) ?? unknown(id)
export const describeDatasetStatus = (id) =>
  datasetStatusesById.get(id) ?? unknown(id)
