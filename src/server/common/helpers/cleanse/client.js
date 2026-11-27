import { config } from '#/config/config.js'
import { createAuthStrategy } from './auth.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

const logger = createLogger()

/** How each auth strategy's credential is named in an error a person will read. */
const credentialNames = {
  stsJwt: 'an STS web identity token',
  apiKey: 'the API key'
}

/**
 * A failure the backend described, rather than a transport problem. Carries the stable `code`
 * from the problem document so a caller can branch on it without matching on prose.
 */
export class CleanseApiError extends Error {
  constructor({ status, code, title, detail, subject }) {
    super(detail ?? title ?? `Cleanse API returned ${status}`)
    this.name = 'CleanseApiError'
    this.status = status
    this.code = code
    this.title = title
    this.detail = detail
    /** Which item failed, where a request names several, such as the issue that could not move. */
    this.subject = subject
  }

  /** The stored version did not match the one the form carried. */
  get isConflict() {
    return this.status === 409
  }

  /**
   * The record asked for does not exist. Read from the code as well as the status, because the
   * backend answers an unknown import with a 400 that carries import.not_found.
   */
  get isNotFound() {
    return this.status === 404 || Boolean(this.code?.endsWith('.not_found'))
  }
}

async function readProblem(response) {
  try {
    const body = await response.json()
    return new CleanseApiError({
      status: response.status,
      code: body.code,
      title: body.title,
      detail: body.detail,
      subject: body.subject
    })
  } catch {
    return new CleanseApiError({ status: response.status })
  }
}

/**
 * Drops keys whose value is null, undefined or empty, and expands arrays into repeated keys,
 * which is how the backend binds a multi-valued filter.
 */
function toQuery(params = {}) {
  const query = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue
    }

    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== null && item !== '') {
        query.append(key, String(item))
      }
    }
  }

  const rendered = query.toString()
  return rendered ? `?${rendered}` : ''
}

export function createCleanseClient(options = {}) {
  const baseUrl = (options.baseUrl ?? config.get('cleanse.apiUrl')).replace(
    /\/$/,
    ''
  )
  const timeout = options.timeout ?? config.get('cleanse.timeout')
  const auth = options.auth ?? createAuthStrategy()
  const gatewayKey = options.gatewayKey ?? config.get('cleanse.gatewayKey')
  const traceHeader = config.get('tracing.header')

  /**
   * Getting a credential can fail by itself, most often an STS token that cannot be minted. That
   * surfaces like an unreachable backend, as an error a page can show, rather than as a crash.
   */
  async function credentials() {
    try {
      return await auth.headers()
    } catch (error) {
      logger.error(
        { err: error },
        'Could not get a credential for the Cleanse API'
      )
      throw new CleanseApiError({
        status: 503,
        code: 'api.credentials_unavailable',
        title: 'Could not authenticate to the Cleanse service',
        detail: `Could not get ${credentialNames[auth.name] ?? 'a credential'}: ${error.message}`
      })
    }
  }

  async function send(
    method,
    path,
    { query, body, headers: extra, traceId } = {}
  ) {
    const url = `${baseUrl}${path}${toQuery(query)}`
    const headers = {
      accept: 'application/json',
      // CDP's developer gateway, for a front-end on a developer's machine calling a deployed backend.
      ...(gatewayKey ? { 'x-api-key': gatewayKey } : {}),
      ...(await credentials()),
      ...extra
    }

    if (body !== undefined) {
      headers['content-type'] = 'application/json'
    }

    // Propagates the CDP request id so a frontend request and the backend work it causes can be
    // correlated in one log search.
    if (traceId) {
      headers[traceHeader] = traceId
    }

    const payload = body === undefined ? undefined : JSON.stringify(body)

    let response
    try {
      response = await fetch(url, {
        method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(timeout)
      })
    } catch (error) {
      // The path only: the query string can carry a caseworker's search term.
      logger.error(
        { err: error, url: `${baseUrl}${path}`, method },
        'Cleanse API request failed'
      )
      throw new CleanseApiError({
        status: 503,
        code: 'api.unreachable',
        title: 'The Cleanse service is unavailable'
      })
    }

    if (!response.ok) {
      throw await readProblem(response)
    }

    return response.status === 204 ? null : response.json()
  }

  /**
   * Issue ids are URL-safe by construction, so this only guards against an id that reached us
   * from somewhere other than the API.
   */
  const segment = (value) => encodeURIComponent(value)

  /**
   * The call surface, bound to one trace id. `forRequest` exists so the auth strategy — and
   * therefore its token cache — is shared across every request rather than rebuilt per call.
   *
   * `actingUserId` names the signed-in person, so the backend records a holding or list change
   * against them rather than against this service. It may be a function, read when a change is
   * sent, because the session that holds it is not loaded when a request starts.
   */
  function forRequest(traceId, { actingUserId } = {}) {
    const request = (method, path, options = {}) =>
      send(method, path, { ...options, traceId })

    const actingFor = () => {
      const id =
        typeof actingUserId === 'function' ? actingUserId() : actingUserId
      return id ? { 'x-cleanse-user-id': id } : {}
    }

    /** A change made for a person: a holding's or a list's. */
    const change = (method, path, body) =>
      request(method, path, { body, headers: actingFor() })

    return {
      recordLogin: (body) => request('POST', '/v1/users/logins', { body }),

      registerUsers: (body) => request('POST', '/v1/users', { body }),

      searchUsers: (query) => request('GET', '/v1/users', { query }),

      getGroups: () => request('GET', '/v1/groups'),

      getGroupSummary: (groupId) =>
        request('GET', `/v1/groups/${segment(groupId)}/summary`),

      getRules: () => request('GET', '/v1/rules'),

      searchIssues: (query) => request('GET', '/v1/issues', { query }),

      searchIssuesByCph: (query) =>
        request('GET', '/v1/issues/by-cph', { query }),

      getIssue: (id) => request('GET', `/v1/issues/${segment(id)}`),

      // A CPH has slashes in it, so it travels in the query string or the body, never the path.
      getHolding: (groupId, cph) =>
        request('GET', '/v1/holdings', { query: { groupId, cph } }),

      assignHolding: (body) => change('PUT', '/v1/holdings/assignee', body),

      addHoldingNote: (body) => change('POST', '/v1/holdings/notes', body),

      recordHoldingActions: (body) =>
        change('POST', '/v1/holdings/actions', body),

      updateHoldingIssues: (body) =>
        change('POST', '/v1/holdings/workflow-status', body),

      listCodedValues: (list, { activeOnly } = {}) =>
        request('GET', `/v1/lists/${segment(list)}`, {
          query: { activeOnly: activeOnly ? true : undefined }
        }),

      addCodedValue: (list, body) =>
        change('POST', `/v1/lists/${segment(list)}`, body),

      setCodedValueActive: (list, id, body) =>
        change('PUT', `/v1/lists/${segment(list)}/${segment(id)}/active`, body),

      getSettings: () => request('GET', '/v1/settings'),

      updateSettings: (body) => change('PUT', '/v1/settings', body),

      searchRuns: (query) => request('GET', '/v1/runs', { query }),

      getRun: (runId) => request('GET', `/v1/runs/${segment(runId)}`),

      triggerRun: () => request('POST', '/v1/runs/trigger'),

      getDiagnostics: (groupId) =>
        request('GET', '/v1/diagnostics', { query: { groupId } }),

      getMiStatus: (groupId) =>
        request('GET', `/v1/groups/${segment(groupId)}/mi/status`),

      getMiWork: (groupId, query) =>
        request('GET', `/v1/groups/${segment(groupId)}/mi/work`, { query }),

      getMiBacklog: (groupId, query) =>
        request('GET', `/v1/groups/${segment(groupId)}/mi/backlog`, { query }),

      /** Names the admin who asked, so the backend's log says who. */
      rebuildMi: (groupId) =>
        change('POST', `/v1/groups/${segment(groupId)}/mi/rebuild`),

      /**
       * The reset key is supplied by the operator per request and never held by this service,
       * so it travels as a header on this one call rather than through the auth strategy.
       */
      reset: ({ groupId, resetKey }) =>
        request('POST', '/v1/maintenance/reset', {
          body: { groupId: groupId ?? null },
          headers: { 'x-reset-key': resetKey }
        }),

      searchImports: (query) => request('GET', '/v1/imports', { query }),

      getImport: (id) => request('GET', `/v1/imports/${segment(id)}`),

      getImportRejections: (id, query) =>
        request('GET', `/v1/imports/${segment(id)}/rejections`, { query }),

      searchSpolDatasets: (query) => request('GET', '/v1/datasets', { query }),

      getSpolDataset: (id) => request('GET', `/v1/datasets/${segment(id)}`),

      /** The response carries the dataset's key, which nothing may keep. */
      createSpolDataset: (body) => change('POST', '/v1/datasets', body),

      renameSpolDataset: (id, body) =>
        request('PUT', `/v1/datasets/${segment(id)}/name`, { body }),

      deleteSpolDataset: (id) =>
        request('DELETE', `/v1/datasets/${segment(id)}`),

      processSpolDataset: (id, body) =>
        change('POST', `/v1/datasets/${segment(id)}/process`, body),

      // The connector's calls, passed on from /api with the key it gave, which no log may carry.
      checkSpolDatasetKey: (id, key) =>
        request('GET', `/v1/datasets/${segment(id)}`, {
          headers: { 'x-dataset-key': key }
        }),

      loadSpolDatasetPage: (id, key, body) =>
        request('POST', `/v1/datasets/${segment(id)}`, {
          body,
          headers: { 'x-dataset-key': key }
        })
    }
  }

  return { forRequest, ...forRequest(undefined) }
}
