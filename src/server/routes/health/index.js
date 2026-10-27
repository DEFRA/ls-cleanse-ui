import { healthController } from './controller.js'

export const health = {
  plugin: {
    name: 'health',
    register(server) {
      server.route({
        method: 'GET',
        path: '/health',
        // The platform asks without signing in, and kills an instance that does not answer.
        options: { auth: false },
        ...healthController
      })
    }
  }
}
