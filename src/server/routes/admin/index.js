import { config } from '#/config/config.js'
import {
  runsController,
  runDetailController,
  triggerRunController
} from './runs-controller.js'
import {
  importsController,
  importDetailController
} from './imports-controller.js'
import {
  datasetsController,
  createDatasetController,
  datasetController,
  processDatasetController,
  renameDatasetController,
  saveDatasetNameController,
  deleteDatasetController,
  confirmDeleteDatasetController
} from './datasets-controller.js'
import { statusController } from './status-controller.js'
import {
  dashboardController,
  dashboardDataController,
  dashboardStatusController,
  rebuildDashboardController
} from './dashboard-controller.js'
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
import {
  settingsController,
  updateSettingsController
} from './settings-controller.js'

/** The admin menu. Reachable by URL and from the footer, never from the service navigation. */
const menu = [
  {
    text: 'Dashboard',
    href: '/admin/dashboard',
    description:
      'Figures and charts on the work done in Cleanse and the progress made on the issues.'
  },
  {
    text: 'Runs',
    href: '/admin/runs',
    description:
      'Rule engine run history and progress, and a way to start one by hand.'
  },
  {
    text: 'SPOL datasets',
    href: '/admin/datasets',
    description:
      'Load the SPOL list from your desktop with the SPOL connector, then process it onto the matching issues and holdings.'
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
    text: 'Settings',
    href: '/admin/settings',
    description:
      'How many days old an issue must be before the Issues List and Grouped views show it.'
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

        { method: 'GET', path: '/admin/dashboard', ...dashboardController },
        {
          method: 'GET',
          path: '/admin/dashboard/data',
          ...dashboardDataController
        },
        {
          method: 'GET',
          path: '/admin/dashboard/status',
          ...dashboardStatusController
        },
        {
          method: 'POST',
          path: '/admin/status/rebuild-dashboard',
          ...rebuildDashboardController
        },

        { method: 'GET', path: '/admin/runs', ...runsController },
        { method: 'POST', path: '/admin/runs', ...triggerRunController },
        { method: 'GET', path: '/admin/runs/{runId}', ...runDetailController },

        { method: 'GET', path: '/admin/imports', ...importsController },
        {
          method: 'GET',
          path: '/admin/imports/{id}',
          ...importDetailController
        },

        { method: 'GET', path: '/admin/datasets', ...datasetsController },
        {
          method: 'POST',
          path: '/admin/datasets',
          ...createDatasetController
        },
        {
          method: 'GET',
          path: '/admin/datasets/{id}',
          ...datasetController
        },
        {
          method: 'POST',
          path: '/admin/datasets/{id}/process',
          ...processDatasetController
        },
        {
          method: 'GET',
          path: '/admin/datasets/{id}/rename',
          ...renameDatasetController
        },
        {
          method: 'POST',
          path: '/admin/datasets/{id}/rename',
          ...saveDatasetNameController
        },
        {
          method: 'GET',
          path: '/admin/datasets/{id}/delete',
          ...deleteDatasetController
        },
        {
          method: 'POST',
          path: '/admin/datasets/{id}/delete',
          ...confirmDeleteDatasetController
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

        { method: 'GET', path: '/admin/settings', ...settingsController },
        {
          method: 'POST',
          path: '/admin/settings',
          ...updateSettingsController
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
