import { listController, groupedController } from './list-controller.js'
import { detailController } from './detail-controller.js'

/**
 * The issue lists. Work on an issue happens on its holding's page, so an issue's own address
 * just leads there.
 */
export const issues = {
  plugin: {
    name: 'issues',
    register(server) {
      server.route([
        { method: 'GET', path: '/issues', ...listController },
        { method: 'GET', path: '/issues/grouped', ...groupedController },
        { method: 'GET', path: '/issues/{id}', ...detailController }
      ])
    }
  }
}
