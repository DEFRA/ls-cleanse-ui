/**
 * Routes the failures that would otherwise be printed to stderr as plain text — an unhandled
 * rejection, an uncaught exception, or a refused start-up — through the logger instead, so they
 * reach OpenSearch as ECS JSON like every other error.
 */
export function reportProcessErrors(proc, logger) {
  proc.on('unhandledRejection', (error) => {
    logger.error(error, 'Unhandled rejection')
    proc.exitCode = 1
  })

  // Node would print the stack and exit; this logs it first and still exits, since the process
  // state can no longer be trusted. Pino flushes its stream on exit.
  proc.on('uncaughtException', (error) => {
    logger.fatal(error, 'Uncaught exception')
    proc.exit(1)
  })
}

export async function startOrExit(start, proc, logger) {
  try {
    return await start()
  } catch (error) {
    logger.fatal(error, 'Server failed to start')
    proc.exitCode = 1
    return undefined
  }
}
