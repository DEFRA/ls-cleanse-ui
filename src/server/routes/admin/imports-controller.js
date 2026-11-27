import { config } from '#/config/config.js'
import { describeImportStatus } from '#/server/common/constants/workflow.js'

const decorate = (job) => ({
  ...job,
  statusDetail: describeImportStatus(job.status),
  // A dataset's report names items by SharePoint item ID; an earlier upload's, rows in its file.
  fromDataset: job.source === 'dataset'
})

export const importsController = {
  async handler(request, h) {
    const groupId = config.get('cleanse.groupId')
    const imports = await request.cleanse.searchImports({
      groupId,
      pageSize: 20
    })

    return h.view('admin/imports', {
      pageTitle: 'SPOL imports',
      groupId,
      imports: imports.items.map(decorate)
    })
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
