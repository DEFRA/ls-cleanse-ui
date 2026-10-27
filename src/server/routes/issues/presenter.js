import {
  describeIssueStatus,
  describeWorkflowStatus,
  canMoveTo
} from '#/server/common/constants/workflow.js'

/**
 * Issue ids are opaque digests, so nothing a user reads comes from the id. Everything on screen
 * is projected from the context the rules engine wrote onto the issue.
 */
export function presentIssue(issue) {
  const context = issue.context ?? {}

  return {
    ...issue,
    cph: context.cph,
    ruleNumber: context.ruleNumber,
    errorCode: context.errorCode,
    errorDescription:
      context.errorDescription ?? `Rule ${context.ruleNumber ?? issue.ruleId}`,
    holdingName: context.samFeatureName,
    statusDetail: describeIssueStatus(issue.status),
    workflowDetail: describeWorkflowStatus(issue.workflowStatus),
    isSuppressed: issue.workflowStatus === 'suppressed',
    isInactive: issue.status === 'inactive',
    can: {
      start: canMoveTo(issue.workflowStatus, 'in-progress'),
      resolve: canMoveTo(issue.workflowStatus, 'resolved'),
      ignore: canMoveTo(issue.workflowStatus, 'ignored'),
      suppress: canMoveTo(issue.workflowStatus, 'suppressed'),
      reopen: canMoveTo(issue.workflowStatus, 'todo')
    }
  }
}

/** Keys the rules engine writes for its own bookkeeping; shown elsewhere, not in the evidence. */
const identityKeys = new Set([
  'cph',
  'ruleNumber',
  'errorCode',
  'errorDescription'
])

const labels = {
  ctsLocationNumber: 'Location number',
  ctsPremisesType: 'Premises type',
  ctsCountyName: 'County',
  ctsKeeperSurname: 'Keeper surname',
  ctsKeeperPostCode: 'Postcode',
  samHoldingId: 'Holding ID',
  samFeatureName: 'Holding name',
  samSpeciesCodes: 'Species recorded'
}

/** Turns a camelCase key into something readable when it has no label of its own. */
function humanise(key) {
  const words = key
    .replace(/^(cts|sam)/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim()
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}

function rowsFor(context, prefix) {
  return Object.entries(context)
    .filter(([key]) => !identityKeys.has(key) && key.startsWith(prefix))
    .map(([key, value]) => ({
      key: { text: labels[key] ?? humanise(key) },
      value: { text: value }
    }))
}

/**
 * Splits the issue context into the two systems being compared, which is the comparison the
 * caseworker is actually making. An empty SAM side is itself the finding for rule 2.
 */
export function presentEvidence(issue) {
  const context = issue.context ?? {}

  const other = Object.entries(context)
    .filter(
      ([key]) =>
        !identityKeys.has(key) &&
        !key.startsWith('cts') &&
        !key.startsWith('sam')
    )
    .map(([key, value]) => ({
      key: { text: labels[key] ?? humanise(key) },
      value: { text: value }
    }))

  return {
    cts: rowsFor(context, 'cts'),
    sam: rowsFor(context, 'sam'),
    other
  }
}
