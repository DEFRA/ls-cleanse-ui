import {
  checkDatasetController,
  loadDatasetPageController
} from './datasets-controller.js'

export const api = {
  plugin: {
    name: 'api',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/api/v1/datasets/{id}',
          ...checkDatasetController
        },
        {
          method: 'POST',
          path: '/api/v1/datasets/{id}',
          ...loadDatasetPageController
        }
      ])
    }
  }
}
