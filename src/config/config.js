import convict from 'convict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import convictFormatWithValidator from 'convict-format-with-validator'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const fourHoursMs = 14400000
const oneWeekMs = 604800000

const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'
const isDevelopment = process.env.NODE_ENV === 'development'

convict.addFormats(convictFormatWithValidator)

export const config = convict({
  serviceVersion: {
    doc: 'The service version, this variable is injected into your docker container in CDP environments',
    format: String,
    nullable: true,
    default: null,
    env: 'SERVICE_VERSION'
  },
  cdpEnvironment: {
    doc: 'The CDP environment the service is running in, injected into the container by the platform. "local" when unset',
    format: String,
    default: 'local',
    env: 'ENVIRONMENT'
  },
  host: {
    doc: 'The IP address to bind',
    format: 'ipaddress',
    default: '0.0.0.0',
    env: 'HOST'
  },
  port: {
    doc: 'The port to bind.',
    format: 'port',
    default: 3000,
    env: 'PORT'
  },
  staticCacheTimeout: {
    doc: 'Static cache timeout in milliseconds',
    format: Number,
    default: oneWeekMs,
    env: 'STATIC_CACHE_TIMEOUT'
  },
  serviceName: {
    doc: 'Applications Service Name',
    format: String,
    default: 'ls-cleanse-ui'
  },
  serviceDisplayName: {
    doc: 'The service name shown to users. Distinct from the CDP service identity.',
    format: String,
    default: 'Cleanse'
  },
  root: {
    doc: 'Project root',
    format: String,
    default: path.resolve(dirname, '../..')
  },
  assetPath: {
    doc: 'Asset path',
    format: String,
    default: '/public',
    env: 'ASSET_PATH'
  },
  isProduction: {
    doc: 'If this application running in the production environment',
    format: Boolean,
    default: isProduction
  },
  isDevelopment: {
    doc: 'If this application running in the development environment',
    format: Boolean,
    default: isDevelopment
  },
  isTest: {
    doc: 'If this application running in the test environment',
    format: Boolean,
    default: isTest
  },
  log: {
    enabled: {
      doc: 'Is logging enabled',
      format: Boolean,
      default: process.env.NODE_ENV !== 'test',
      env: 'LOG_ENABLED'
    },
    level: {
      doc: 'Logging level',
      format: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],
      default: 'info',
      env: 'LOG_LEVEL'
    },
    format: {
      doc: 'Format to output logs in.',
      format: ['ecs', 'pino-pretty'],
      default: isProduction ? 'ecs' : 'pino-pretty',
      env: 'LOG_FORMAT'
    },
    redact: {
      doc: 'Log paths to redact',
      format: Array,
      default: isProduction
        ? ['req.headers.authorization', 'req.headers.cookie', 'res.headers']
        : [],
      env: 'LOG_REDACT'
    }
  },
  httpProxy: {
    doc: 'HTTP Proxy',
    format: String,
    nullable: true,
    default: null,
    env: 'HTTP_PROXY'
  },
  isSecureContextEnabled: {
    doc: 'Enable Secure Context',
    format: Boolean,
    default: isProduction,
    env: 'ENABLE_SECURE_CONTEXT'
  },
  session: {
    cookie: {
      ttl: {
        doc: 'Session cookie ttl. Also how long a sign-in lasts, however busy the session',
        format: Number,
        default: fourHoursMs,
        env: 'SESSION_COOKIE_TTL'
      },
      password: {
        doc: 'session cookie password',
        format: String,
        default: 'the-password-must-be-at-least-32-characters-long',
        env: 'SESSION_COOKIE_PASSWORD',
        sensitive: true
      },
      secure: {
        doc: 'set secure flag on cookie',
        format: Boolean,
        default: isProduction,
        env: 'SESSION_COOKIE_SECURE'
      }
    }
  },
  auth: {
    mode: {
      doc: 'Service sign-in method. Entra access is restricted by enterprise application assignment',
      format: ['password', 'entra'],
      default: 'password',
      env: 'AUTH_MODE'
    },
    entra: {
      tenantId: {
        format: String,
        default: '',
        env: 'ENTRA_TENANT_ID'
      },
      clientId: {
        format: String,
        default: '',
        env: 'ENTRA_CLIENT_ID'
      },
      clientSecret: {
        format: String,
        default: '',
        sensitive: true,
        env: 'ENTRA_CLIENT_SECRET'
      },
      redirectUri: {
        format: String,
        default: 'http://localhost:3000/auth/entra/callback',
        env: 'ENTRA_REDIRECT_URI'
      },
      postLogoutRedirectUri: {
        format: String,
        default: 'http://localhost:3000/login',
        env: 'ENTRA_POST_LOGOUT_REDIRECT_URI'
      }
    },
    password: {
      doc: 'The password everyone signs in to the service with. A CDP Portal secret. While it is unset, nobody can sign in',
      format: String,
      default: '',
      sensitive: true,
      env: 'PASSWORD'
    },
    adminPassword: {
      doc: 'The second password the admin area asks for, once signed in. A CDP Portal secret. While it is unset, the admin area cannot be opened',
      format: String,
      default: '',
      sensitive: true,
      env: 'ADMIN_PASSWORD'
    }
  },
  nunjucks: {
    watch: {
      doc: 'Reload templates when they are changed.',
      format: Boolean,
      default: isDevelopment
    },
    noCache: {
      doc: 'Use a cache and recompile templates each time',
      format: Boolean,
      default: isDevelopment
    }
  },
  tracing: {
    header: {
      doc: 'Which header to track',
      format: String,
      default: 'x-cdp-request-id',
      env: 'TRACING_HEADER'
    }
  },
  aws: {
    region: {
      doc: 'AWS region, used when minting an STS web identity token',
      format: String,
      default: 'eu-west-2',
      env: 'AWS_REGION'
    }
  },
  cleanse: {
    apiUrl: {
      doc: 'Base URL of the Cleanse backend',
      format: String,
      default: 'http://localhost:8085',
      env: 'CLEANSE_API_URL'
    },
    audience: {
      doc: 'Audience the backend expects in a web identity token. Chosen by us, not the platform',
      format: String,
      default: 'ls-cleanse-api',
      env: 'CLEANSE_API_AUDIENCE'
    },
    auth: {
      doc: 'How to authenticate to the backend. LocalStack does not implement GetWebIdentityToken, so local development uses the shared key',
      format: ['stsJwt', 'apiKey'],
      default: isProduction ? 'stsJwt' : 'apiKey',
      env: 'CLEANSE_API_AUTH'
    },
    apiKey: {
      doc: 'Shared key for the x-cleanse-api-key header. Only read when auth is apiKey',
      format: String,
      default: 'local-development-key',
      sensitive: true,
      env: 'CLEANSE_API_KEY'
    },
    gatewayKey: {
      doc: "Developer key for CDP's ephemeral API gateway, sent as x-api-key. Local development only: it lets a front-end on a developer's machine call a deployed backend through https://ephemeral-protected.api.<env>.cdp-int.defra.cloud/ls-cleanse-api. Never set on CDP",
      format: String,
      default: '',
      sensitive: true,
      env: 'CLEANSE_GATEWAY_KEY'
    },
    timeout: {
      doc: 'Milliseconds to wait for the backend before giving up',
      format: Number,
      default: 20000,
      env: 'CLEANSE_API_TIMEOUT'
    },
    groupId: {
      doc: 'The rule group the service works in. Only cts-sam exists today',
      format: String,
      default: 'cts-sam',
      env: 'CLEANSE_GROUP_ID'
    }
  },
  demo: {
    anonymise: {
      doc: 'Replace personal data from the backend with stable fake values before it reaches any page. For demos only',
      format: Boolean,
      default: false,
      env: 'DEMO_ANONYMISE'
    },
    anonymiseKey: {
      doc: 'Secret that seeds the fake values. The same key always gives the same fakes; a different key gives different ones. Required when anonymise is on',
      format: String,
      default: '',
      sensitive: true,
      env: 'DEMO_ANONYMISE_KEY'
    }
  }
})

config.validate({ allowed: 'strict' })
