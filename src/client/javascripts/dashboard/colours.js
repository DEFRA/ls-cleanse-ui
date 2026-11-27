/**
 * The status colours, as the tags elsewhere in Cleanse use them, darkened where needed for a
 * contrast of at least 3:1 with the white background. Colour is never the only difference: each
 * status also has a pattern, and a white line separates neighbours.
 */
export const statusStyles = {
  todo: { label: 'To do', colour: '#1d70b8', pattern: 'solid' },
  'in-progress': { label: 'In progress', colour: '#4c2c92', pattern: 'hatch' },
  suppressed: { label: 'Suppressed', colour: '#806400', pattern: 'dots' },
  resolved: { label: 'Resolved', colour: '#00703c', pattern: 'solid' },
  nonactionable: {
    label: "Can't resolve",
    colour: '#b04500',
    pattern: 'cross'
  },
  closed: { label: 'Closed', colour: '#505a5f', pattern: 'solid' },
  inactive: { label: 'Inactive', colour: '#505a5f', pattern: 'hatch' },
  active: { label: 'Active', colour: '#1d70b8', pattern: 'solid' }
}

/** For series that are not statuses, such as action types. The last is for Other. */
export const categoryColours = [
  '#1d70b8',
  '#00703c',
  '#4c2c92',
  '#b04500',
  '#d4351c',
  '#505a5f'
]

export const patterns = ['solid', 'hatch', 'dots', 'cross', 'solid', 'hatch']

export const otherColour = '#505a5f'

export function statusStyle(state) {
  return (
    statusStyles[state] ?? {
      label: state,
      colour: otherColour,
      pattern: 'solid'
    }
  )
}

/** The n-th category's colour and pattern, so a series keeps both wherever it is drawn. */
export function categoryStyle(index, isOther = false) {
  if (isOther) {
    return { colour: otherColour, pattern: 'dots' }
  }
  return {
    colour: categoryColours[index % (categoryColours.length - 1)],
    pattern: patterns[index % patterns.length]
  }
}
