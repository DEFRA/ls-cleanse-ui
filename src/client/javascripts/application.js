import {
  createAll,
  Button,
  Checkboxes,
  ErrorSummary,
  PasswordInput,
  Radios,
  SkipLink
} from 'govuk-frontend'

import { initGroupedTables } from './grouped-table.js'

createAll(Button)
createAll(Checkboxes)
createAll(ErrorSummary)
createAll(PasswordInput)
createAll(Radios)
createAll(SkipLink)

initGroupedTables()
