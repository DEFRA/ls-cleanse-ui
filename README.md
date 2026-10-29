# ls-cleanse-ui

The Cleanse front-end: a GOV.UK-styled web application for DEFRA staff who triage data-quality
issues in livestock holding data.

Cleanse supports the manual migration of livestock holding data from CTS to SAM. The Cleanse
back-end, [ls-cleanse-api](https://github.com/DEFRA/ls-cleanse-api), runs a rules engine overnight
that detects discrepancies between the two systems and records each one as an issue. This service
is where caseworkers work through those issues:

- Sign in with Microsoft Entra ID.
- Browse the issues list, with filters and paging, and open an issue to see its details, history
  and audit trail.
- Act on an issue: assign it, add notes, record a case action, suppress it for a period, resolve,
  ignore or reopen it.

It is built with Node.js, Hapi and GOV.UK Frontend from the CDP Node.js frontend template. It holds
no data of its own: everything is read from and written to `ls-cleanse-api`.

- [Architecture](#architecture)
- [Requirements](#requirements)
- [Running locally](#running-locally)
  - [Signing in](#signing-in)
- [Configuration](#configuration)
- [Testing](#testing)
- [Docker](#docker)
- [Licence](#licence)

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the front-end, back-end, database and staff sign-in
fit together.

## Requirements

- Node.js 24. With [nvm](https://github.com/nvm-sh/nvm), run `nvm use` in the repository to select
  the version in `.nvmrc`.
- A running Cleanse back-end. By default the service expects `ls-cleanse-api` on
  `http://localhost:8085`; see that repository's README for how to start it.

## Running locally

Install dependencies and start the service in development mode (with file watching):

```bash
npm install
npm run dev
```

The service listens on <http://localhost:3000>.

On Windows, `dev-up.ps1` starts the service against a back-end for you:

```powershell
.\dev-up.ps1               # the local back-end on http://localhost:8085
.\dev-up.ps1 -Backend dev  # the back-end in CDP's dev environment, through the CDP developer gateway
```

`-Backend dev` needs two User environment variables: `CDP_EPHEMERAL_GW_KEY`, your developer API key
from your CDP Portal profile, and `CLEANSE_APIKEY`, the back-end's API key for dev. The gateway is
reachable from the DEFRA network only.

Both `dev-up.ps1` and `npm run dev` read settings from an ignored `.env` file in the repository
root; `.env.example` lists the variables. `dev-up.ps1` generates any missing local passwords and
saves them there.

To run in production mode locally, which builds the front-end assets and serves them as CDP does:

```bash
npm start
```

### Signing in

`AUTH_MODE` selects how users sign in:

- `entra` — Microsoft Entra ID, used in CDP. Set `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID` and
  `ENTRA_CLIENT_SECRET` for an app registration whose redirect URI is
  `http://localhost:3000/auth/entra/callback` locally. [ENTRA-AUTH.md](ENTRA-AUTH.md) describes
  setting up a test tenant and adding and removing users.
- `password` — the default locally. Users sign in with the value of `PASSWORD`.

## Configuration

Settings are read from environment variables; `src/config/config.js` lists them all, with their
defaults. In CDP, non-secret values live in `DEFRA/cdp-app-config` and secrets are set in the CDP
Portal; both take effect on the next deployment.

| Variable                  | Purpose                                                              | Default                                     |
| ------------------------- | -------------------------------------------------------------------- | ------------------------------------------- |
| `PORT`                    | Port the service listens on                                          | `3000`                                      |
| `CLEANSE_API_URL`         | Base URL of `ls-cleanse-api`                                         | `http://localhost:8085`                     |
| `CLEANSE_API_AUTH`        | How the back-end is called: `stsJwt` (CDP service token) or `apiKey` | `stsJwt` in production, otherwise `apiKey`  |
| `CLEANSE_API_KEY`         | Sent as `x-cleanse-api-key` when `CLEANSE_API_AUTH` is `apiKey`      | `local-development-key`                     |
| `CLEANSE_API_AUDIENCE`    | Audience of the CDP service token                                    | `ls-cleanse-api`                            |
| `CLEANSE_API_TIMEOUT`     | Back-end request timeout, in milliseconds                            | `20000`                                     |
| `CLEANSE_GATEWAY_KEY`     | Sent as `x-api-key` to the CDP developer gateway only                | not sent                                    |
| `CLEANSE_GROUP_ID`        | The rule group shown                                                 | `cts-sam`                                   |
| `AUTH_MODE`               | `entra` or `password`                                                | `password`                                  |
| `ENTRA_TENANT_ID`         | Entra tenant                                                         |                                             |
| `ENTRA_CLIENT_ID`         | Entra app registration (client) ID                                   |                                             |
| `ENTRA_CLIENT_SECRET`     | Entra client secret                                                  |                                             |
| `ENTRA_REDIRECT_URI`      | Sign-in callback URL                                                 | `http://localhost:3000/auth/entra/callback` |
| `PASSWORD`                | Sign-in password in `password` mode                                  |                                             |
| `SESSION_COOKIE_PASSWORD` | Key that encrypts the session cookie; at least 32 characters         | a public placeholder — always set it        |
| `SESSION_COOKIE_TTL`      | Session lifetime, in milliseconds                                    | 4 hours                                     |
| `LOG_LEVEL`               | Log level                                                            | `info`                                      |

Sessions are held in an encrypted browser cookie, so the service needs no session store.

## Testing

```bash
npm test                 # unit and route tests, with coverage (Vitest)
npm run lint             # ESLint and Stylelint
npm run format:check     # Prettier
npm run security-audit   # npm audit
```

The pull-request workflow runs the tests, the security audit and a Docker image build.

## Docker

Build and run the production image:

```bash
docker build --tag ls-cleanse-ui .
docker run -p 3000:3000 ls-cleanse-ui
```

`compose.yml` runs this service from the production image with `NODE_ENV=production`, as CDP does.
`compose.local-backend.yml` adds the back-end stack from the `ls-cleanse-api` repository, which must
be checked out alongside this one as `../ls-cleanse-api`:

| Service          | What it is                                   | Port |
| ---------------- | -------------------------------------------- | ---- |
| `ls-cleanse-ui`  | This service                                 | 3000 |
| `ls-cleanse-api` | The back-end, built from `../ls-cleanse-api` | 8085 |
| `postgres`       | The back-end's database                      | 5432 |
| `liquibase`      | Applies the back-end's schema, then exits    |      |
| `floci`          | A local S3 emulator used by the back-end     | 4566 |

On Windows, `dev-docker-up.ps1` builds the images, starts the stack, waits for the health checks
and confirms that the service answers:

```powershell
.\dev-docker-up.ps1                   # build and start the whole stack
.\dev-docker-up.ps1 -NoBuild -Follow  # start without rebuilding, then follow the logs
.\dev-docker-up.ps1 -Down             # stop, keeping the database; add -Reset to delete it
```

Without the script, set `PASSWORD` in your environment, then run:

```bash
docker compose -f compose.yml -f compose.local-backend.yml up --build --detach --wait
```

To use other host ports, set `CLEANSE_APP_PORT`, `CLEANSE_PORT`, `CLEANSE_POSTGRES_PORT` and
`CLEANSE_FLOCI_PORT`.

## Licence

THIS INFORMATION IS LICENSED UNDER THE CONDITIONS OF THE OPEN GOVERNMENT LICENCE found at:

<http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3>

The following attribution statement MUST be cited in your products and applications when using this information.

> Contains public sector information licensed under the Open Government license v3

### About the licence

The Open Government Licence (OGL) was developed by the Controller of Her Majesty's Stationery Office (HMSO) to enable
information providers in the public sector to license the use and re-use of their information under a common open
licence.

It is designed to encourage use and re-use of information freely and flexibly, with only a few conditions.
