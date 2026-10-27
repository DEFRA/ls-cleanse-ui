import { config } from '#/config/config.js'

/** Fetch every page so users beyond the first page remain assignable and filterable. */
export async function knownUsers(client) {
  const { tenantId, clientId } = config.get('auth.entra')
  const users = []
  let pageNumber = 1
  let totalCount
  do {
    const page = await client.searchUsers({
      tenantId,
      clientId,
      pageNumber,
      pageSize: 50
    })
    if (!Array.isArray(page.items) || !Number.isSafeInteger(page.totalCount)) {
      throw new Error('The user directory returned an invalid page')
    }
    users.push(...page.items)
    totalCount = page.totalCount
    if (users.length < totalCount && page.items.length === 0) {
      throw new Error('The user directory returned an incomplete page')
    }
    pageNumber++
  } while (users.length < totalCount)
  return users
}

export function userOptions(users, selected) {
  const nameCounts = new Map()
  for (const user of users) {
    const name = user.fullName.trim().toLowerCase()
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
  }
  return users.map((user) => ({
    value: user.id,
    text:
      nameCounts.get(user.fullName.trim().toLowerCase()) > 1
        ? `${user.fullName} (${user.id})`
        : user.fullName,
    selected: selected === user.id
  }))
}
