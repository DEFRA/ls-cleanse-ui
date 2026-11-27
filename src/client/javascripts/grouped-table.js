/**
 * Gives each CPH in a grouped issues table a toggle for its issues. The CPH itself links to the
 * holding, so the toggle sits beside it, and the rest of the row toggles too. Without JavaScript
 * every group stays open, so the table still works as a plain list.
 */
export function initGroupedTables(root = document) {
  root
    .querySelectorAll('[data-module="app-grouped-table"]')
    .forEach((table) => {
      table.querySelectorAll('.app-grouped-table__cph').forEach((label) => {
        const child = table.querySelector(`#${label.dataset.controls}`)
        const parent = label.closest('tr')

        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'app-grouped-table__toggle'
        button.setAttribute('aria-controls', child.id)

        const glyph = document.createElement('span')
        glyph.className = 'app-grouped-table__glyph'
        glyph.setAttribute('aria-hidden', 'true')

        const text = document.createElement('span')
        text.className = 'govuk-visually-hidden'
        text.textContent = `Issues at ${label.textContent.trim()}`

        button.append(glyph, text)
        label.before(button)

        const setOpen = (open) => {
          button.setAttribute('aria-expanded', String(open))
          child.hidden = !open
          parent.classList.toggle('app-grouped-table__parent--open', open)
        }

        setOpen(false)
        parent.addEventListener('click', (event) => {
          // A link goes where it says rather than opening the group.
          if (event.target.closest('a')) {
            return
          }
          setOpen(button.getAttribute('aria-expanded') !== 'true')
        })
      })
    })
}
