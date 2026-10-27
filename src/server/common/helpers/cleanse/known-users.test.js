import { vi } from 'vitest'
import { knownUsers, userOptions } from './known-users.js'

describe('Known user choices', () => {
  test('loads all pages, including users beyond the first fifty', async () => {
    const first = Array.from({ length: 50 }, (_, index) => ({
      id: `${index}`,
      fullName: `User ${index}`
    }))
    const last = { id: 'last-user', fullName: 'Last User' }
    const client = {
      searchUsers: vi
        .fn()
        .mockResolvedValueOnce({ items: first, totalCount: 51 })
        .mockResolvedValueOnce({ items: [last], totalCount: 51 })
    }
    expect(await knownUsers(client)).toEqual([...first, last])
    expect(client.searchUsers.mock.calls[1][0].pageNumber).toBe(2)
  })

  test('fails explicitly for incomplete directory responses', async () => {
    await expect(
      knownUsers({
        searchUsers: async () => ({ items: [], totalCount: 2 })
      })
    ).rejects.toThrow('incomplete page')
  })

  test('disambiguates duplicate names using stable IDs', () => {
    const options = userOptions(
      [
        { id: 'first', fullName: 'Same Name' },
        { id: 'second', fullName: 'same name' },
        { id: 'third', fullName: 'Unique Name' }
      ],
      'second'
    )
    expect(options[0].text).toBe('Same Name (first)')
    expect(options[1]).toMatchObject({
      text: 'same name (second)',
      selected: true
    })
    expect(options[2].text).toBe('Unique Name')
  })
})
