import inert from '@hapi/inert'

import { home } from '../routes/home/index.js'
import { issues } from '../routes/issues/index.js'
import { admin } from '../routes/admin/index.js'
import { login } from '../routes/login/index.js'
import { health } from '../routes/health/index.js'
import { serveStaticFiles } from './serve-static-files.js'
import { config } from '#/config/config.js'

export const router = {
  plugin: {
    name: 'router',
    async register(server) {
      await server.register([inert])

      // Health-check route. Used by platform to check if service is running, do not remove!
      await server.register([health])

      await server.register([home, issues, admin, login])

      // Static assets
      if (!config.get('isProduction') && !config.get('isTest')) {
        await (async () => {
          const createViteServer = (await import('vite')).createServer
          const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: 'custom'
          })

          // Assets are public, as the production static route declares, so the sign-in page is
          // styled. hapi-connect takes no route options, so its one route gains auth: false here.
          const hapiConnect = (await import('@defra/hapi-connect')).default
          await hapiConnect.register(
            {
              route: (route) =>
                server.route({
                  ...route,
                  options: { ...route.options, auth: false }
                })
            },
            {
              path: '/public',
              middleware: [vite.middlewares]
            }
          )
        })()
      } else {
        server.register(serveStaticFiles)
      }
    }
  }
}
