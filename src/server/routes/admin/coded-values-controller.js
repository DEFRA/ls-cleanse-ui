import { CleanseApiError } from '#/server/common/helpers/cleanse/client.js'

const nameLimit = 100

/**
 * The admin-maintained lists, two pages of them. Entries are added and switched on or off, never
 * renamed or deleted, so what was recorded against one keeps its meaning.
 */
const pages = {
  actionTypes: {
    path: '/admin/action-types',
    title: 'Action types',
    intro:
      'What caseworkers can record doing about a holding, such as "Updated SAM". Each action is stored and counted on its own. An action type switched off is no longer offered, but stays on the actions already recorded.',
    sections: [
      {
        list: 'action-types',
        heading: 'Action types',
        noun: 'action type',
        addLabel: 'Add an action type'
      }
    ]
  },
  outcomeReasons: {
    path: '/admin/outcome-reasons',
    title: 'Outcome reasons',
    intro:
      "Why an issue was resolved, or can't be. A reason is optional for Resolved and required for Can't resolve, so Can't resolve is only offered while one of its reasons is switched on. A reason switched off is no longer offered, but stays on the issues that have it.",
    sections: [
      {
        list: 'resolved-reasons',
        heading: 'Resolved reasons',
        noun: 'Resolved reason',
        addLabel: 'Add a Resolved reason'
      },
      {
        list: 'cant-resolve-reasons',
        heading: "Can't resolve reasons",
        noun: "Can't resolve reason",
        addLabel: "Add a Can't resolve reason"
      }
    ]
  }
}

async function render(request, h, page, { error, statusCode = 200 } = {}) {
  const lists = await Promise.all(
    page.sections.map((section) =>
      request.cleanse.listCodedValues(section.list)
    )
  )
  const flash = request.yar.flash('notification')

  return h
    .view('admin/coded-values', {
      pageTitle: page.title,
      error: Boolean(error),
      errors: error ? [{ text: error.text, href: `#name-${error.list}` }] : [],
      notification: flash.length ? flash[0] : null,
      path: page.path,
      intro: page.intro,
      sections: page.sections.map((section, index) => ({
        ...section,
        entries: lists[index],
        error: error?.list === section.list ? error.text : null,
        name: error?.list === section.list ? error.name : ''
      }))
    })
    .code(statusCode)
}

const sectionOf = (page, list) =>
  page.sections.find((section) => section.list === list)

function show(page) {
  return { handler: (request, h) => render(request, h, page) }
}

function add(page) {
  return {
    async handler(request, h) {
      const section = sectionOf(page, request.payload?.list)
      const name = String(request.payload?.name ?? '').trim()
      const fail = (text, statusCode = 400) =>
        render(request, h, page, {
          error: { list: section?.list ?? page.sections[0].list, text, name },
          statusCode
        })

      if (!section) {
        return fail('Choose which list to add to')
      }
      if (!name) {
        return fail(`Enter the name of the ${section.noun}`)
      }
      if (name.length > nameLimit) {
        return fail(`A name can be up to ${nameLimit} characters`)
      }

      try {
        await request.cleanse.addCodedValue(section.list, { name })
      } catch (error) {
        if (error instanceof CleanseApiError && error.isConflict) {
          return fail(`"${name}" is already in the list`)
        }
        if (error instanceof CleanseApiError && error.status === 400) {
          return fail(error.detail ?? 'Check the name and try again')
        }
        throw error
      }

      request.yar.flash('notification', `"${name}" added`)
      return h.redirect(page.path)
    }
  }
}

function setActive(page) {
  return {
    async handler(request, h) {
      const section = sectionOf(page, request.payload?.list)
      if (!section) {
        return render(request, h, page, {
          error: {
            list: page.sections[0].list,
            text: 'Something went wrong. Try again.'
          },
          statusCode: 400
        })
      }

      const active = request.payload?.active === 'true'
      const entry = await request.cleanse.setCodedValueActive(
        section.list,
        request.params.id,
        { isActive: active }
      )

      request.yar.flash(
        'notification',
        `"${entry.name}" ${active ? 'switched on' : 'switched off'}`
      )
      return h.redirect(page.path)
    }
  }
}

export const actionTypesController = show(pages.actionTypes)
export const addActionTypeController = add(pages.actionTypes)
export const setActionTypeActiveController = setActive(pages.actionTypes)

export const outcomeReasonsController = show(pages.outcomeReasons)
export const addOutcomeReasonController = add(pages.outcomeReasons)
export const setOutcomeReasonActiveController = setActive(pages.outcomeReasons)
