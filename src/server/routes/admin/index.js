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
import {
  usersController,
  addUsersController,
  registerUsersController
} from './users-controller.js'
import {
  actionTypesController,
  addActionTypeController,
  setActionTypeActiveController,
  outcomeReasonsController,
  addOutcomeReasonController,
  setOutcomeReasonActiveController
} from './coded-values-controller.js'

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
    text: 'Users',
    href: '/admin/users',
    description:
      'Everyone holdings can be assigned to and when they last signed in, and a way to add people before they first sign in.'
  },
  {
    text: 'Action types',
    href: '/admin/action-types',
    description:
      'The actions caseworkers can record against a holding, such as "Updated SAM".'
  },
  {
    text: 'Outcome reasons',
    href: '/admin/outcome-reasons',
    description:
      "The reasons caseworkers can give for resolving an issue, or for why it can't be resolved."
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
      'Permanently delete every issue and holding, and everything recorded against them.'
  }
]

export const adminHomeController = {
  handler: (request, h) =>
    h.view('admin/index', {
      pageTitle: 'Admin',
      groupId: config.get('cleanse.groupId'),
      menu
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
        { method: 'GET', path: '/admin/users/add', ...addUsersController },
        {
          method: 'POST',
          path: '/admin/users/add',
          ...registerUsersController
        },

        {
          method: 'GET',
          path: '/admin/action-types',
          ...actionTypesController
        },
        {
          method: 'POST',
          path: '/admin/action-types',
          ...addActionTypeController
        },
        {
          method: 'POST',
          path: '/admin/action-types/{id}/active',
          ...setActionTypeActiveController
        },
        {
          method: 'GET',
          path: '/admin/outcome-reasons',
          ...outcomeReasonsController
        },
        {
          method: 'POST',
          path: '/admin/outcome-reasons',
          ...addOutcomeReasonController
        },
        {
          method: 'POST',
          path: '/admin/outcome-reasons/{id}/active',
          ...setOutcomeReasonActiveController
        },

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
