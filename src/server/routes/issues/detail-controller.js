import { presentIssue, presentEvidence } from './presenter.js'
import { issuesBackLink } from './list-controller.js'
import { describeWorkflowStatus } from '#/server/common/constants/workflow.js'
import { isEntra } from '#/server/plugins/auth.js'

const historyActions = {
  Comment: 'Note added',
  PhoneCall: 'Phone call',
  LetterSent: 'Letter or email sent'
}

export const detailController = {
  async handler(request, h) {
    const { id } = request.params

    const [raw, history] = await Promise.all([
      request.cleanse.getIssue(id),
      request.cleanse.getIssueHistory(id, { pageSize: 100 })
    ])

    const issue = presentIssue(raw)
    const flash = request.yar.flash('notification')

    return h.view('issues/detail', {
      pageTitle: `${issue.cph ?? 'Issue'} - ${issue.errorDescription}`,
      issue,
      canAssign: isEntra(),
      evidence: presentEvidence(raw),
      history: history.items
        .map((entry) => ({
          ...entry,
          actionName: historyActions[entry.actionType] ?? entry.actionType
        }))
        .reverse(),
      notification: flash.length ? flash[0] : null,
      backLink: issuesBackLink(request.yar.get('lastIssuesQuery'))
    })
  }
}

/**
 * Shared by every action page: fetches the issue, and refuses to render a form for a move the
 * domain would reject anyway.
 */
export async function loadForAction(
  request,
  h,
  { target, view, pageTitle, extra = {} }
) {
  const issue = presentIssue(await request.cleanse.getIssue(request.params.id))

  if (target && !issue.can[target]) {
    return h
      .view('issues/not-allowed', {
        pageTitle: 'You cannot do that',
        issue,
        attempted: describeWorkflowStatus(target).name
      })
      .code(409)
  }

  return h.view(view, { pageTitle, issue, ...extra })
}
