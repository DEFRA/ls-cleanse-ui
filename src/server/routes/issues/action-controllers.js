import { addDays } from 'date-fns'

import { loadForAction } from './detail-controller.js'
import { presentIssue } from './presenter.js'
import { suppressionPeriods } from '#/server/common/constants/workflow.js'
import { CleanseApiError } from '#/server/common/helpers/cleanse/client.js'

const commentLimit = 2000

/**
 * Optimistic concurrency is the whole point of carrying the version through the form: if the
 * nightly run or another caseworker has touched the issue since the page was rendered, the
 * backend answers 409 and we say so rather than silently overwriting.
 */
function expectedVersion(payload) {
  const parsed = Number.parseInt(payload?.expectedVersion, 10)
  return Number.isInteger(parsed) ? parsed : undefined
}

function redirectToIssue(request, h, message) {
  request.yar.flash('notification', message)
  return h.redirect(`/issues/${encodeURIComponent(request.params.id)}`)
}

/** A 409 is the one API failure a caseworker can act on, so it gets a page of its own. */
async function withConflictHandling(request, h, work) {
  try {
    return await work()
  } catch (error) {
    if (error instanceof CleanseApiError && error.isConflict) {
      const issue = presentIssue(
        await request.cleanse.getIssue(request.params.id)
      )
      return h
        .view('issues/conflict', { pageTitle: 'This issue has changed', issue })
        .code(409)
    }

    throw error
  }
}

/** Records an optional comment alongside a status change, so the reason is not lost. */
async function addComment(request, comments) {
  const trimmed = (comments ?? '').trim()

  if (trimmed) {
    await request.cleanse.addHistory(request.params.id, {
      actionType: 'Comment',
      comments: trimmed.slice(0, commentLimit)
    })
  }
}

export const startController = {
  handler(request, h) {
    return withConflictHandling(request, h, async () => {
      await request.cleanse.setWorkflowStatus(request.params.id, {
        workflowStatus: 'in-progress',
        expectedVersion: expectedVersion(request.payload)
      })

      return redirectToIssue(request, h, 'Issue moved to In progress')
    })
  }
}

export const reopenController = {
  handler(request, h) {
    return withConflictHandling(request, h, async () => {
      const version = expectedVersion(request.payload)

      // Lifting a suppression is its own operation; setting the status alone would leave the
      // expiry in place and the sweep would take the issue straight back.
      if (request.payload?.suppressed === 'true') {
        await request.cleanse.unsuppress(request.params.id, version)
      } else {
        await request.cleanse.setWorkflowStatus(request.params.id, {
          workflowStatus: 'todo',
          expectedVersion: version
        })
      }

      return redirectToIssue(request, h, 'Issue moved back to To do')
    })
  }
}

export const resolveController = {
  get(request, h) {
    return loadForAction(request, h, {
      target: 'resolve',
      view: 'issues/resolve',
      pageTitle: 'Mark as resolved'
    })
  },

  post(request, h) {
    return withConflictHandling(request, h, async () => {
      await request.cleanse.setWorkflowStatus(request.params.id, {
        workflowStatus: 'resolved',
        expectedVersion: expectedVersion(request.payload)
      })
      await addComment(request, request.payload?.comments)

      return redirectToIssue(request, h, 'Issue marked as resolved')
    })
  }
}

export const ignoreController = {
  get(request, h) {
    return loadForAction(request, h, {
      target: 'ignore',
      view: 'issues/ignore',
      pageTitle: 'Ignore this issue'
    })
  },

  post(request, h) {
    return withConflictHandling(request, h, async () => {
      await request.cleanse.setWorkflowStatus(request.params.id, {
        workflowStatus: 'ignored',
        expectedVersion: expectedVersion(request.payload)
      })
      await addComment(request, request.payload?.comments)

      return redirectToIssue(request, h, 'Issue ignored')
    })
  }
}

export const suppressController = {
  get(request, h) {
    return loadForAction(request, h, {
      target: 'suppress',
      view: 'issues/suppress',
      pageTitle: 'Suppress this issue',
      extra: {
        periodItems: suppressionPeriods.map((p) => ({
          value: p.id,
          text: p.name
        }))
      }
    })
  },

  post(request, h) {
    return withConflictHandling(request, h, async () => {
      const period = suppressionPeriods.find(
        (p) => p.id === request.payload?.period
      )

      if (!period) {
        const issue = presentIssue(
          await request.cleanse.getIssue(request.params.id)
        )

        return h
          .view('issues/suppress', {
            pageTitle: 'Suppress this issue',
            issue,
            periodItems: suppressionPeriods.map((p) => ({
              value: p.id,
              text: p.name
            })),
            comments: request.payload?.comments,
            error: 'Select how long to suppress this issue for'
          })
          .code(400)
      }

      await request.cleanse.suppress(request.params.id, {
        expiresAtUtc: addDays(new Date(), period.days).toISOString(),
        expectedVersion: expectedVersion(request.payload)
      })
      await addComment(request, request.payload?.comments)

      return redirectToIssue(request, h, `Issue suppressed for ${period.name}`)
    })
  }
}

export const noteController = {
  async get(request, h) {
    const issue = presentIssue(
      await request.cleanse.getIssue(request.params.id)
    )
    return h.view('issues/note', { pageTitle: 'Add a note', issue })
  },

  async post(request, h) {
    const comments = (request.payload?.comments ?? '').trim()

    if (!comments) {
      const issue = presentIssue(
        await request.cleanse.getIssue(request.params.id)
      )

      return h
        .view('issues/note', {
          pageTitle: 'Add a note',
          issue,
          error: 'Enter a note'
        })
        .code(400)
    }

    await addComment(request, comments)
    return redirectToIssue(request, h, 'Note added')
  }
}
