/**
 * Credentials for server.inject. Hapi uses them in place of a signed-in session, so a test of a
 * page need not sign in first. Signing in itself is tested in src/server/plugins/auth.test.js.
 */
export const signedIn = {
  strategy: 'service',
  credentials: { gate: 'service' }
}

/** Signed in to the admin area as well. */
export const signedInAsAdmin = {
  strategy: 'admin',
  credentials: { gate: 'admin' }
}

/**
 * Talks to a server the way a browser does, keeping its cookies from one request to the next, so
 * a test can sign in for real.
 */
export function createBrowser(server) {
  const cookies = new Map()

  async function send(options) {
    const cookie = [...cookies].map(([name, value]) => `${name}=${value}`)
    const response = await server.inject({
      ...options,
      headers: cookie.length ? { cookie: cookie.join('; ') } : {}
    })

    for (const header of [response.headers['set-cookie'] ?? []].flat()) {
      const [pair] = header.split(';')
      const at = pair.indexOf('=')
      cookies.set(pair.slice(0, at), pair.slice(at + 1))
    }

    return response
  }

  return {
    cookies,
    get: (url) => send({ method: 'GET', url }),
    post: (url, payload) =>
      send({
        method: 'POST',
        url,
        payload: { crumb: cookies.get('crumb'), ...payload }
      }),
    /** Opens a page with a form first, as a person would, then submits it. */
    async submit(url, payload) {
      await send({ method: 'GET', url })
      return this.post(url, payload)
    }
  }
}
