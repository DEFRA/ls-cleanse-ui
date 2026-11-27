import { holdingController } from './controller.js'

/**
 * The holding page: every issue at one CPH, worked as one. A CPH has slashes in it, so the path
 * takes everything after /holdings/ as the CPH.
 */
export const holdings = {
  plugin: {
    name: 'holdings',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/holdings/{cph*}',
          handler: holdingController.get
        },
        {
          method: 'POST',
          path: '/holdings/{cph*}',
          handler: holdingController.post
        }
      ])
    }
  }
}
