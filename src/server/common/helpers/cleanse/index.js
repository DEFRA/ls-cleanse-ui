import { createCleanseClient } from './client.js'
import { anonymiseClient, createAnonymiser } from './anonymise.js'
import { config } from '#/config/config.js'

function buildClient(server) {
  const client = createCleanseClient()

  if (!config.get('demo.anonymise')) {
    return client
  }

  server.logger.warn(
    'Demo anonymisation is on: personal data from the backend is replaced with fake values'
  )
  return anonymiseClient(
    client,
    createAnonymiser(config.get('demo.anonymiseKey'))
  )
}

/**
 * Exposes the backend client on every request, pre-bound to the trace id so the frontend
 * request and the backend work it causes land under one correlation id in the logs.
 */
export const cleanseApi = {
  plugin: {
    name: 'cleanse-api',
    register(server) {
      const client = buildClient(server)
      const traceHeader = config.get('tracing.header')

      server.decorate('server', 'cleanse', client)

      // `apply` resolves this per request, passing the request in rather than binding `this`.
      server.decorate(
        'request',
        'cleanse',
        (request) => client.forRequest(request.headers[traceHeader]),
        { apply: true }
      )
    }
  }
}
