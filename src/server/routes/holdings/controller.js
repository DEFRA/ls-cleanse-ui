import { addDays } from 'date-fns'

import { config } from '#/config/config.js'
import {
  presentIssue,
  presentEvidence,
  holdingPath
} from '../issues/presenter.js'
import { issuesBackLink } from '../issues/list-controller.js'
import { CleanseApiError } from '#/server/common/helpers/cleanse/client.js'
import {
  knownUsers,
  userOptions
} from '#/server/common/helpers/cleanse/known-users.js'
import {
  canMoveTo,
  describeHoldingStatus,
  describeWorkflowStatus,
  holdingUpdates,
  suppressionPeriods
} from '#/server/common/constants/workflow.js'

const noteLimit = 2000

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const contactNames = {
  PhoneCall: 'Phone call',
  LetterSent: 'Letter or email sent'
}

const toArray = (value) => {
  if (value === undefined || value === null || value === '') {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '')

/** The holding a request is about: a CPH within the configured rule group. */
const holdingOf = (request) => ({
  groupId: config.get('cleanse.groupId'),
  cph: request.params.cph
})

/**
 * Each issue checkbox carries the version the page showed as well as the id, so a change made
 * since then is refused rather than overwritten. The version comes first: an id may hold a colon.
 */
function readSelection(value) {
  const at = String(value).indexOf(':')
  const version = Number(String(value).slice(0, at))
  const id = String(value).slice(at + 1)
  return at > 0 && Number.isSafeInteger(version) && id ? { id, version } : null
}

const ruleLabel = (issue) =>
  issue ? `Rule ${issue.ruleNumber ?? issue.ruleId}` : 'An issue'

/** A history entry as the table shows it. Dates are left to the template to format. */
function presentEvent(event, issuesById) {
  const issue = issuesById.get(event.issueId)
  return {
    ...event,
    rule: ruleLabel(issue),
    status: event.workflowStatus
      ? describeWorkflowStatus(event.workflowStatus).name
      : null,
    contact: contactNames[event.actions?.[0]] ?? event.actions?.[0]
  }
}

/** A note, with what it was written with, or which issue an older per-issue comment was on. */
function presentNote(note, issuesById) {
  const issue = note.issueId ? issuesById.get(note.issueId) : null
  return {
    ...note,
    about:
      note.context ?? (note.issueId ? `Comment on ${ruleLabel(issue)}` : null)
  }
}

const reasonItems = (entries, selected, prompt) => [
  { value: '', text: prompt, selected: !selected },
  ...entries.map((entry) => ({
    value: entry.id,
    text: entry.name,
    selected: entry.id === selected
  }))
]

async function load(request) {
  const { groupId, cph } = holdingOf(request)
  const [holding, users, actionTypes, resolvedReasons, cantResolveReasons] =
    await Promise.all([
      request.cleanse.getHolding(groupId, cph),
      knownUsers(request.cleanse),
      request.cleanse.listCodedValues('action-types', { activeOnly: true }),
      request.cleanse.listCodedValues('resolved-reasons', { activeOnly: true }),
      request.cleanse.listCodedValues('cant-resolve-reasons', {
        activeOnly: true
      })
    ])
  return { holding, users, actionTypes, resolvedReasons, cantResolveReasons }
}

/**
 * The holding page, with any errors from a form and what was entered in it. Without a form's
 * values, the open issues are selected, which makes resolving everything one step.
 */
async function render(
  request,
  h,
  { errors = [], values = {}, statusCode = 200 } = {}
) {
  const data = await load(request)
  const { holding } = data
  const issuesById = new Map(
    holding.issues.map((raw) => [raw.id, presentIssue(raw)])
  )
  const issues = [...issuesById.values()].map((issue, index) => ({
    ...issue,
    evidence: presentEvidence(issue),
    checked:
      values.form === 'issues'
        ? (values.issues ?? []).includes(issue.id)
        : issue.isOpen,
    index: index + 1
  }))
  const openCount = issues.filter((issue) => issue.isOpen).length
  const flash = request.yar.flash('notification')
  const name = issues.find((issue) => issue.holdingName)?.holdingName

  return h
    .view('holdings/holding', {
      pageTitle: name ?? `CPH ${holding.cph}`,
      error: errors.length > 0,
      errors: errors.map(({ text, href }) => ({ text, href })),
      fieldError: Object.fromEntries(
        errors.filter((e) => e.field).map((e) => [e.field, e.text])
      ),
      notification: flash.length ? flash[0] : null,
      backLink: issuesBackLink(request.yar.get('lastIssuesQuery')),
      holdingHref: holdingPath(holding.cph),
      holding: {
        ...holding,
        name,
        status: describeHoldingStatus(holding.status),
        openCount,
        closedCount: issues.length - openCount
      },
      issues,
      values,
      updateItems: holdingUpdates
        // Can't resolve needs a reason, so it is only offered while there is one to choose.
        .filter(
          (update) =>
            update.id !== 'nonactionable' || data.cantResolveReasons.length
        )
        .map((update) => ({
          value: update.id,
          text: update.name,
          checked:
            values.form === 'issues' && values.workflowStatus === update.id
        })),
      resolvedReasonItems: data.resolvedReasons.length
        ? reasonItems(
            data.resolvedReasons,
            values.resolvedReason,
            'No reason given'
          )
        : null,
      cantResolveReasonItems: reasonItems(
        data.cantResolveReasons,
        values.cantResolveReason,
        'Select a reason'
      ),
      periodItems: [
        { value: '', text: 'Select a period', selected: !values.period },
        ...suppressionPeriods.map((period) => ({
          value: period.id,
          text: period.name,
          selected: values.period === period.id
        }))
      ],
      assigneeItems: [
        {
          value: '',
          text: 'Unassigned',
          selected: !holding.assignedUserId
        },
        ...userOptions(data.users, holding.assignedUserId)
      ],
      actionTypeItems: data.actionTypes.map((type) => ({
        value: type.id,
        text: type.name,
        checked:
          values.form === 'actions' &&
          (values.actionTypes ?? []).includes(type.id)
      })),
      notes: holding.notes.map((note) => presentNote(note, issuesById)),
      history: holding.history.map((event) => presentEvent(event, issuesById))
    })
    .code(statusCode)
}

function flashAndReturn(request, h, message) {
  request.yar.flash('notification', message)
  return h.redirect(holdingPath(request.params.cph))
}

/** The one API failure a caseworker can act on: someone else got there first. */
const isConflict = (error) =>
  error instanceof CleanseApiError && error.isConflict

const isRefused = (error) =>
  error instanceof CleanseApiError && error.status === 400

/** Checks what the API would refuse, so each issue that cannot move is named, not just the first. */
function validateUpdate(payload, current) {
  const values = {
    form: 'issues',
    issues: [],
    workflowStatus: trimmed(payload.workflowStatus),
    resolvedReason: trimmed(payload.resolvedReason),
    cantResolveReason: trimmed(payload.cantResolveReason),
    period: trimmed(payload.period),
    note: trimmed(payload.note)
  }
  const selection = toArray(payload.issues).map(readSelection)
  values.issues = selection.filter(Boolean).map((issue) => issue.id)

  const errors = []
  const update = holdingUpdates.find((u) => u.id === values.workflowStatus)
  const period = suppressionPeriods.find((p) => p.id === values.period)
  const reasonId =
    update?.id === 'resolved'
      ? values.resolvedReason
      : update?.id === 'nonactionable'
        ? values.cantResolveReason
        : ''

  if (selection.length === 0 || selection.some((issue) => !issue)) {
    errors.push({ text: 'Select the issues to update', href: '#issues' })
  }

  if (!update) {
    errors.push({
      text: 'Select a new status for the issues',
      href: '#workflowStatus',
      field: 'workflowStatus'
    })
  } else if (update.id === 'nonactionable' && !reasonId) {
    errors.push({
      text: "Select why the issues can't be resolved",
      href: '#cantResolveReason',
      field: 'cantResolveReason'
    })
  } else if (update.id === 'suppressed' && !period) {
    errors.push({
      text: 'Select how long to suppress the issues for',
      href: '#period',
      field: 'period'
    })
  }

  if (reasonId && !guid.test(reasonId)) {
    errors.push({
      text: 'Select a reason from the list',
      href: '#workflowStatus'
    })
  }

  if (values.note.length > noteLimit) {
    errors.push({
      text: 'A note can be up to 2,000 characters',
      href: '#issuesNote',
      field: 'issuesNote'
    })
  }

  // The same status again is allowed: it changes an outcome's reason, or a suppression's date.
  if (update && errors.length === 0) {
    for (const { id } of selection) {
      const issue = current.get(id)
      if (
        issue &&
        issue.workflowStatus !== update.id &&
        !canMoveTo(issue.workflowStatus, update.id)
      ) {
        errors.push({
          text: `${ruleLabel(issue)} is ${describeWorkflowStatus(issue.workflowStatus).name}, so it can't be moved to ${update.name}`,
          href: `#issue-${id}`
        })
      }
    }
  }

  return { values, errors, selection, update, period, reasonId }
}

async function updateIssues(request, h) {
  const { groupId, cph } = holdingOf(request)
  const current = new Map(
    (await request.cleanse.getHolding(groupId, cph)).issues.map((raw) => [
      raw.id,
      presentIssue(raw)
    ])
  )
  const { values, errors, selection, update, period, reasonId } =
    validateUpdate(request.payload ?? {}, current)

  if (errors.length) {
    return render(request, h, { errors, values, statusCode: 400 })
  }

  try {
    await request.cleanse.updateHoldingIssues({
      groupId,
      cph,
      workflowStatus: update.id,
      issues: selection.map(({ id, version }) => ({
        id,
        expectedVersion: version
      })),
      reasonId: reasonId || undefined,
      suppressUntilUtc: period
        ? addDays(new Date(), period.days).toISOString()
        : undefined,
      note: values.note || undefined
    })
  } catch (error) {
    if (isConflict(error)) {
      return render(request, h, {
        errors: [
          {
            text: 'Someone has changed these issues since you opened this page, so nothing was changed. Check them and try again.',
            href: '#issues'
          }
        ],
        statusCode: 409
      })
    }
    if (isRefused(error)) {
      const issue = current.get(error.subject)
      return render(request, h, {
        errors: [
          {
            text: `Nothing was changed. ${issue ? `${ruleLabel(issue)}: ` : ''}${error.detail ?? 'The issues could not be updated.'}`,
            href: issue ? `#issue-${issue.id}` : '#issues'
          }
        ],
        values,
        statusCode: 400
      })
    }
    throw error
  }

  const what = plural(selection.length, 'issue')
  const done =
    update.id === 'suppressed'
      ? `${update.done} for ${period.name}`
      : update.done
  return flashAndReturn(request, h, `${what} ${done}`)
}

async function assign(request, h) {
  const { groupId, cph } = holdingOf(request)
  const userId = trimmed(request.payload?.userId)
  const version = Number(request.payload?.expectedVersion)

  if ((userId && !guid.test(userId)) || !Number.isSafeInteger(version)) {
    return render(request, h, {
      errors: [{ text: 'Select a user or Unassigned', href: '#userId' }],
      statusCode: 400
    })
  }

  let holding
  try {
    holding = await request.cleanse.assignHolding({
      groupId,
      cph,
      userId: userId || null,
      expectedVersion: version
    })
  } catch (error) {
    if (isConflict(error)) {
      return render(request, h, {
        errors: [
          {
            text: 'Someone has changed who this holding is assigned to since you opened this page. Check the assignee and try again.',
            href: '#userId'
          }
        ],
        statusCode: 409
      })
    }
    if (isRefused(error)) {
      return render(request, h, {
        errors: [
          {
            text: 'That user is not available for assignment. Select another user.',
            href: '#userId'
          }
        ],
        statusCode: 400
      })
    }
    throw error
  }

  return flashAndReturn(
    request,
    h,
    holding.assignedTo
      ? `Holding assigned to ${holding.assignedTo}`
      : 'Holding unassigned'
  )
}

async function recordActions(request, h) {
  const { groupId, cph } = holdingOf(request)
  const actionTypes = toArray(request.payload?.actionTypes).map(String)
  const note = trimmed(request.payload?.note)
  const values = { form: 'actions', actionTypes, note }
  const errors = []

  if (actionTypes.length === 0 || actionTypes.some((id) => !guid.test(id))) {
    errors.push({ text: 'Select at least one action', href: '#actionTypes' })
  }
  if (note.length > noteLimit) {
    errors.push({
      text: 'A note can be up to 2,000 characters',
      href: '#actionsNote',
      field: 'actionsNote'
    })
  }
  if (errors.length) {
    return render(request, h, { errors, values, statusCode: 400 })
  }

  let recorded
  try {
    recorded = await request.cleanse.recordHoldingActions({
      groupId,
      cph,
      actionTypeIds: actionTypes,
      note: note || undefined
    })
  } catch (error) {
    if (isRefused(error)) {
      return render(request, h, {
        errors: [
          {
            text: error.detail ?? 'The actions could not be recorded.',
            href: '#actionTypes'
          }
        ],
        values,
        statusCode: 400
      })
    }
    throw error
  }

  return flashAndReturn(request, h, `Recorded: ${recorded.actions.join(', ')}`)
}

async function addNote(request, h) {
  const { groupId, cph } = holdingOf(request)
  const text = trimmed(request.payload?.text)
  const values = { form: 'note', text }

  const problem = !text
    ? 'Enter a note'
    : text.length > noteLimit
      ? 'A note can be up to 2,000 characters'
      : null
  if (problem) {
    return render(request, h, {
      errors: [{ text: problem, href: '#noteText', field: 'noteText' }],
      values,
      statusCode: 400
    })
  }

  await request.cleanse.addHoldingNote({ groupId, cph, text })
  return flashAndReturn(request, h, 'Note added')
}

const forms = {
  issues: updateIssues,
  assignee: assign,
  actions: recordActions,
  note: addNote
}

/**
 * The holding page carries four forms, told apart by a hidden field. Each POST redirects back on
 * success, so a refresh never repeats it, and redisplays the page with the error otherwise.
 */
export const holdingController = {
  get: (request, h) => render(request, h),

  post(request, h) {
    const handle = forms[request.payload?.form]
    if (!handle) {
      return render(request, h, {
        errors: [{ text: 'Something went wrong. Try again.', href: '#issues' }],
        statusCode: 400
      })
    }
    return handle(request, h)
  }
}
