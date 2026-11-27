import { jsonScript } from './json-script.js'

describe('#jsonScript', () => {
  test('Should write JSON that reads back as the same value', () => {
    const value = { name: 'Alice Smith', counts: [1, 2], nothing: null }

    expect(JSON.parse(String(jsonScript(value)))).toEqual(value)
  })

  test('Should never let the data close its script element', () => {
    const value = { name: '</script><script>alert(1)</script><!-- & -->' }

    const written = String(jsonScript(value))

    expect(written).not.toMatch(/[<>&]/)
    expect(JSON.parse(written)).toEqual(value)
  })

  test('Should escape the line separators', () => {
    const written = String(jsonScript({ text: 'a\u2028b\u2029c' }))

    expect(written).toBe('{"text":"a\\u2028b\\u2029c"}')
  })

  test('Should write null for nothing', () => {
    expect(String(jsonScript(undefined))).toBe('null')
  })
})
