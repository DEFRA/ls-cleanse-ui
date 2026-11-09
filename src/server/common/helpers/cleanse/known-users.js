/**
 * Every page of the directory, so users beyond the first page remain assignable and filterable.
 * It includes people who have not signed in yet, whatever the sign-in mode.
 */
export async function knownUsers(client) {
  const users = []
  let pageNumber = 1
  let totalCount
  do {
    const page = await client.searchUsers({ pageNumber, pageSize: 50 })
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

/** People who share a name are told apart by email, or by ID when no email is recorded. */
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
        ? `${user.fullName} (${user.email ?? user.id})`
        : user.fullName,
    selected: selected === user.id
  }))
}
