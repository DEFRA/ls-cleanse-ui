import process from 'node:process'

import { startServer } from '#/server/common/helpers/start-server.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import {
  reportProcessErrors,
  startOrExit
} from '#/server/common/helpers/process-errors.js'

const logger = createLogger()

reportProcessErrors(process, logger)

await startOrExit(startServer, process, logger)
