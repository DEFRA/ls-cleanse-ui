import { config } from '#/config/config.js'
import { isEntra } from '#/server/plugins/auth.js'
import { presentIssue } from './presenter.js'
import { CleanseApiError } from '#/server/common/helpers/cleanse/client.js'
import {
  knownUsers,
  userOptions
} from '#/server/common/helpers/cleanse/known-users.js'

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function show(request, h, error = null) {
  if (!isEntra()) {
    return h
      .response(
        'User assignment is not available with the current sign-in method.'
      )
      .code(404)
  }
  const [raw, users] = await Promise.all([
    request.cleanse.getIssue(request.params.id),
    knownUsers(request.cleanse)
  ])
  const requested = error
    ? request.payload?.userId
    : (raw.assignedUserId ?? (raw.assignedTo ? undefined : ''))
  const selected =
    requested === '' || users.some((user) => user.id === requested)
      ? requested
      : undefined
  return h
    .view('issues/assign', {
      pageTitle: error ? 'Error: Assign this issue' : 'Assign this issue',
      issue: presentIssue(raw),
      error,
      userItems: [
        {
          value: 'choose',
          text: 'Select a user or Unassigned',
          selected: selected === undefined,
          disabled: true
        },
        { value: '', text: 'Unassigned', selected: selected === '' },
        ...userOptions(users, selected)
      ]
    })
    .code(error ? 400 : 200)
}

export const assignmentController = {
  get: show,
  async post(request, h) {
    if (!isEntra()) {
      return h
        .response(
          'User assignment is not available with the current sign-in method.'
        )
        .code(404)
    }
    const userId = request.payload?.userId
    const version = Number(request.payload?.expectedVersion)
    if (
      typeof userId !== 'string' ||
      (userId !== '' && !guid.test(userId)) ||
      !Number.isSafeInteger(version) ||
      version < 1
    ) {
      return show(
        request,
        h,
        'Select a user and submit the current issue version.'
      )
    }
    try {
      const { tenantId, clientId } = config.get('auth.entra')
      await request.cleanse.assignUser(request.params.id, {
        userId: userId || null,
        tenantId,
        clientId,
        expectedVersion: version
      })
    } catch (error) {
      if (error instanceof CleanseApiError && error.isConflict) {
        return h
          .view('issues/conflict', {
            pageTitle: 'This issue has changed',
            issue: presentIssue(
              await request.cleanse.getIssue(request.params.id)
            )
          })
          .code(409)
      }
      if (error instanceof CleanseApiError && error.status === 400) {
        return show(
          request,
          h,
          'That user is not available for assignment. Select another user.'
        )
      }
      throw error
    }
    request.yar.flash(
      'notification',
      userId ? 'Issue assigned' : 'Issue unassigned'
    )
    return h.redirect(`/issues/${encodeURIComponent(request.params.id)}`)
  }
}
