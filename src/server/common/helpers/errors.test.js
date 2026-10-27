import { vi } from 'vitest'

import { catchAll } from './errors.js'
import { CleanseApiError } from './cleanse/client.js'
import { createServer } from '../../server.js'
import { statusCodes } from '../constants/status-codes.js'
import { signedInAsAdmin } from '#/test-helpers/sign-in.js'

const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

describe('#errors', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('Should provide expected Not Found page', async () => {
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/non-existent-path'
    })

    expect(result).toEqual(expect.stringContaining('Page not found - Cleanse'))
    expect(statusCode).toBe(statusCodes.notFound)
  })

  test.each([
    {
      page: '/admin/runs/0123456789abcdef0123456789abcdef',
      answer: () => json({ title: 'Not found', code: 'run.not_found' }, 404)
    },
    {
      // The backend refuses an unknown import with a 400, so its code is what says it is missing.
      page: '/admin/imports/0123456789abcdef0123456789abcdef',
      answer: () =>
        json({ title: 'Invalid request', code: 'import.not_found' }, 400)
    },
    {
      // An id that is not a GUID matches no backend route, so its 404 carries no problem document.
      page: '/admin/imports/does-not-exist',
      answer: () => new Response(null, { status: 404 })
    }
  ])(
    'Should answer $page with the page not found when the backend has no such record',
    async ({ page, answer }) => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        Promise.resolve(answer())
      )

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: page,
        auth: signedInAsAdmin
      })

      expect(result).toEqual(
        expect.stringContaining('Page not found - Cleanse')
      )
      expect(statusCode).toBe(statusCodes.notFound)
    }
  )
})

describe('#catchAll', () => {
  const mockErrorLogger = vi.fn()
  const mockStack = 'Mock error stack'
  const errorPage = 'error/index'
  const mockRequest = (statusCode) => ({
    response: {
      isBoom: true,
      stack: mockStack,
      output: {
        statusCode
      }
    },
    logger: { error: mockErrorLogger }
  })
  const mockToolkitView = vi.fn()
  const mockToolkitCode = vi.fn()
  const mockToolkit = {
    view: mockToolkitView.mockReturnThis(),
    code: mockToolkitCode.mockReturnThis()
  }

  test('Should provide expected "Not Found" page', () => {
    catchAll(mockRequest(statusCodes.notFound), mockToolkit)

    expect(mockErrorLogger).not.toHaveBeenCalledWith(mockStack)
    expect(mockToolkitView).toHaveBeenCalledWith(errorPage, {
      pageTitle: 'Page not found',
      heading: statusCodes.notFound,
      message: 'Page not found'
    })
    expect(mockToolkitCode).toHaveBeenCalledWith(statusCodes.notFound)
  })

  test('Should provide expected "Forbidden" page', () => {
    catchAll(mockRequest(statusCodes.forbidden), mockToolkit)

    expect(mockErrorLogger).not.toHaveBeenCalledWith(mockStack)
    expect(mockToolkitView).toHaveBeenCalledWith(errorPage, {
      pageTitle: 'Forbidden',
      heading: statusCodes.forbidden,
      message: 'Forbidden'
    })
    expect(mockToolkitCode).toHaveBeenCalledWith(statusCodes.forbidden)
  })

  test('Should provide expected "Unauthorized" page', () => {
    catchAll(mockRequest(statusCodes.unauthorized), mockToolkit)

    expect(mockErrorLogger).not.toHaveBeenCalledWith(mockStack)
    expect(mockToolkitView).toHaveBeenCalledWith(errorPage, {
      pageTitle: 'Unauthorized',
      heading: statusCodes.unauthorized,
      message: 'Unauthorized'
    })
    expect(mockToolkitCode).toHaveBeenCalledWith(statusCodes.unauthorized)
  })

  test('Should provide expected "Bad Request" page', () => {
    catchAll(mockRequest(statusCodes.badRequest), mockToolkit)

    expect(mockErrorLogger).not.toHaveBeenCalledWith(mockStack)
    expect(mockToolkitView).toHaveBeenCalledWith(errorPage, {
      pageTitle: 'Bad Request',
      heading: statusCodes.badRequest,
      message: 'Bad Request'
    })
    expect(mockToolkitCode).toHaveBeenCalledWith(statusCodes.badRequest)
  })

  test('Should provide expected default page', () => {
    catchAll(mockRequest(statusCodes.imATeapot), mockToolkit)

    expect(mockErrorLogger).not.toHaveBeenCalledWith(mockStack)
    expect(mockToolkitView).toHaveBeenCalledWith(errorPage, {
      pageTitle: 'Something went wrong',
      heading: statusCodes.imATeapot,
      message: 'Something went wrong'
    })
    expect(mockToolkitCode).toHaveBeenCalledWith(statusCodes.imATeapot)
  })

  test('Should provide expected "Something went wrong" page and log error for internalServerError', () => {
    catchAll(mockRequest(statusCodes.internalServerError), mockToolkit)

    expect(mockErrorLogger).toHaveBeenCalledWith(mockStack)
    expect(mockToolkitView).toHaveBeenCalledWith(errorPage, {
      pageTitle: 'Something went wrong',
      heading: statusCodes.internalServerError,
      message: 'Something went wrong'
    })
    expect(mockToolkitCode).toHaveBeenCalledWith(
      statusCodes.internalServerError
    )
  })

  describe('When the backend says a record does not exist', () => {
    /** As hapi hands it on: the backend's error, made a 500 because it is not a Boom error. */
    const backendError = (fields) =>
      Object.assign(new CleanseApiError(fields), {
        isBoom: true,
        output: { statusCode: statusCodes.internalServerError }
      })

    const requestFor = (response, params) => ({
      response,
      params,
      logger: { error: mockErrorLogger }
    })

    const notFound = () =>
      backendError({ status: 404, code: 'issue.not_found' })

    test('Should show "Page not found" on a page whose address names the record', () => {
      catchAll(
        requestFor(notFound(), { id: '1-AAAAAAAAAAAAAAAA' }),
        mockToolkit
      )

      expect(mockErrorLogger).not.toHaveBeenCalled()
      expect(mockToolkitView).toHaveBeenCalledWith(errorPage, {
        pageTitle: 'Page not found',
        heading: statusCodes.notFound,
        message: 'Page not found'
      })
      expect(mockToolkitCode).toHaveBeenCalledWith(statusCodes.notFound)
    })

    /** Such a page asked for something it was configured with, not something in its address. */
    test('Should show and log an error on a page that names no record', () => {
      catchAll(requestFor(notFound(), {}), mockToolkit)

      expect(mockErrorLogger).toHaveBeenCalled()
      expect(mockToolkitCode).toHaveBeenCalledWith(
        statusCodes.internalServerError
      )
    })

    test('Should still show and log any other backend failure as an error', () => {
      catchAll(
        requestFor(backendError({ status: 503, code: 'api.unreachable' }), {
          id: '1-AAAAAAAAAAAAAAAA'
        }),
        mockToolkit
      )

      expect(mockErrorLogger).toHaveBeenCalled()
      expect(mockToolkitCode).toHaveBeenCalledWith(
        statusCodes.internalServerError
      )
    })
  })
})
