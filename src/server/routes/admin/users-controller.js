import { CleanseApiError } from '#/server/common/helpers/cleanse/client.js'

const pageSize = 50

const utcDateTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'UTC'
})

/** Splits on commas, semicolons and white space, so a list pasted from a form or email works. */
export function parseEmails(text) {
  return [
    ...new Set(
      String(text ?? '')
        .split(/[\s,;]+/)
        .filter(Boolean)
    )
  ]
}

const counted = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`

export const usersController = {
  async handler(request, h) {
    const pageNumber = Math.max(1, Number.parseInt(request.query.page, 10) || 1)
    let users
    try {
      users = await request.cleanse.searchUsers({ pageNumber, pageSize })
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
      notification: request.yar.flash('notification')[0] ?? null,
      users: users.items.map((user) => ({
        ...user,
        lastLogon: user.lastLoggedInAtUtc
          ? utcDateTime.format(new Date(user.lastLoggedInAtUtc))
          : null
      })),
      total: users.totalCount,
      previous: pageNumber > 1 ? `/admin/users?page=${pageNumber - 1}` : null,
      next:
        pageNumber * pageSize < users.totalCount
          ? `/admin/users?page=${pageNumber + 1}`
          : null
    })
  }
}

function showAddForm(h, { emails = '', error = null } = {}) {
  return h
    .view('admin/users-add', {
      pageTitle: error ? 'Error: Add users' : 'Add users',
      emails,
      error
    })
    .code(error ? 400 : 200)
}

export const addUsersController = {
  handler: (_request, h) => showAddForm(h)
}

export const registerUsersController = {
  async handler(request, h) {
    const text = String(request.payload?.emails ?? '')
    const emails = parseEmails(text)
    if (emails.length === 0) {
      return showAddForm(h, {
        emails: text,
        error: 'Enter at least one email address'
      })
    }

    let result
    try {
      result = await request.cleanse.registerUsers({ emails })
    } catch (error) {
      if (error instanceof CleanseApiError && error.status === 400) {
        return showAddForm(h, {
          emails: text,
          error: error.detail ?? 'Check the email addresses and try again'
        })
      }
      throw error
    }

    request.yar.flash(
      'notification',
      `${counted(result.created.length, 'user')} added. ${counted(result.existing.length, 'address')} already known.`
    )
    return h.redirect('/admin/users')
  }
}
