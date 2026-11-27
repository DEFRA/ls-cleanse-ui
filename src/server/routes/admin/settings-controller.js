import { CleanseApiError } from '#/server/common/helpers/cleanse/client.js'

const path = '/admin/settings'
const maxMinimumIssueAgeDays = 365

/** The number of days typed, or the message saying why it is not one. */
function readMinimumIssueAge(value) {
  const text = String(value ?? '').trim()

  if (!text) {
    return { error: 'Enter the minimum issue age' }
  }
  if (!/^-?\d+$/.test(text)) {
    return { error: 'Minimum issue age must be a whole number, like 14' }
  }

  const days = Number(text)
  if (days < 0 || days > maxMinimumIssueAgeDays) {
    return {
      error: `Minimum issue age must be between 0 and ${maxMinimumIssueAgeDays} days`
    }
  }

  return { days }
}

async function render(request, h, { value, error, statusCode = 200 } = {}) {
  const shown =
    value ?? (await request.cleanse.getSettings()).minimumIssueAgeDays
  const flash = request.yar.flash('notification')

  return h
    .view('admin/settings', {
      pageTitle: 'Settings',
      minimumIssueAgeDays: shown,
      error,
      notification: flash.length ? flash[0] : null
    })
    .code(statusCode)
}

export const settingsController = {
  handler: (request, h) => render(request, h)
}

export const updateSettingsController = {
  async handler(request, h) {
    const value = String(request.payload?.minimumIssueAgeDays ?? '').trim()
    const { days, error } = readMinimumIssueAge(value)
    if (error) {
      return render(request, h, { value, error, statusCode: 400 })
    }

    try {
      await request.cleanse.updateSettings({ minimumIssueAgeDays: days })
    } catch (failure) {
      if (failure instanceof CleanseApiError && failure.status === 400) {
        return render(request, h, {
          value,
          error: failure.detail ?? 'Check the minimum issue age and try again',
          statusCode: 400
        })
      }
      throw failure
    }

    request.yar.flash(
      'notification',
      `Minimum issue age set to ${days} ${days === 1 ? 'day' : 'days'}`
    )
    return h.redirect(path)
  }
}
