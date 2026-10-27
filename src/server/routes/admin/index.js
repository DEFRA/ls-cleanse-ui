import { config } from '#/config/config.js'
import {
  runsController,
  runDetailController,
  triggerRunController
} from './runs-controller.js'
import {
  importsController,
  uploadImportController,
  importDetailController
} from './imports-controller.js'
import { statusController } from './status-controller.js'
import { resetController, performResetController } from './reset-controller.js'
import { usersController } from './users-controller.js'
import { isEntra } from '#/server/plugins/auth.js'

/** The admin menu. Reachable by URL and from the footer, never from the service navigation. */
const menu = [
  {
    text: 'Runs',
    href: '/admin/runs',
    description:
      'Rule engine run history and progress, and a way to start one by hand.'
  },
  {
    text: 'SPOL imports',
    href: '/admin/imports',
    description:
      'Upload a SharePoint extract and see which rows it could apply.'
  },
  {
    text: 'Status',
    href: '/admin/status',
    description:
      'Health of the front end, the backend and its dependencies, which builds are running, issue counts and the last reset.'
  },
  {
    text: 'Reset',
    href: '/admin/reset',
    description:
      'Permanently delete every issue and everything recorded against it.'
  }
]

export const adminHomeController = {
  handler: (request, h) =>
    h.view('admin/index', {
      pageTitle: 'Admin',
      groupId: config.get('cleanse.groupId'),
      menu: isEntra()
        ? [
            ...menu,
            {
              text: 'Users',
              href: '/admin/users',
              description: 'Users who have signed in and their last logon time.'
            }
          ]
        : menu
    })
}

export const admin = {
  plugin: {
    name: 'admin',
    register(server) {
      const routes = [
        { method: 'GET', path: '/admin', ...adminHomeController },

        { method: 'GET', path: '/admin/runs', ...runsController },
        { method: 'POST', path: '/admin/runs', ...triggerRunController },
        { method: 'GET', path: '/admin/runs/{runId}', ...runDetailController },

        { method: 'GET', path: '/admin/imports', ...importsController },
        { method: 'POST', path: '/admin/imports', ...uploadImportController },
        {
          method: 'GET',
          path: '/admin/imports/{id}',
          ...importDetailController
        },

        { method: 'GET', path: '/admin/status', ...statusController },
        { method: 'GET', path: '/admin/users', ...usersController },

        { method: 'GET', path: '/admin/reset', ...resetController },
        { method: 'POST', path: '/admin/reset', ...performResetController }
      ]

      // Every page here asks for the admin password as well as the service's.
      server.route(
        routes.map((route) => ({
          ...route,
          options: { ...route.options, auth: 'admin' }
        }))
      )
    }
  }
}
