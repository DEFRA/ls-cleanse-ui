import { createHmac } from 'node:crypto'
import { Faker, en_GB as enGB, en, base } from '@faker-js/faker'

/**
 * Demo-mode anonymisation. Every backend response is rewritten before a controller sees it, so
 * no page, title or form can render a real value. Each fake is derived from an HMAC of the real
 * value, so the same input always gives the same output while the key is unchanged, and the
 * small CPH space cannot be brute-forced back to the original without the key.
 */

const cphPattern = /\b(\d{2})\/(\d{3})\/(\d{4})\b/g

const hidden = 'Hidden in demo mode.'

const holdingSuffixes = [
  'Farm',
  'Grange',
  'Hall Farm',
  'House Farm',
  'Manor Farm',
  'Croft',
  'Barns',
  'Meadows',
  'Fields',
  'Lodge'
]

const caseworkerNotes = [
  'Called the keeper, no answer. Will try again next week.',
  'Spoke to the keeper, who confirmed the holding is still in use.',
  'Letter sent asking the keeper to confirm their details.',
  'Keeper says the cattle moved to a neighbouring holding last year.',
  'Checked with the field team, awaiting their visit report.',
  'Keeper has retired. Confirming who now manages the land.',
  'Records updated in SAM following the keeper call.',
  'Holding appears to be sheep only. Checking with APHA.',
  'Email received from the agent acting for the keeper.',
  'Waiting on the keeper to send the tenancy agreement.',
  'Duplicate of another holding record. Raised with the data team.',
  'No response to the letter. Second letter sent.'
]

/** Context keys that describe the rule or a category, not a person or a place. */
const safeContextKeys = new Set([
  'ruleNumber',
  'errorCode',
  'errorDescription',
  'ctsPremisesType',
  'ctsCountyName',
  'samSpeciesCodes'
])

/** Responses that carry no personal data, so they are passed through untouched. */
const passThroughMethods = new Set([
  'getGroups',
  'getRules',
  'getDiagnostics',
  'reset'
])

const isBlank = (value) => value === undefined || value === null || value === ''

const isUpperCase = (value) =>
  value === value.toUpperCase() && value !== value.toLowerCase()

/** Only rewrites the keys an object actually has, so a transform is safe on any shape. */
function rewrite(object, rules) {
  if (!object || typeof object !== 'object') {
    return object
  }

  const copy = { ...object }
  for (const [key, rule] of Object.entries(rules)) {
    if (key in copy) {
      copy[key] = rule(copy[key])
    }
  }
  return copy
}

const page = (transform) => (result) =>
  rewrite(result, {
    items: (items) => (Array.isArray(items) ? items.map(transform) : items)
  })

export function createAnonymiser(key, { maxRemembered = 50000 } = {}) {
  if (!key) {
    throw new Error(
      'DEMO_ANONYMISE_KEY must be set when DEMO_ANONYMISE is on. Keep it stable to keep the fake values stable.'
    )
  }

  const faker = new Faker({ locale: [enGB, en, base] })

  // Fake to real, so a value read off the screen can be searched for.
  const remembered = new Map()

  function remember(fake, real) {
    const lookup = fake.trim().toLowerCase()
    if (remembered.has(lookup)) {
      return
    }
    if (remembered.size >= maxRemembered) {
      remembered.delete(remembered.keys().next().value)
    }
    remembered.set(lookup, real)
  }

  function seeded(kind, value, generate) {
    const digest = createHmac('sha256', key)
      .update(`${kind}\u0000${value}`)
      .digest()
    faker.seed([0, 4, 8, 12].map((offset) => digest.readUInt32BE(offset)))
    return generate(faker)
  }

  /** Replaces a value, keeping it searchable and keeping blank values blank. */
  const fakeOf = (kind, generate, { searchable = true } = {}) =>
    function (value) {
      if (isBlank(value)) {
        return value
      }
      const real = String(value)
      const fake = seeded(kind, real, generate)
      const cased = isUpperCase(real) ? fake.toUpperCase() : fake
      if (searchable) {
        remember(cased, real)
      }
      return cased
    }

  // The county prefix is kept so the CPH still agrees with the county shown beside it.
  const cphTail = fakeOf(
    'cph',
    (f) => {
      const digits = (length) =>
        f.string.numeric({ length, allowLeadingZeros: true })
      return `${digits(3)}/${digits(4)}`
    },
    { searchable: false }
  )

  // The county prefix is kept so the CPH still agrees with the county shown beside it.
  const fakeCph = (value) => {
    if (isBlank(value)) {
      return value
    }
    const real = String(value).trim()
    const match = /^(\d{2})\/\d{3}\/\d{4}$/.exec(real)
    if (!match) {
      return maskValue(real)
    }
    const fake = `${match[1]}/${cphTail(real)}`
    remember(fake, real)
    return fake
  }

  const replaceCphs = (text) =>
    text.replace(cphPattern, (found) => fakeCph(found))

  /** Shape-preserving fallback for anything not explicitly known to be safe. */
  const maskValue = (value) => {
    if (isBlank(value)) {
      return value
    }
    const real = String(value)
    const fake = seeded('mask', real, (f) =>
      [...real]
        .map((character) => {
          if (/\d/.test(character)) {
            return f.string.numeric(1)
          }
          if (/[A-Z]/.test(character)) {
            return f.string.alpha({ length: 1, casing: 'upper' })
          }
          if (/[a-z]/.test(character)) {
            return f.string.alpha({ length: 1, casing: 'lower' })
          }
          return character
        })
        .join('')
    )
    remember(fake, real)
    return fake
  }

  const surname = fakeOf('surname', (f) => f.person.lastName())
  const postcode = fakeOf('postcode', (f) => f.location.zipCode().toUpperCase())
  const holdingId = fakeOf('holdingId', (f) => f.string.uuid())
  const holdingName = fakeOf(
    'holdingName',
    (f) => `${f.person.lastName()} ${f.helpers.arrayElement(holdingSuffixes)}`
  )
  const personName = fakeOf('person', (f) => f.person.fullName(), {
    searchable: false
  })
  const personId = (value) =>
    value === 'system'
      ? value
      : fakeOf('personId', (f) => f.string.uuid(), { searchable: false })(value)
  const userId = fakeOf('userId', (f) => f.string.uuid())
  const note = fakeOf('note', (f) => f.helpers.arrayElement(caseworkerNotes), {
    searchable: false
  })
  const fileName = fakeOf(
    'fileName',
    (f) =>
      `spol-extract-${f.string.alphanumeric({ length: 6, casing: 'lower' })}.csv`,
    { searchable: false }
  )
  const hide = (value) => (isBlank(value) ? value : hidden)

  const locationNumber = (value) => {
    if (isBlank(value)) {
      return value
    }
    const real = String(value)
    const fake = replaceCphs(real)
    if (fake === real) {
      return maskValue(real)
    }
    remember(fake, real)
    return fake
  }

  const contextRules = {
    cph: fakeCph,
    ctsLocationNumber: locationNumber,
    ctsKeeperSurname: surname,
    ctsKeeperPostCode: postcode,
    samHoldingId: holdingId,
    samFeatureName: holdingName
  }

  function context(values) {
    if (!values || typeof values !== 'object') {
      return values
    }
    return Object.fromEntries(
      Object.entries(values).map(([name, value]) => {
        if (safeContextKeys.has(name)) {
          return [name, value]
        }
        // Fails closed: a key this file has never heard of is masked rather than shown.
        const rule = contextRules[name] ?? maskValue
        return [name, rule(value)]
      })
    )
  }

  const issue = (value) =>
    rewrite(value, {
      context,
      assignedTo: personName,
      assignedUserId: userId,
      assignedUserFullName: personName,
      notes: note,
      externalNotes: note
    })

  const historyEntry = (value) =>
    rewrite(value, {
      comments: note,
      createdById: personId,
      createdByDisplayName: personName
    })

  const run = (value) =>
    rewrite(value, {
      abandonReason: hide,
      failureMessage: hide,
      failureDetail: hide
    })

  const importJob = (value) =>
    rewrite(value, {
      fileName,
      requestedBy: personName,
      failureReason: hide
    })

  const rejection = (value) => rewrite(value, { detail: hide })

  const responses = {
    recordLogin: (value) =>
      rewrite(value, {
        id: userId,
        fullName: personName,
        subject: personId,
        objectId: personId
      }),
    searchUsers: page((value) =>
      rewrite(value, {
        id: userId,
        fullName: personName,
        subject: personId,
        objectId: personId
      })
    ),
    assignUser: issue,
    getGroupSummary: (value) => rewrite(value, { latestRun: run }),
    searchIssues: page(issue),
    getIssue: issue,
    getIssueHistory: page(historyEntry),
    setWorkflowStatus: issue,
    setNotes: issue,
    suppress: issue,
    unsuppress: issue,
    addHistory: historyEntry,
    searchRuns: page(run),
    getRun: run,
    triggerRun: run,
    searchImports: page(importJob),
    getImport: importJob,
    getImportRejections: page(rejection),
    uploadImport: importJob
  }

  /** Turns a fake the user read off the screen back into the value the backend holds. */
  function realSearchTerm(term) {
    if (isBlank(term)) {
      return term
    }
    return remembered.get(String(term).trim().toLowerCase()) ?? term
  }

  return { responses, realSearchTerm, fakeCph, context }
}

/**
 * Wraps a client so every call's response is anonymised. A client method with no rule here is
 * refused at startup, so a new endpoint cannot silently show real data.
 */
export function anonymiseClient(client, anonymiser) {
  function wrapMethod(name, method) {
    if (passThroughMethods.has(name)) {
      return method
    }

    const transform = anonymiser.responses[name]
    if (!transform) {
      throw new Error(
        `No demo anonymisation rule for Cleanse client method "${name}". Add one to anonymise.js.`
      )
    }

    if (name === 'searchIssues') {
      return async (query = {}) =>
        transform(
          await method({
            ...query,
            assignedUserId: anonymiser.realSearchTerm(query.assignedUserId),
            searchTerm: anonymiser.realSearchTerm(query.searchTerm)
          })
        )
    }

    if (name === 'assignUser') {
      return async (id, body) =>
        transform(
          await method(id, {
            ...body,
            userId: anonymiser.realSearchTerm(body.userId)
          })
        )
    }

    return async (...args) => transform(await method(...args))
  }

  const wrap = (calls) =>
    Object.fromEntries(
      Object.entries(calls).map(([name, method]) => [
        name,
        wrapMethod(name, method)
      ])
    )

  return {
    forRequest: (traceId) => wrap(client.forRequest(traceId)),
    ...wrap(client.forRequest(undefined))
  }
}
