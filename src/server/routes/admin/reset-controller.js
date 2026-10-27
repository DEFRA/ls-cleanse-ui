import { config } from '#/config/config.js'
import { CleanseApiError } from '#/server/common/helpers/cleanse/client.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

const logger = createLogger()

function render(h, { error = null, scope = 'group' } = {}) {
  const view = h.view('admin/reset', {
    pageTitle: 'Reset the database',
    groupId: config.get('cleanse.groupId'),
    scope,
    error
  })

  return error ? view.code(400) : view
}

export const resetController = {
  handler: (_request, h) => render(h)
}

export const performResetController = {
  async handler(request, h) {
    const resetKey = (request.payload?.resetKey ?? '').trim()
    const scope = request.payload?.scope === 'all' ? 'all' : 'group'

    if (!resetKey) {
      return render(h, { error: 'Enter the reset key', scope })
    }

    try {
      const result = await request.cleanse.reset({
        groupId: scope === 'all' ? null : config.get('cleanse.groupId'),
        resetKey
      })

      // Deliberately not logging the key, only that a wipe happened and how much it took.
      logger.warn(
        { scope: result.scope, issues: result.issues },
        'Database reset performed from the admin area'
      )

      request.yar.flash(
        'notification',
        `Deleted ${result.issues} issues, ${result.auditEntries} audit entries, ` +
          `${result.ruleRuns} runs and ${result.importJobs} imports from '${result.scope}'.`
      )

      return h.redirect('/admin/status')
    } catch (error) {
      if (!(error instanceof CleanseApiError)) {
        throw error
      }

      logger.warn(
        { status: error.status, code: error.code },
        'Database reset was refused'
      )
      return render(h, { error: error.detail ?? error.message, scope })
    }
  }
}
