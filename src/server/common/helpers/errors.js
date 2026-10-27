import { statusCodes } from '../constants/status-codes.js'
import { CleanseApiError } from './cleanse/client.js'

function statusCodeMessage(statusCode) {
  switch (statusCode) {
    case statusCodes.notFound:
      return 'Page not found'
    case statusCodes.forbidden:
      return 'Forbidden'
    case statusCodes.unauthorized:
      return 'Unauthorized'
    case statusCodes.badRequest:
      return 'Bad Request'
    default:
      return 'Something went wrong'
  }
}

/**
 * A page whose address names a record, such as /issues/{id}, does not exist when the backend says
 * that record does not exist, so it is a 404 like any other unknown address. On a page that names
 * no record, a missing record means something is misconfigured, so it stays an error.
 */
function statusCodeFor(request) {
  const { response, params } = request
  const namesRecord = Object.keys(params ?? {}).length > 0

  if (
    namesRecord &&
    response instanceof CleanseApiError &&
    response.isNotFound
  ) {
    return statusCodes.notFound
  }

  return response.output.statusCode
}

export function catchAll(request, h) {
  const { response } = request

  if (!('isBoom' in response)) {
    return h.continue
  }

  const statusCode = statusCodeFor(request)
  const errorMessage = statusCodeMessage(statusCode)

  if (statusCode >= statusCodes.internalServerError) {
    request.logger.error(response?.stack)
  }

  return h
    .view('error/index', {
      pageTitle: errorMessage,
      heading: statusCode,
      message: errorMessage
    })
    .code(statusCode)
}
