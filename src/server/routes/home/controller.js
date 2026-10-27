import { config } from '#/config/config.js'
import {
  workflowStatuses,
  openWorkflowStatuses,
  describeRunState
} from '#/server/common/constants/workflow.js'

/**
 * Counts only, and only the ones the backend can answer today. Assignment is deliberately
 * absent: there is no user directory yet, so a "yours" figure would be a guess.
 */
function countsByWorkflowStatus(breakdown = []) {
  const active = breakdown.filter((entry) => entry.status === 'active')

  return workflowStatuses.map((status) => ({
    ...status,
    count: active
      .filter((entry) => entry.workflowStatus === status.id)
      .reduce((total, entry) => total + entry.count, 0)
  }))
}

export const homeController = {
  async handler(request, h) {
    const groupId = config.get('cleanse.groupId')
    const summary = await request.cleanse.getGroupSummary(groupId)
    const counts = countsByWorkflowStatus(summary.breakdown)

    const latestRun = summary.latestRun
      ? {
          ...summary.latestRun,
          stateDetail: describeRunState(summary.latestRun.state)
        }
      : null

    return h.view('home/index', {
      pageTitle: 'Cleanse',
      groupId,
      counts,
      openCount: counts
        .filter((status) => openWorkflowStatuses.includes(status.id))
        .reduce((total, status) => total + status.count, 0),
      totalIssues: summary.totalIssues,
      activeIssues: summary.activeIssues,
      inactiveIssues: summary.inactiveIssues,
      latestRun
    })
  }
}
