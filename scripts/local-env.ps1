function Initialize-LocalEnvironment {
    # Node's dotenv parser keeps PowerShell and the Node/Compose entry points consistent.
    $script = @'
import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { randomBytes } from 'node:crypto'
const file = '.env'
if (!existsSync(file)) {
  writeFileSync(file, 'AUTH_MODE=entra\nENTRA_TENANT_ID=\nENTRA_CLIENT_ID=\nENTRA_CLIENT_SECRET=\nENTRA_REDIRECT_URI=http://localhost:3000/auth/entra/callback\nENTRA_POST_LOGOUT_REDIRECT_URI=http://localhost:3000/login\n', { mode: 0o600 })
}
const values = parseEnv(readFileSync(file, 'utf8'))
for (const name of ['SESSION_COOKIE_PASSWORD', 'ADMIN_PASSWORD', 'PASSWORD']) {
  if (!values[name]) {
    values[name] = randomBytes(32).toString('base64url')
    appendFileSync(file, `\n${name}=${values[name]}\n`)
  }
}
process.stdout.write(JSON.stringify(values))
'@
    $json = $script | & node --input-type=module
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not load the local .env file.'
    }
    $values = $json | ConvertFrom-Json
    foreach ($property in $values.PSObject.Properties) {
        Set-Item -LiteralPath "Env:$($property.Name)" -Value $property.Value
    }
    if ($env:AUTH_MODE -eq 'entra') {
        foreach ($name in 'ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET') {
            if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, 'Process'))) {
                throw "Set $name in the ignored local .env file before starting Entra authentication."
            }
        }
    }
}
