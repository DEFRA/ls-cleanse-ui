import { config } from '#/config/config.js'
import { describeImportStatus } from '#/server/common/constants/workflow.js'
import { CleanseApiError } from '#/server/common/helpers/cleanse/client.js'
import { isEntra } from '#/server/plugins/auth.js'

const decorate = (job) => ({
  ...job,
  statusDetail: describeImportStatus(job.status)
})

/** Matches Imports:MaxUploadBytes on the backend, so a too-large file is refused here first. */
export const maxUploadBytes = 50 * 1024 * 1024

export const uploadPayload = {
  output: 'data',
  parse: true,
  multipart: { output: 'annotated' },
  maxBytes: maxUploadBytes,
  allow: 'multipart/form-data',
  failAction: 'error'
}

async function renderList(request, h, { error = null } = {}) {
  const groupId = config.get('cleanse.groupId')
  const imports = await request.cleanse.searchImports({ groupId, pageSize: 20 })

  const view = h.view('admin/imports', {
    pageTitle: 'SPOL imports',
    groupId,
    imports: imports.items.map(decorate),
    notification: request.yar.flash('notification')[0] ?? null,
    error
  })

  return error ? view.code(400) : view
}

export const importsController = {
  handler: (request, h) => renderList(request, h)
}

export const uploadImportController = {
  options: { payload: uploadPayload },
  async handler(request, h) {
    const file = request.payload?.file

    if (!file?.filename || !file.payload?.length) {
      return renderList(request, h, {
        error: 'Select a SPOL CSV file to upload'
      })
    }

    try {
      const job = await request.cleanse.uploadImport({
        groupId: config.get('cleanse.groupId'),
        fileName: file.filename,
        content: file.payload,
        ...(isEntra()
          ? {
              tenantId: config.get('auth.entra.tenantId'),
              clientId: config.get('auth.entra.clientId')
            }
          : {})
      })

      request.yar.flash(
        'notification',
        `${file.filename} uploaded. Processing has started.`
      )
      return h.redirect(`/admin/imports/${job.id}`)
    } catch (error) {
      if (!(error instanceof CleanseApiError)) {
        throw error
      }

      return renderList(request, h, { error: error.detail ?? error.message })
    }
  }
}

export const importDetailController = {
  async handler(request, h) {
    const job = await request.cleanse.getImport(request.params.id)
    const rejections = await request.cleanse.getImportRejections(
      request.params.id,
      {
        pageSize: 50
      }
    )

    return h.view('admin/import-detail', {
      pageTitle: job.fileName,
      job: decorate(job),
      rejections: rejections.items,
      rejectionTotal: rejections.totalCount,
      notification: request.yar.flash('notification')[0] ?? null
    })
  }
}
