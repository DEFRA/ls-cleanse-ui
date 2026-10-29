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
  constructor({ status, code, title, detail }) {
    super(detail ?? title ?? `Cleanse API returned ${status}`)
    this.name = 'CleanseApiError'
    this.status = status
    this.code = code
    this.title = title
    this.detail = detail
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
      detail: body.detail
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
    { query, body, form, headers: extra, traceId } = {}
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

    // fetch derives the multipart boundary itself, so content-type must be left unset.
    const payload =
      form ?? (body === undefined ? undefined : JSON.stringify(body))

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
   */
  function forRequest(traceId) {
    const request = (method, path, options = {}) =>
      send(method, path, { ...options, traceId })

    return {
      recordLogin: (body) => request('POST', '/v1/users/logins', { body }),

      searchUsers: (query) => request('GET', '/v1/users', { query }),

      assignUser: (id, body) =>
        request('PUT', `/v1/issues/${segment(id)}/assignee`, { body }),

      getGroups: () => request('GET', '/v1/groups'),

      getGroupSummary: (groupId) =>
        request('GET', `/v1/groups/${segment(groupId)}/summary`),

      getRules: () => request('GET', '/v1/rules'),

      searchIssues: (query) => request('GET', '/v1/issues', { query }),

      getIssue: (id) => request('GET', `/v1/issues/${segment(id)}`),

      getIssueHistory: (id, query) =>
        request('GET', `/v1/issues/${segment(id)}/history`, { query }),

      setWorkflowStatus: (id, body) =>
        request('PUT', `/v1/issues/${segment(id)}/workflow-status`, { body }),

      setNotes: (id, body) =>
        request('PUT', `/v1/issues/${segment(id)}/notes`, { body }),

      suppress: (id, body) =>
        request('PUT', `/v1/issues/${segment(id)}/suppression`, { body }),

      unsuppress: (id, expectedVersion) =>
        request('DELETE', `/v1/issues/${segment(id)}/suppression`, {
          query: { expectedVersion }
        }),

      addHistory: (id, body) =>
        request('POST', `/v1/issues/${segment(id)}/history`, { body }),

      searchRuns: (query) => request('GET', '/v1/runs', { query }),

      getRun: (runId) => request('GET', `/v1/runs/${segment(runId)}`),

      triggerRun: () => request('POST', '/v1/runs/trigger'),

      getDiagnostics: (groupId) =>
        request('GET', '/v1/diagnostics', { query: { groupId } }),

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

      uploadImport: ({ groupId, fileName, content, tenantId, clientId }) => {
        const form = new FormData()
        form.append('groupId', groupId)
        if (tenantId && clientId) {
          form.append('tenantId', tenantId)
          form.append('clientId', clientId)
        }
        form.append('file', new Blob([content], { type: 'text/csv' }), fileName)
        return request('POST', '/v1/imports', { form })
      }
    }
  }

  return { forRequest, ...forRequest(undefined) }
}
