import {
  describeIssueStatus,
  describeWorkflowStatus,
  describeHoldingStatus,
  outcomeStatuses,
  openWorkflowStatuses
} from '#/server/common/constants/workflow.js'

/**
 * The holding page for a CPH. A CPH has slashes in it, and each part is encoded on its own so
 * they stay path separators. Issues with no CPH have no holding.
 */
export function holdingPath(cph) {
  return cph
    ? `/holdings/${String(cph).split('/').map(encodeURIComponent).join('/')}`
    : null
}

/** Why an issue has its outcome. Can't resolve always gives one, except where it predates them. */
function outcomeReasonOf(issue) {
  if (!outcomeStatuses.includes(issue.workflowStatus)) {
    return null
  }
  if (issue.outcomeReason) {
    return issue.outcomeReason
  }
  return issue.workflowStatus === 'nonactionable' ? 'No reason given' : null
}

/**
 * Issue ids are opaque digests, so nothing a user reads comes from the id. Everything on screen
 * is projected from the context the rules engine wrote onto the issue.
 */
export function presentIssue(issue) {
  const context = issue.context ?? {}
  const holding = holdingPath(context.cph)

  return {
    ...issue,
    cph: context.cph,
    ruleNumber: context.ruleNumber,
    errorCode: context.errorCode,
    errorDescription:
      context.errorDescription ?? `Rule ${context.ruleNumber ?? issue.ruleId}`,
    holdingName: context.samFeatureName,
    holdingHref: holding,
    // Opens the holding page at this issue.
    href: holding ? `${holding}#issue-${issue.id}` : null,
    statusDetail: describeIssueStatus(issue.status),
    workflowDetail: describeWorkflowStatus(issue.workflowStatus),
    reason: outcomeReasonOf(issue),
    isSuppressed: issue.workflowStatus === 'suppressed',
    isInactive: issue.status === 'inactive',
    // Open is what the triage queue works through, and what the holding page selects to start.
    isOpen:
      issue.status === 'active' &&
      openWorkflowStatuses.includes(issue.workflowStatus)
  }
}

/** One CPH in the grouped list. The holding name is the first one any of its issues carries. */
export function presentCphGroup(group) {
  const issues = (group.issues ?? []).map(presentIssue)

  return {
    cph: group.cph,
    issueCount: group.issueCount,
    latestUpdatedAtUtc: group.latestUpdatedAtUtc,
    holdingName: issues.find((issue) => issue.holdingName)?.holdingName,
    holdingHref: holdingPath(group.cph),
    holdingStatus: group.holdingStatus
      ? describeHoldingStatus(group.holdingStatus)
      : null,
    assignedTo: group.assignedTo,
    suppressedUntilUtc: group.suppressedUntilUtc,
    issues
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
