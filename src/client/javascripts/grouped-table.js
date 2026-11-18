/**
 * Turns each CPH in a grouped issues table into a toggle for its issues. Without JavaScript
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

        button.append(glyph, label.textContent)
        label.replaceWith(button)

        const setOpen = (open) => {
          button.setAttribute('aria-expanded', String(open))
          child.hidden = !open
          parent.classList.toggle('app-grouped-table__parent--open', open)
        }

        setOpen(false)
        parent.addEventListener('click', () =>
          setOpen(button.getAttribute('aria-expanded') !== 'true')
        )
      })
    })
}
