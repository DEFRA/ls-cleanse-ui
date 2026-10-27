import { config } from '#/config/config.js'
import {
  issueStatuses,
  workflowStatuses,
  describeIssueStatus,
  describeWorkflowStatus
} from '#/server/common/constants/workflow.js'
import { CleanseApiError } from '#/server/common/helpers/cleanse/client.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

const logger = createLogger()

/** When this process started, for "running since". */
const startedAt = new Date(Date.now() - process.uptime() * 1000)

/** Rendered as a tick, a cross or a question mark. Anything unrecognised is treated as unknown. */
const states = {
  ok: { id: 'ok', label: 'OK', symbol: '✓', colour: 'green' },
  failed: { id: 'failed', label: 'Problem', symbol: '✗', colour: 'red' },
  unknown: { id: 'unknown', label: 'Unknown', symbol: '?', colour: 'grey' }
}

const describeState = (id) => states[id] ?? states.unknown

function check({ name, state, detail, value }) {
  return { name, value, detail, stateDetail: describeState(state) }
}

/**
 * Why the backend could not be asked, in words that point at the fix. Through the developer
 * gateway a 403 is always the developer key, which expires daily, so it is named.
 */
export function describeFailure(error, { gatewayInUse = false } = {}) {
  if (error.status === 403 && gatewayInUse) {
    return 'The CDP developer gateway refused the developer key (403). Developer keys last 24 hours: generate a new one from your user profile in the CDP Portal.'
  }

  if (error.status === 401) {
    return "The backend refused this service's credential (401)."
  }

  return error.detail ?? error.title ?? error.message
}

/**
 * One of the backend's own dependencies, as /v1/diagnostics reports it. A backend too old to
 * report one says so rather than being guessed at.
 */
function dependencyCheck(name, diagnostics, key) {
  if (!diagnostics) {
    return check({
      name,
      state: 'unknown',
      detail: 'The Cleanse backend did not answer.'
    })
  }

  const dependency = diagnostics[key]
  if (!dependency) {
    return check({
      name,
      state: 'unknown',
      detail: 'Not reported by this version of the backend.'
    })
  }

  const elapsed = Math.round(dependency.elapsedMilliseconds ?? 0)
  const timing = elapsed > 0 ? `Answered in ${elapsed}ms` : null
  // Details arrive with or without a closing full stop; joining must not double it.
  const detail = dependency.detail?.trim().replace(/\.$/, '')

  return check({
    name,
    state: dependency.state,
    value: [dependency.provider, dependency.target].filter(Boolean).join(' '),
    detail: [detail, timing].filter(Boolean).join('. ') || null
  })
}

/** The one dependency the backend cannot report on is the backend itself, so it is timed here. */
async function askBackend(request, groupId) {
  const apiUrl = config.get('cleanse.apiUrl')
  const started = performance.now()

  try {
    const diagnostics = await request.cleanse.getDiagnostics(groupId)

    return {
      diagnostics,
      connection: check({
        name: 'Cleanse service',
        state: 'ok',
        value: apiUrl,
        detail: `Answered in ${Math.round(performance.now() - started)}ms`
      })
    }
  } catch (error) {
    if (!(error instanceof CleanseApiError)) {
      throw error
    }

    logger.error(
      { err: error },
      'Admin status could not reach the Cleanse backend'
    )

    return {
      diagnostics: null,
      connection: check({
        name: 'Cleanse service',
        state: 'failed',
        value: apiUrl,
        detail: describeFailure(error, {
          gatewayInUse: Boolean(config.get('cleanse.gatewayKey'))
        })
      })
    }
  }
}

/** Shown with a coloured tag, so the state of the whole service can be read at a glance. */
export function summarise(checks) {
  const count = (id) =>
    checks.filter((item) => item.stateDetail.id === id).length

  const failed = count('failed')
  if (failed > 0) {
    return {
      colour: 'red',
      text: failed === 1 ? '1 problem' : `${failed} problems`
    }
  }

  const unknown = count('unknown')
  if (unknown > 0) {
    return {
      colour: 'grey',
      text: unknown === 1 ? '1 not confirmed' : `${unknown} not confirmed`
    }
  }

  return { colour: 'green', text: `All ${checks.length} checks OK` }
}

function describeFrontEnd(now) {
  const auth =
    config.get('cleanse.auth') === 'stsJwt'
      ? 'STS web identity token'
      : 'Shared API key'

  return {
    name: config.get('serviceName'),
    version: config.get('serviceVersion'),
    environment: config.get('cdpEnvironment'),
    startedAt,
    uptimeSeconds: (now - startedAt) / 1000,
    node: process.version,
    backendUrl: config.get('cleanse.apiUrl'),
    backendAuth: config.get('cleanse.gatewayKey')
      ? `${auth}, through the CDP developer gateway`
      : auth
  }
}

function describeBackEnd(service, now) {
  if (!service) {
    return null
  }

  const started = service.startedAtUtc ? new Date(service.startedAtUtc) : null

  return {
    ...service,
    startedAt: started,
    uptimeSeconds: started ? (now - started) / 1000 : null
  }
}

/**
 * Builds the grid of status by workflow status. Every combination is shown, including the empty
 * ones: "no issues are suppressed" is a useful thing to be able to read off a status page.
 */
function buildMatrix(breakdown = []) {
  const lookup = new Map(
    breakdown.map((entry) => [
      `${entry.status}|${entry.workflowStatus}`,
      entry.count
    ])
  )

  const rows = workflowStatuses.map((workflow) => {
    const cells = issueStatuses.map((status) => ({
      status: status.id,
      count: lookup.get(`${status.id}|${workflow.id}`) ?? 0
    }))

    return {
      workflow: describeWorkflowStatus(workflow.id),
      cells,
      total: cells.reduce((sum, cell) => sum + cell.count, 0)
    }
  })

  return {
    columns: issueStatuses.map((status) => describeIssueStatus(status.id)),
    rows,
    columnTotals: issueStatuses.map((status) => ({
      status: status.id,
      count: rows.reduce(
        (sum, row) =>
          sum + row.cells.find((cell) => cell.status === status.id).count,
        0
      )
    }))
  }
}

export const statusController = {
  async handler(request, h) {
    const groupId = config.get('cleanse.groupId')
    const { diagnostics, connection } = await askBackend(request, groupId)
    const now = new Date()

    const checks = [
      connection,
      dependencyCheck('Database', diagnostics, 'database'),
      dependencyCheck('Import storage', diagnostics, 'storage'),
      dependencyCheck('KRDS health', diagnostics, 'krds'),
      // The health check is anonymous; only this one proves the backend's key gets it in.
      dependencyCheck('KRDS read access', diagnostics, 'krdsAccess')
    ]

    return h.view('admin/status', {
      pageTitle: 'Status',
      groupId,
      summary: summarise(checks),
      checkedAt: now,
      checks,
      frontEnd: describeFrontEnd(now),
      backEnd: describeBackEnd(diagnostics?.service, now),
      issues: diagnostics?.issues ?? null,
      matrix: diagnostics ? buildMatrix(diagnostics.issues.breakdown) : null,
      lastResetAtUtc: diagnostics?.lastResetAtUtc ?? null,
      reachedBackend: Boolean(diagnostics),
      notification: request.yar.flash('notification')[0] ?? null
    })
  }
}
