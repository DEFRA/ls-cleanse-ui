import { config } from '#/config/config.js'
import { isEntra } from '#/server/plugins/auth.js'
import { CleanseApiError } from '#/server/common/helpers/cleanse/client.js'

const utcDateTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'UTC'
})

export const usersController = {
  async handler(request, h) {
    if (!isEntra()) {
      return h
        .view('admin/users', {
          pageTitle: 'Users',
          unavailable: true
        })
        .code(404)
    }

    const pageNumber = Math.max(1, Number.parseInt(request.query.page, 10) || 1)
    const { tenantId, clientId } = config.get('auth.entra')
    let users
    try {
      users = await request.cleanse.searchUsers({
        tenantId,
        clientId,
        pageNumber,
        pageSize: 50
      })
    } catch (error) {
      if (!(error instanceof CleanseApiError)) {
        throw error
      }
      request.logger.error(
        { status: error.status },
        'Could not load the user directory'
      )
      return h
        .view('admin/users', {
          pageTitle: 'Users unavailable',
          error: 'The user directory could not be loaded. Try again.'
        })
        .code(503)
    }
    return h.view('admin/users', {
      pageTitle: 'Users',
      users: users.items.map((user) => ({
        ...user,
        lastLogon: utcDateTime.format(new Date(user.lastLoggedInAtUtc))
      })),
      total: users.totalCount,
      previous: pageNumber > 1 ? `/admin/users?page=${pageNumber - 1}` : null,
      next:
        pageNumber * 50 < users.totalCount
          ? `/admin/users?page=${pageNumber + 1}`
          : null
    })
  }
}
