import { holdingPath } from './presenter.js'
import { CleanseApiError } from '#/server/common/helpers/cleanse/client.js'

/**
 * An issue is worked on its holding's page, so its own address, still in bookmarks and emails,
 * opens that page at the issue. An issue with no CPH has no holding to open.
 */
export const detailController = {
  async handler(request, h) {
    const issue = await request.cleanse.getIssue(request.params.id)
    const holding = holdingPath(issue.context?.cph)

    if (!holding) {
      throw new CleanseApiError({ status: 404, code: 'holding.not_found' })
    }

    return h.redirect(`${holding}#issue-${encodeURIComponent(issue.id)}`)
  }
}
