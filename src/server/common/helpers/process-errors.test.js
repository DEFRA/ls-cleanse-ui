import { EventEmitter } from 'node:events'
import { vi } from 'vitest'

import { reportProcessErrors, startOrExit } from './process-errors.js'

function fakeProcess() {
  const proc = new EventEmitter()
  proc.exitCode = undefined
  proc.exit = vi.fn()
  return proc
}

const fakeLogger = () => ({ error: vi.fn(), fatal: vi.fn() })

describe('#reportProcessErrors', () => {
  test('Should log an unhandled rejection and mark the process as failed', () => {
    const proc = fakeProcess()
    const logger = fakeLogger()
    reportProcessErrors(proc, logger)
    const error = new Error('nobody caught this')

    proc.emit('unhandledRejection', error)

    expect(logger.error).toHaveBeenCalledWith(error, 'Unhandled rejection')
    expect(proc.exitCode).toBe(1)
    expect(proc.exit).not.toHaveBeenCalled()
  })

  test('Should log an uncaught exception, then exit', () => {
    const proc = fakeProcess()
    const logger = fakeLogger()
    reportProcessErrors(proc, logger)
    const error = new Error('thrown from nowhere')

    proc.emit('uncaughtException', error)

    expect(logger.fatal).toHaveBeenCalledWith(error, 'Uncaught exception')
    expect(proc.exit).toHaveBeenCalledWith(1)
  })
})

describe('#startOrExit', () => {
  test('Should return the started server', async () => {
    const proc = fakeProcess()
    const server = { info: {} }

    await expect(
      startOrExit(async () => server, proc, fakeLogger())
    ).resolves.toBe(server)
    expect(proc.exitCode).toBeUndefined()
  })

  test('Should log a refused start-up through the logger and fail the process', async () => {
    const proc = fakeProcess()
    const logger = fakeLogger()
    const error = new Error('ENTRA_CLIENT_SECRET is required in Entra mode')

    const result = await startOrExit(
      async () => {
        throw error
      },
      proc,
      logger
    )

    expect(result).toBeUndefined()
    expect(logger.fatal).toHaveBeenCalledWith(error, 'Server failed to start')
    expect(proc.exitCode).toBe(1)
  })
})
