import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from 'node:crypto'

import { config } from '#/config/config.js'

/** Where a session records what its owner has signed in to. */
const sessionKey = 'signedIn'
const entraKey = 'entraIdentity'

export const isEntra = () => config.get('auth.mode') === 'entra'

export function entraFingerprint() {
  const { tenantId, clientId, clientSecret } = config.get('auth.entra')
  return createHash('sha256')
    .update(JSON.stringify([tenantId, clientId, clientSecret]))
    .digest('base64url')
}

export function entraIdentity(request) {
  if (!isEntra()) {
    return null
  }
  const identity = signedInFrom(request, entraKey)
  return identity &&
    identity.fingerprint === entraFingerprint() &&
    isCurrent(identity)
    ? identity
    : null
}

export function signInEntra(request, user) {
  request.yar.reset()
  const signedInAt = Date.now()
  request.yar.set(entraKey, {
    userId: user.id,
    signedInAt,
    fingerprint: entraFingerprint()
  })
  request.yar.set(sessionKey, {
    signedInAt,
    mode: 'entra',
    nonce: randomBytes(16).toString('base64url')
  })
}

/**
 * Every page is behind the service password. The admin area is behind the admin password as
 * well, which is only asked of someone already signed in.
 */
export const gates = {
  service: { setting: 'auth.password', signInPath: '/login', home: '/' },
  admin: {
    setting: 'auth.adminPassword',
    signInPath: '/admin/login',
    home: '/admin'
  }
}

/** Surrounding white space is ignored on both sides: it is too easily pasted with a password. */
const passwordFor = (gate) => config.get(gates[gate].setting).trim()

/**
 * What a session holds in place of a password: proof that its owner typed it, for this sign-in
 * only. It is a MAC, under the password, of when the sign-in was made and a random value, so it
 * cannot be made without the password, even by someone who can read or write the cookie. Nor can
 * one copied from a cookie be moved to another time, to outlive its sign-in. It stops matching
 * when the password changes, which signs everyone out.
 */
const proofOf = (gate, password, { signedInAt, nonce }) =>
  createHmac('sha256', password)
    .update(`cleanse-app:${gate}:${signedInAt}:${nonce}`)
    .digest()

const digestOf = (value) => createHash('sha256').update(value).digest()

const same = (a, b) => a.length === b.length && timingSafeEqual(a, b)

/** Whether a gate can be opened at all. With no password set, it admits nobody. */
export const isConfigured = (gate) => passwordFor(gate) !== ''

/** Compared as fixed-length digests, so the time taken says nothing about the password. */
export function isPassword(gate, candidate) {
  const password = passwordFor(gate)

  return (
    password !== '' &&
    typeof candidate === 'string' &&
    same(digestOf(candidate.trim()), digestOf(password))
  )
}

/** A sign-in lasts as long as the session cookie would, however busy the session has been. */
function isCurrent(signedIn) {
  const age = Date.now() - signedIn.signedInAt
  return (
    Number.isInteger(signedIn.signedInAt) &&
    age >= 0 &&
    age <
      Math.min(
        config.get('session.cookie.ttl'),
        isEntra() ? 14400000 : Infinity
      )
  )
}

/**
 * The session's sign-in, if any. Hapi answers an address that matches no route without loading
 * the session, and yar then throws rather than answer, so there is none to read.
 */
function signedInFrom(request, key = sessionKey) {
  try {
    return request?.yar?.get(key) ?? null
  } catch {
    return null
  }
}

/** Whether the session has been signed in to a gate with its current password. */
export function isSignedInTo(request, gate) {
  if (gate === 'service' && isEntra()) {
    return Boolean(entraIdentity(request))
  }
  const signedIn = signedInFrom(request)
  const password = passwordFor(gate)

  if (
    password === '' ||
    (signedIn?.mode ?? 'password') !== config.get('auth.mode') ||
    (isEntra() && !entraIdentity(request)) ||
    typeof signedIn?.[gate] !== 'string' ||
    typeof signedIn.nonce !== 'string' ||
    !isCurrent(signedIn)
  ) {
    return false
  }

  return same(
    Buffer.from(signedIn[gate], 'base64url'),
    proofOf(gate, password, signedIn)
  )
}

/** For pages that do not require it, such as an unknown address, as well as those that do. */
export function isSignedIn(request) {
  return (
    request?.auth?.isAuthenticated === true || isSignedInTo(request, 'service')
  )
}

export function signIn(request, gate) {
  const current = gate === 'service' ? null : request.yar.get(sessionKey)

  if (gate === 'service') {
    // A fresh session for a fresh sign-in: nothing carries over from before it.
    request.yar.reset()
  }

  // The admin sign-in joins the service one, made at the same moment, so both end together.
  const signedIn = {
    ...current,
    signedInAt: current?.signedInAt ?? Date.now(),
    nonce: current?.nonce ?? randomBytes(16).toString('base64url')
  }
  signedIn.mode = config.get('auth.mode')
  signedIn[gate] = proofOf(gate, passwordFor(gate), signedIn).toString(
    'base64url'
  )

  request.yar.set(sessionKey, signedIn)
}

export function signOut(request) {
  request.yar.reset()
}

/**
 * Sends the visitor to sign in, remembering the page they asked for. Only a page can be gone back
 * to: a form submission cannot be replayed, so after signing in it starts again from the gate's
 * home page.
 */
function toSignIn(request, h, gate) {
  const { signInPath } = gates[gate]
  const asked = request.url.pathname + request.url.search
  const location =
    ['get', 'head'].includes(request.method) && asked !== '/'
      ? `${signInPath}?${new URLSearchParams({ next: asked })}`
      : signInPath

  return h.redirect(location).takeover()
}

function passwordScheme(_server, { gate }) {
  return {
    authenticate(request, h) {
      if (!isSignedInTo(request, 'service')) {
        return toSignIn(request, h, 'service')
      }

      if (gate === 'admin' && !isSignedInTo(request, 'admin')) {
        return toSignIn(request, h, 'admin')
      }

      return h.authenticated({ credentials: { gate } })
    }
  }
}

/**
 * Password sign-in, held in the encrypted session cookie. The service strategy is the default, so
 * a route is behind the password unless it opts out with auth: false; the admin strategy asks for
 * both passwords.
 */
export const auth = {
  plugin: {
    name: 'auth',
    dependencies: ['@hapi/yar'],
    register(server) {
      server.auth.scheme('password', passwordScheme)
      server.auth.strategy('service', 'password', { gate: 'service' })
      server.auth.strategy('admin', 'password', { gate: 'admin' })
      server.auth.default('service')
    }
  }
}
