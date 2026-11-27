import { CleanseApiError } from '#/server/common/helpers/cleanse/client.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

/**
 * What ls-cleanse-spol-connector calls, from an admin's desktop. There is no sign-in and no form
 * token here: the dataset's key is the only credential, and the backend checks it. Every answer
 * is the backend's, passed on.
 */

export const datasetKeyHeader = 'x-dataset-key'

/** Pages are 200 rows, about 300 KB, so even 500 of the largest SPOL items fit well inside this. */
export const maxPageBytes = 4 * 1024 * 1024

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const problem = (h, { status, title, detail, code }) =>
  h
    .response({ status, title, detail, code })
    .code(status)
    .type('application/problem+json')
    .header('cache-control', 'no-store')

/** The same for a dataset that does not exist as for a wrong key, so neither gives the other away. */
const unauthorised = (h) =>
  problem(h, {
    status: statusCodes.unauthorized,
    title: 'Unauthorized',
    detail: 'The dataset id or key is not valid.',
    code: 'dataset.unauthorised'
  })

function keyOf(request) {
  const key = request.headers[datasetKeyHeader]

  return typeof key === 'string' &&
    key.trim() !== '' &&
    guid.test(request.params.id ?? '')
    ? key.trim()
    : null
}

/** Refuses a request without a key before its body is read. */
function requireKey(request, h) {
  return keyOf(request) ? h.continue : unauthorised(h).takeover()
}

async function passOn(h, call) {
  try {
    return h.response(await call()).header('cache-control', 'no-store')
  } catch (error) {
    if (error instanceof CleanseApiError) {
      return problem(h, error)
    }
    throw error
  }
}

const open = { auth: false, plugins: { crumb: false } }

export const checkDatasetController = {
  options: { ...open, ext: { onPreAuth: { method: requireKey } } },
  handler: (request, h) =>
    passOn(h, async () => {
      const dataset = await request.cleanse.checkSpolDatasetKey(
        request.params.id,
        keyOf(request)
      )

      // What the connector shows. Who made it, and when, is for the admin pages.
      return {
        id: dataset.id,
        name: dataset.name,
        status: dataset.status,
        rowCount: dataset.rowCount,
        expectedRows: dataset.expectedRows,
        lastLoadedAtUtc: dataset.lastLoadedAtUtc
      }
    })
}

export const loadDatasetPageController = {
  options: {
    ...open,
    ext: { onPreAuth: { method: requireKey } },
    payload: {
      output: 'data',
      parse: true,
      allow: 'application/json',
      maxBytes: maxPageBytes,
      failAction: 'error'
    }
  },
  handler: (request, h) =>
    passOn(h, () =>
      request.cleanse.loadSpolDatasetPage(
        request.params.id,
        keyOf(request),
        request.payload
      )
    )
}
