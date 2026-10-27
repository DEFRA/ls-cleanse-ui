import { config } from '#/config/config.js'
import { describeRunState } from '#/server/common/constants/workflow.js'
import { CleanseApiError } from '#/server/common/helpers/cleanse/client.js'

const pageSize = 20

const decorate = (run) => ({ ...run, stateDetail: describeRunState(run.state) })

export const runsController = {
  async handler(request, h) {
    const groupId = config.get('cleanse.groupId')
    const pageNumber = Math.max(1, Number.parseInt(request.query.page, 10) || 1)

    const runs = await request.cleanse.searchRuns({
      groupId,
      pageNumber,
      pageSize
    })
    const items = runs.items.map(decorate)

    return h.view('admin/runs', {
      pageTitle: 'Runs',
      groupId,
      runs: items,
      total: runs.totalCount,
      inFlight: items.some((run) => run.state === 'running'),
      pagination: buildPagination(
        pageNumber,
        Math.ceil(runs.totalCount / pageSize)
      ),
      notification: request.yar.flash('notification')[0] ?? null,
      error: request.yar.flash('runError')[0] ?? null
    })
  }
}

export const runDetailController = {
  async handler(request, h) {
    const run = decorate(await request.cleanse.getRun(request.params.runId))

    return h.view('admin/run-detail', { pageTitle: `Run ${run.runId}`, run })
  }
}

export const triggerRunController = {
  async handler(request, h) {
    try {
      await request.cleanse.triggerRun()
      request.yar.flash(
        'notification',
        'Rule run started. Refresh to see its progress.'
      )
    } catch (error) {
      if (!(error instanceof CleanseApiError)) {
        throw error
      }

      // 409 means a run is already in flight, 503 means the engine is switched off here.
      request.yar.flash('runError', error.detail ?? error.message)
    }

    return h.redirect('/admin/runs')
  }
}

function buildPagination(pageNumber, totalPages) {
  if (totalPages <= 1) {
    return null
  }

  return {
    previous:
      pageNumber > 1
        ? { href: `/admin/runs?page=${pageNumber - 1}` }
        : undefined,
    next:
      pageNumber < totalPages
        ? { href: `/admin/runs?page=${pageNumber + 1}` }
        : undefined,
    items: Array.from({ length: totalPages }, (_, index) => ({
      number: index + 1,
      href: `/admin/runs?page=${index + 1}`,
      current: index + 1 === pageNumber
    }))
  }
}
