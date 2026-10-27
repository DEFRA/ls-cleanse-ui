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

/** Human-owned, and orthogonal to the above. A re-detection never changes it. */
export const workflowStatuses = [
  { id: 'todo', name: 'To do', colour: 'blue' },
  { id: 'in-progress', name: 'In progress', colour: 'purple' },
  { id: 'suppressed', name: 'Suppressed', colour: 'yellow' },
  { id: 'resolved', name: 'Resolved', colour: 'green' },
  { id: 'ignored', name: 'Ignored', colour: 'grey' },
  { id: 'nonactionable', name: 'Not actionable', colour: 'orange' }
]

/** The queue a caseworker is actually meant to be working through. */
export const openWorkflowStatuses = ['todo', 'in-progress']

const allowedTransitions = {
  todo: ['in-progress', 'resolved', 'ignored', 'suppressed', 'nonactionable'],
  'in-progress': ['todo', 'resolved', 'ignored', 'suppressed', 'nonactionable'],
  suppressed: ['todo', 'in-progress', 'resolved', 'ignored'],
  resolved: ['todo', 'in-progress', 'ignored'],
  ignored: ['todo', 'in-progress'],
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
 * Suppression is always temporary. To make an issue go away for good a caseworker ignores it,
 * or marks it not actionable.
 */
export const suppressionPeriods = [
  { id: '7', name: '7 days', days: 7 },
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

const byId = (list) => new Map(list.map((item) => [item.id, item]))

const issueStatusesById = byId(issueStatuses)
const workflowStatusesById = byId(workflowStatuses)
const runStatesById = byId(runStates)
const importStatusesById = byId(importStatuses)

const unknown = (id) => ({ id, name: id, colour: 'grey' })

export const describeIssueStatus = (id) =>
  issueStatusesById.get(id) ?? unknown(id)
export const describeWorkflowStatus = (id) =>
  workflowStatusesById.get(id) ?? unknown(id)
export const describeRunState = (id) => runStatesById.get(id) ?? unknown(id)
export const describeImportStatus = (id) =>
  importStatusesById.get(id) ?? unknown(id)
