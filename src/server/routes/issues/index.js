import { listController } from './list-controller.js'
import { detailController } from './detail-controller.js'
import { assignmentController } from './assignment-controller.js'
import {
  startController,
  reopenController,
  resolveController,
  ignoreController,
  suppressController,
  noteController
} from './action-controllers.js'

/**
 * Every mutation is a POST that redirects, so a refresh never repeats an action and the whole
 * service works with JavaScript switched off.
 */
export const issues = {
  plugin: {
    name: 'issues',
    register(server) {
      server.route([
        { method: 'GET', path: '/issues', ...listController },
        { method: 'GET', path: '/issues/{id}', ...detailController },
        {
          method: 'GET',
          path: '/issues/{id}/assign',
          handler: assignmentController.get
        },
        {
          method: 'POST',
          path: '/issues/{id}/assign',
          handler: assignmentController.post
        },

        { method: 'POST', path: '/issues/{id}/start', ...startController },
        { method: 'POST', path: '/issues/{id}/reopen', ...reopenController },

        {
          method: 'GET',
          path: '/issues/{id}/resolve',
          handler: resolveController.get
        },
        {
          method: 'POST',
          path: '/issues/{id}/resolve',
          handler: resolveController.post
        },

        {
          method: 'GET',
          path: '/issues/{id}/ignore',
          handler: ignoreController.get
        },
        {
          method: 'POST',
          path: '/issues/{id}/ignore',
          handler: ignoreController.post
        },

        {
          method: 'GET',
          path: '/issues/{id}/suppress',
          handler: suppressController.get
        },
        {
          method: 'POST',
          path: '/issues/{id}/suppress',
          handler: suppressController.post
        },

        {
          method: 'GET',
          path: '/issues/{id}/note',
          handler: noteController.get
        },
        {
          method: 'POST',
          path: '/issues/{id}/note',
          handler: noteController.post
        }
      ])
    }
  }
}
