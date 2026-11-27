import { config } from '#/config/config.js'
import {
  describeDatasetStatus,
  describeImportStatus
} from '#/server/common/constants/workflow.js'
import { CleanseApiError } from '#/server/common/helpers/cleanse/client.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

const logger = createLogger()

const maxNameLength = 100

/** The environments the connector knows by name. Anywhere else, it is given the address. */
const connectorEnvironments = new Set(['local', 'dev', 'test', 'prod'])

const count = (value) => (value ?? 0).toLocaleString('en-GB')

const isRunning = (job) => ['pending', 'processing'].includes(job?.status)

const decorateRun = (job) => ({
  ...job,
  statusDetail: describeImportStatus(job.status),
  counts: {
    rows: count(job.totalRows),
    matched: count(job.matched),
    unmatched: count(job.unmatched),
    usersCreated: count(job.usersCreated)
  }
})

function decorate(dataset) {
  const processing = isRunning(dataset.lastProcessing)

  return {
    ...dataset,
    statusDetail: describeDatasetStatus(dataset.status),
    rows:
      dataset.status === 'loading' && dataset.expectedRows
        ? `${count(dataset.rowCount)} of ${count(dataset.expectedRows)}`
        : count(dataset.rowCount),
    isProcessing: processing,
    canProcess: dataset.status === 'ready' && !processing,
    lastProcessing: dataset.lastProcessing
      ? decorateRun(dataset.lastProcessing)
      : null
  }
}

/** The name typed, or the message saying why it will not do. */
function readName(value, { required }) {
  const name = String(value ?? '').trim()

  if (required && !name) {
    return { error: 'Enter a name for the dataset' }
  }
  if (name.length > maxNameLength) {
    return {
      error: `Name must be ${maxNameLength} characters or fewer`
    }
  }

  return { name }
}

/** What to run to load a dataset into the front end the admin is using now. */
export function connectorCommand(request, datasetId) {
  const environment = config.get('cdpEnvironment')
  const target = connectorEnvironments.has(environment)
    ? `-Environment ${environment}`
    : `-BaseUrl https://${request.info.host}`

  return `.\\Invoke-SpolPipeline.ps1 ${target} -DatasetId ${datasetId}`
}

async function renderList(
  request,
  h,
  { name = '', error = null, statusCode = 200 } = {}
) {
  const datasets = await request.cleanse.searchSpolDatasets({ pageSize: 50 })

  return h
    .view('admin/datasets', {
      pageTitle: 'SPOL datasets',
      groupId: config.get('cleanse.groupId'),
      datasets: datasets.items.map(decorate),
      name,
      error,
      notification: request.yar.flash('notification')[0] ?? null
    })
    .code(statusCode)
}

async function renderDetail(
  request,
  h,
  { error = null, statusCode = 200 } = {}
) {
  const { id } = request.params
  const dataset = await request.cleanse.getSpolDataset(id)
  const runs = await request.cleanse.searchImports({
    datasetId: id,
    pageSize: 20
  })

  return h
    .view('admin/dataset', {
      pageTitle: dataset.name,
      dataset: decorate(dataset),
      runs: runs.items.map(decorateRun),
      error,
      notification: request.yar.flash('notification')[0] ?? null
    })
    .code(statusCode)
}

async function renderRename(
  request,
  h,
  { name, error = null, statusCode = 200 } = {}
) {
  const dataset = await request.cleanse.getSpolDataset(request.params.id)

  return h
    .view('admin/dataset-rename', {
      pageTitle: `Rename ${dataset.name}`,
      dataset,
      name: name ?? dataset.name,
      error
    })
    .code(statusCode)
}

async function renderDelete(
  request,
  h,
  { error = null, statusCode = 200 } = {}
) {
  const dataset = await request.cleanse.getSpolDataset(request.params.id)

  return h
    .view('admin/dataset-delete', {
      pageTitle: `Delete ${dataset.name}`,
      dataset: decorate(dataset),
      error
    })
    .code(statusCode)
}

/** The backend's reason, where it gave one a person can act on. */
const refusal = (failure, fallback) =>
  failure instanceof CleanseApiError &&
  (failure.status === 400 || failure.isConflict)
    ? (failure.detail ?? fallback)
    : null

export const datasetsController = {
  handler: (request, h) => renderList(request, h)
}

export const createDatasetController = {
  async handler(request, h) {
    const typed = String(request.payload?.name ?? '')
    const { name, error } = readName(typed, { required: false })
    if (error) {
      return renderList(request, h, { name: typed, error, statusCode: 400 })
    }

    let created
    try {
      created = await request.cleanse.createSpolDataset({ name: name || null })
    } catch (failure) {
      const reason = refusal(failure, 'Check the name and try again')
      if (reason) {
        return renderList(request, h, {
          name: typed,
          error: reason,
          statusCode: 400
        })
      }
      throw failure
    }

    logger.info({ datasetId: created.dataset.id }, 'SPOL dataset created')

    // Shown here and nowhere else: the key is never put in the session to carry it to a page.
    return h
      .view('admin/dataset-created', {
        pageTitle: 'Dataset created',
        dataset: created.dataset,
        datasetKey: created.key,
        command: connectorCommand(request, created.dataset.id)
      })
      .header('cache-control', 'no-store')
  }
}

export const datasetController = {
  handler: (request, h) => renderDetail(request, h)
}

export const processDatasetController = {
  async handler(request, h) {
    const { id } = request.params

    let job
    try {
      job = await request.cleanse.processSpolDataset(id, {
        groupId: config.get('cleanse.groupId')
      })
    } catch (failure) {
      const reason = refusal(failure, 'The dataset cannot be processed now')
      if (reason) {
        return renderDetail(request, h, {
          error: reason,
          statusCode: failure.status
        })
      }
      throw failure
    }

    logger.info(
      { datasetId: id, importJobId: job.id },
      'SPOL dataset processing started'
    )
    request.yar.flash('notification', 'Processing has started.')
    return h.redirect(`/admin/imports/${job.id}`)
  }
}

export const renameDatasetController = {
  handler: (request, h) => renderRename(request, h)
}

export const saveDatasetNameController = {
  async handler(request, h) {
    const { id } = request.params
    const typed = String(request.payload?.name ?? '')
    const { name, error } = readName(typed, { required: true })
    if (error) {
      return renderRename(request, h, { name: typed, error, statusCode: 400 })
    }

    try {
      await request.cleanse.renameSpolDataset(id, {
        name,
        expectedVersion: Number(request.payload?.version)
      })
    } catch (failure) {
      if (failure instanceof CleanseApiError && failure.isConflict) {
        return renderRename(request, h, {
          name: typed,
          error:
            'The dataset changed while you were renaming it. Check the name and save it again.',
          statusCode: 409
        })
      }
      const reason = refusal(failure, 'Check the name and try again')
      if (reason) {
        return renderRename(request, h, {
          name: typed,
          error: reason,
          statusCode: 400
        })
      }
      throw failure
    }

    request.yar.flash('notification', `Dataset renamed to ${name}`)
    return h.redirect(`/admin/datasets/${id}`)
  }
}

export const deleteDatasetController = {
  handler: (request, h) => renderDelete(request, h)
}

export const confirmDeleteDatasetController = {
  async handler(request, h) {
    const { id } = request.params
    const dataset = await request.cleanse.getSpolDataset(id)

    try {
      await request.cleanse.deleteSpolDataset(id)
    } catch (failure) {
      const reason = refusal(failure, 'The dataset cannot be deleted now')
      if (reason) {
        return renderDelete(request, h, {
          error: reason,
          statusCode: failure.status
        })
      }
      throw failure
    }

    logger.info({ datasetId: id }, 'SPOL dataset deleted')
    request.yar.flash('notification', `Dataset ${dataset.name} deleted`)
    return h.redirect('/admin/datasets')
  }
}
