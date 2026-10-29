import { pino } from 'pino'

import { loggerOptions } from './logger-options.js'

/**
 * Request logging must never carry what a caseworker typed into the search box, nor the previous
 * page's address, which carries the same thing in the referer. The log line here is shaped as
 * hapi-pino shapes it: the request as a child binding, the response on the completion event.
 */
describe('#loggerOptions redaction', () => {
  function logRequest() {
    const lines = []
    const logger = pino(
      { redact: loggerOptions.redact, nesting: true, enabled: true },
      { write: (line) => lines.push(line) }
    )

    logger
      .child({
        req: {
          id: '1',
          method: 'get',
          url: '/issues',
          query: { searchTerm: 'Keeper-Surname SW1A 1AA', page: '2' },
          headers: {
            referer: 'https://cleanse/issues?searchTerm=Keeper-Surname',
            authorization: 'Bearer secret-token',
            cookie: 'session=secret',
            'user-agent': 'browser'
          }
        }
      })
      .info(
        { res: { statusCode: 200, headers: { 'set-cookie': 'session=x' } } },
        'request completed'
      )

    return JSON.parse(lines[0])
  }

  test('Should drop the query string and referer from request logs', () => {
    const line = logRequest()

    expect(JSON.stringify(line)).not.toContain('Keeper-Surname')
    expect(line.req).not.toHaveProperty('query')
    expect(line.req.headers).not.toHaveProperty('referer')
  })

  test('Should still drop credentials and response headers', () => {
    const line = logRequest()

    expect(line.req.headers).not.toHaveProperty('authorization')
    expect(line.req.headers).not.toHaveProperty('cookie')
    expect(line.res).not.toHaveProperty('headers')
  })

  test('Should keep what operations need', () => {
    const line = logRequest()

    expect(line.req).toMatchObject({ method: 'get', url: '/issues' })
    expect(line.req.headers['user-agent']).toBe('browser')
    expect(line.res.statusCode).toBe(200)
  })
})
