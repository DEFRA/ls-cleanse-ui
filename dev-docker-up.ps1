<#
.SYNOPSIS
Runs ls-cleanse-ui in Docker the way CDP runs it, with the Cleanse backend in the same stack or
against the backend deployed in CDP's dev environment.

.DESCRIPTION
Builds the production image and starts compose.yml: NODE_ENV=production, ECS JSON logs and
sessions in an encrypted cookie. Waits until the stack is healthy, checks that it answers, signs
in and reads the status page back.

Loads local settings and secrets from the ignored .env file. Entra mode requires
ENTRA_TENANT_ID, ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET. The admin area retains its password.

With -Backend local, the default, compose.local-backend.yml adds the backend's own stack from the
ls-cleanse-api repository, which must be checked out next to this one, as ../ls-cleanse-api:

  cleanse    the backend, built from ../cleanse with Production settings
  postgres   its database, with CDP's two roles, kept in this stack's volume between runs
  liquibase  applies the backend's changelog and exits, as Portal > Apply Changelog does
  floci      the S3 emulator holding the imports bucket

The backend's own stack (../ls-cleanse-api/dev-docker-up.ps1) publishes the same ports, so stop it
first. Its database is separate, and is kept.

For live reload while you work on the front end, use ./dev-up.ps1, which runs on Node instead.

Host ports default to 3000 (app), 8085 (backend), 5432 (Postgres) and 4566 (floci). Move them
with the CLEANSE_APP_PORT, CLEANSE_PORT, CLEANSE_POSTGRES_PORT and CLEANSE_FLOCI_PORT
environment variables.

.PARAMETER Backend
local  The backend built from ../ls-cleanse-api, run in this stack. The default.
dev    cleanse in CDP's dev environment, through CDP's developer ephemeral gateway. Needs the User
       environment variables CDP_EPHEMERAL_GW_KEY (your developer key for dev, from your user
       profile in the CDP Portal; it lasts 24 hours) and CLEANSE_APIKEY (cleanse's
       Auth__ApiKey__Key secret for dev). Changes you make are made to dev's data.

.PARAMETER NoBuild
Reuse the last images instead of rebuilding them. Faster, but ignores code changes made since.
The backend's image build runs its Cleanse.Test and Cleanse.Rules.Test suites.

.PARAMETER Reset
Delete the stack's database first, so the backend starts empty. With -Down, delete it on the way
out. Only for -Backend local.

.PARAMETER Follow
Follow the logs once the stack is up. Ctrl+C stops following; the stack keeps running.

.PARAMETER Down
Stop the stack and exit. The database is kept unless -Reset is also given.

.PARAMETER SkipSmoke
Skip the HTTP checks made once the stack reports healthy.

.PARAMETER KrdsSnapshot
Path to a KRDS snapshot (.sqlite). Turns the backend's rules engine on against it, mounted
read-only, so that a rule run can be started from the app's Runs page. Defaults to
$env:CLEANSE_KRDS_SNAPSHOT; leave both unset to keep the engine off. Only for -Backend local.

.EXAMPLE
./dev-docker-up.ps1

.EXAMPLE
./dev-docker-up.ps1 -KrdsSnapshot A:\tmp\defra-krds-duckdb\krds-db_20261019070003.sqlite

.EXAMPLE
./dev-docker-up.ps1 -Backend dev

.EXAMPLE
./dev-docker-up.ps1 -Down
#>
[CmdletBinding()]
param(
  [ValidateSet('local', 'dev')]
  [string]$Backend = 'local',

  [switch]$NoBuild,
  [switch]$Reset,
  [switch]$Follow,
  [switch]$Down,
  [switch]$SkipSmoke,
  [string]$KrdsSnapshot = $env:CLEANSE_KRDS_SNAPSHOT
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'scripts\backend-target.ps1')
. (Join-Path $PSScriptRoot 'scripts\sign-in.ps1')
. (Join-Path $PSScriptRoot 'scripts\local-env.ps1')

# Matches `name:` in compose.yml. Passed explicitly so COMPOSE_PROJECT_NAME cannot redirect it.
$project = 'ls-cleanse-ui'
# The project name of the backend's own stack, in ../ls-cleanse-api/compose.yml.
$backendStackProject = 'ls-cleanse-api'
# Where compose.local-backend.yml includes the backend from.
$backendRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'ls-cleanse-api'
# The variable that moves each service's host port, for error messages.
$portVariables = @{
  'ls-cleanse-ui' = 'CLEANSE_APP_PORT'
  'ls-cleanse-api'     = 'CLEANSE_PORT'
  'postgres'    = 'CLEANSE_POSTGRES_PORT'
  'floci'       = 'CLEANSE_FLOCI_PORT'
}

function Write-Step([string]$Message) {
  Write-Host "==> $Message" -ForegroundColor Cyan
}

# Windows PowerShell turns a native command's redirected stderr into terminating errors under
# ErrorActionPreference=Stop; the exit code is the signal that matters, so read that instead.
function Invoke-Native([scriptblock]$Command) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Command } finally { $ErrorActionPreference = $previous }
}

function Assert-Docker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'The docker CLI was not found. Install Docker Desktop (or another Docker engine) and try again.'
  }

  $server = Invoke-Native { docker version --format '{{.Server.Version}}' 2>$null }
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace("$server")) {
    throw 'Docker is installed but the engine is not reachable. Start Docker Desktop and try again.'
  }

  $compose = Invoke-Native { docker compose version --short 2>$null }
  if ($LASTEXITCODE -ne 0) {
    throw 'Docker Compose v2 (the "docker compose" plugin) is required.'
  }

  Write-Host "    Docker engine $server, Compose $compose"
}

# Checked before Compose reads them, because its own message for a bad port is less helpful.
function Assert-PortVariables {
  foreach ($variable in $portVariables.Values) {
    $value = [Environment]::GetEnvironmentVariable($variable)
    if ([string]::IsNullOrWhiteSpace($value)) {
      continue
    }

    $port = 0
    if (-not [int]::TryParse($value, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
      throw "$variable must be a port number between 1 and 65535; found '$value'."
    }
  }
}

# The stack as Compose resolves it, with every variable and include applied. Ports, credentials
# and the bucket are read from here, so they cannot drift from the compose files.
function Get-ComposeModel {
  $output = @(Invoke-Native { docker compose --project-name $project @composeFiles config --format json 2>&1 })
  if ($LASTEXITCODE -ne 0) {
    $errors = @($output | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] } | ForEach-Object { "$_" })
    throw "Compose could not read the stack's files: $($errors -join ' ')"
  }

  return (@($output | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }) -join "`n") | ConvertFrom-Json
}

function Get-HostPort($Model, [string]$Service) {
  return [int]@($Model.services.$Service.ports)[0].published
}

function Get-PortBindings($Model) {
  foreach ($service in $Model.services.PSObject.Properties) {
    foreach ($port in @($service.Value.ports)) {
      if ($port -and $port.published) {
        [pscustomobject]@{ Port = [int]$port.published; Service = $service.Name; Variable = $portVariables[$service.Name] }
      }
    }
  }
}

# Names whoever holds a port, for the error message only. Best effort, hence the retries: on some
# Windows machines the listener table briefly omits a listener that is accepting connections.
function Get-PortOwner([int]$Port) {
  if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) {
    return $null
  }

  for ($attempt = 1; $attempt -le 10; $attempt++) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($listener) {
      $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
      if ($process) {
        return "$($process.ProcessName) (PID $($process.Id))"
      }

      return "PID $($listener.OwningProcess)"
    }

    Start-Sleep -Milliseconds 200
  }

  return $null
}

# A connection attempt is the reliable test for a port in use, unlike the listener table. Windows
# takes about two seconds to report a refused connection, so every attempt runs at once against a
# short deadline: anything listening locally answers within milliseconds.
function Get-PortsInUse([int[]]$Ports) {
  $attempts = @(foreach ($port in $Ports) {
    foreach ($address in [Net.IPAddress]::Loopback, [Net.IPAddress]::IPv6Loopback) {
      try {
        $client = [Net.Sockets.TcpClient]::new($address.AddressFamily)
        [pscustomobject]@{ Port = $port; Client = $client; Task = $client.ConnectAsync($address, $port) }
      }
      catch {
        # No IPv6 on this machine; the IPv4 attempt still covers the port.
      }
    }
  })

  try {
    $deadline = [DateTime]::UtcNow.AddMilliseconds(750)
    while ([DateTime]::UtcNow -lt $deadline -and @($attempts | Where-Object { -not $_.Task.IsCompleted }).Count -gt 0) {
      Start-Sleep -Milliseconds 50
    }

    return @($attempts | Where-Object { $_.Task.Status -eq 'RanToCompletion' } | ForEach-Object { $_.Port } | Sort-Object -Unique)
  }
  finally {
    foreach ($attempt in $attempts) {
      $attempt.Client.Dispose()
    }
  }
}

function Get-MoveHint($Binding) {
  if ($Binding.Variable) {
    return ", or set $($Binding.Variable) to another port"
  }

  return ''
}

# Fails before anything starts, rather than part-way through with a half-created stack.
function Assert-PortsFree($Bindings) {
  $expectedFree = @()

  foreach ($binding in $Bindings) {
    $port = $binding.Port
    $holders = @(Invoke-Native { docker ps --filter "publish=$port" --format '{{.Names}}' } | Where-Object { $_ })
    $ours = @(Invoke-Native { docker ps --filter "label=com.docker.compose.project=$project" --filter "publish=$port" --format '{{.Names}}' } | Where-Object { $_ })
    $backendStack = @(Invoke-Native { docker ps --filter "label=com.docker.compose.project=$backendStackProject" --filter "publish=$port" --format '{{.Names}}' } | Where-Object { $_ })
    $theirs = @($holders | Where-Object { $ours -notcontains $_ })

    if ($backendStack.Count -gt 0) {
      throw "Port $port ($($binding.Service)) is published by $($backendStack -join ', '), from the backend's own stack. This stack runs its own copy of the backend, so stop that one first with ../ls-cleanse-api/dev-docker-up.ps1 -Down, which keeps its database$(Get-MoveHint $binding)."
    }

    if ($theirs.Count -gt 0) {
      throw "Port $port ($($binding.Service)) is published by the container(s) $($theirs -join ', '). Stop them$(Get-MoveHint $binding)."
    }

    # Already ours: Compose updates the running stack in place.
    if ($ours.Count -eq 0) {
      $expectedFree += $binding
    }
  }

  if ($expectedFree.Count -eq 0) {
    return
  }

  $inUse = Get-PortsInUse @($expectedFree | ForEach-Object { $_.Port })
  foreach ($binding in $expectedFree) {
    if ($inUse -contains $binding.Port) {
      $owner = Get-PortOwner $binding.Port
      if (-not $owner) {
        $owner = 'another process'
      }

      if ($binding.Service -eq 'ls-cleanse-ui') {
        $owner += ', perhaps ./dev-up.ps1'
      }

      throw "Port $($binding.Port) ($($binding.Service)) is in use by $owner. Stop it$(Get-MoveHint $binding)."
    }
  }
}

function Show-Failure([string[]]$Services) {
  Write-Host ''
  Write-Host 'The stack did not come up healthy. Current state:' -ForegroundColor Red
  & docker compose --project-name $project @composeFiles ps --all
  foreach ($service in $Services) {
    Write-Host "---- $service, last 30 lines ----" -ForegroundColor DarkGray
    & docker compose --project-name $project @composeFiles logs --no-color --tail 30 $service
  }
}

function Test-Backend([int]$Port, [string]$ServiceKey) {
  Write-Step 'Checking the backend'
  $base = "http://localhost:$Port"

  try {
    $health = Invoke-WebRequest -UseBasicParsing -Uri "$base/health" -TimeoutSec 10
    Write-Host "    GET /health          $($health.StatusCode) $($health.Content)"
    $diagnostics = Invoke-RestMethod -Uri "$base/v1/diagnostics" -Headers @{ 'x-cleanse-api-key' = $ServiceKey } -TimeoutSec 30
  }
  catch {
    throw "The backend did not answer as expected: $($_.Exception.Message) See: docker compose --project-name $project logs cleanse"
  }

  Write-Host ('    GET /v1/diagnostics  database {0}, storage {1}, KRDS {2}, KRDS read {3}' -f
    $diagnostics.database.state, $diagnostics.storage.state, $diagnostics.krds.state, $diagnostics.krdsAccess.state)

  foreach ($dependency in 'database', 'storage') {
    if ($diagnostics.$dependency.state -ne 'ok') {
      throw "The backend cannot use its ${dependency}: $($diagnostics.$dependency.detail)"
    }
  }

  if ($rulesOn) {
    foreach ($probe in 'krds', 'krdsAccess') {
      if ($diagnostics.$probe.state -ne 'ok') {
        throw "The rules engine cannot read the snapshot: $($diagnostics.$probe.detail)"
      }
    }
  }
}

# Signs in as a person would, with both passwords, then reads the status page back as text: the
# summary tag and a line per check.
function Test-App([int]$Port, $Passwords) {
  Write-Step 'Checking the app'
  $base = "http://localhost:$Port"
  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $password = @($Passwords | Where-Object { $_.Name -eq 'PASSWORD' })[0].Value
  $adminPassword = @($Passwords | Where-Object { $_.Name -eq 'ADMIN_PASSWORD' })[0].Value

  try {
    $health = Invoke-WebRequest -UseBasicParsing -Uri "$base/health" -TimeoutSec 10
    Write-Host "    GET /health          $($health.StatusCode)"
    if ($env:AUTH_MODE -eq 'entra') {
      $client = [System.Net.Http.HttpClient]::new(
        [System.Net.Http.HttpClientHandler]@{ AllowAutoRedirect = $false }
      )
      try {
        $response = $client.GetAsync("$base/auth/entra/login").GetAwaiter().GetResult()
        if ([int]$response.StatusCode -ne 302 -or $response.Headers.Location.Host -ne 'login.microsoftonline.com') {
          throw 'The Entra login did not redirect to Microsoft.'
        }
      } finally {
        $client.Dispose()
      }
      Write-Host '    Entra redirect verified. Complete sign-in interactively in your browser.'
      return
    }
    $homePage = Invoke-SignIn $base '/login' $password $session
    Write-Host "    Sign in, then GET /  $($homePage.StatusCode)"
    $status = Invoke-SignIn $base '/admin/login?next=%2Fadmin%2Fstatus' $adminPassword $session
  }
  catch {
    throw "The app did not answer as expected: $($_.Exception.Message) See: docker compose --project-name $project logs ls-cleanse-ui"
  }

  $html = [string]$status.Content
  $summary = [regex]::Match($html, '<strong class="govuk-tag[^"]*">\s*([^<]+?)\s*</strong>').Groups[1].Value
  Write-Host "    GET /admin/status    $($status.StatusCode): $summary"

  $rows = [regex]::Matches($html, '(?s)aria-label="([^"]+)">[^<]*</span>\s*</td>\s*<th scope="row" class="govuk-table__header">([^<]+)</th>\s*<td class="govuk-table__cell app-status__detail">(.*?)</td>')
  foreach ($row in $rows) {
    $detail = ($row.Groups[3].Value -replace '<[^>]+>', ' ' -replace '\s+', ' ').Trim()
    $detail = [System.Net.WebUtility]::HtmlDecode($detail)
    Write-Host ('      {0,-8} {1,-16} {2}' -f $row.Groups[1].Value, $row.Groups[2].Value.Trim(), $detail)
  }
}

function Write-SignIn($Passwords) {
  $label = 'Sign in'
  foreach ($line in (Format-SignInPasswords $Passwords)) {
    Write-Host ('  {0,-11} {1}' -f $label, $line)
    $label = ''
  }
}

function Show-Summary($Model, $Passwords) {
  $appPort = Get-HostPort $Model 'ls-cleanse-ui'

  Write-Host ''
  if ($Backend -eq 'local') {
    $apiPort = Get-HostPort $Model 'ls-cleanse-api'
    $backendSettings = $Model.services.'ls-cleanse-api'.environment
    $postgresSettings = $Model.services.postgres.environment

    Write-Host 'ls-cleanse-ui and the Cleanse backend are up, in one stack, in production mode.' -ForegroundColor Green
    Write-Host "  App         http://localhost:$appPort"
    Write-Host "  Status      http://localhost:$appPort/admin/status"
    Write-SignIn $Passwords
    Write-Host "  Backend     http://localhost:$apiPort   (header x-cleanse-api-key: $($backendSettings.Auth__ApiKey__Key))"
    Write-Host "  OpenAPI     http://localhost:$apiPort/v1/openapi.json"
    Write-Host ('  Postgres    localhost:{0}, database {1}. Service login {2}/{3}; owner {4}/{5}' -f
      (Get-HostPort $Model 'postgres'), $postgresSettings.POSTGRES_DB,
      $backendSettings.Storage__Postgres__Username, $backendSettings.Storage__Postgres__LocalPassword,
      $postgresSettings.POSTGRES_USER, $postgresSettings.POSTGRES_PASSWORD)
    Write-Host "  S3          http://localhost:$(Get-HostPort $Model 'floci') (floci), bucket $($backendSettings.Imports__S3BucketName)"

    if ($rulesOn) {
      Write-Host "  Rules       on, reading $KrdsSnapshot"
      Write-Host "              start a run from http://localhost:$appPort/admin/runs"
    }
    else {
      Write-Host '  Rules       off; pass -KrdsSnapshot <path> to run them against a local snapshot'
    }

    Write-Host "  Logs        docker compose --project-name $project logs -f ls-cleanse-ui ls-cleanse-api"
    Write-Host '  Stop        ./dev-docker-up.ps1 -Down   (add -Reset to delete the database)'
    return
  }

  Write-Host 'ls-cleanse-ui is up, in production mode.' -ForegroundColor Green
  Write-Host "  App         http://localhost:$appPort"
  Write-Host "  Status      http://localhost:$appPort/admin/status"
  Write-SignIn $Passwords
  Write-Host "  Backend     $($target.Description)"
  Write-Host "              $($target.Url)"
  Write-Host '              Changes you make here are made to the dev environment''s data.' -ForegroundColor Yellow
  Write-Host "  Logs        docker compose --project-name $project logs -f ls-cleanse-ui"
  Write-Host '  Stop        ./dev-docker-up.ps1 -Down'
}

# Both services log ECS JSON for OpenSearch; this keeps the time, level, message and any error.
function Format-LogLine([string]$Line) {
  if (-not $Line.StartsWith('{')) {
    return $Line
  }

  try {
    $entry = $Line | ConvertFrom-Json
  }
  catch {
    return $Line
  }

  $time = ''
  if ($entry.'@timestamp') {
    $time = ([DateTimeOffset]$entry.'@timestamp').ToLocalTime().ToString('HH:mm:ss')
  }

  $text = '{0} {1,-11} {2}' -f $time, $entry.'log.level', $entry.message
  $type = if ($entry.'error.type') { $entry.'error.type' } elseif ($entry.error) { $entry.error.type }
  $message = if ($entry.'error.message') { $entry.'error.message' } elseif ($entry.error) { $entry.error.message }
  if ($type -or $message) {
    $text += " | ${type}: $message"
  }

  return $text
}

# Compose starts each line with the container it came from; this keeps just the service's name.
function Format-ComposeLine([string]$Line) {
  if ($Line -notmatch '^(?<service>\S+?)(-\d+)?\s+\|\s?(?<entry>.*)$') {
    return $Line
  }

  $service = $Matches.service
  $entry = $Matches.entry
  return '{0,-11} {1}' -f $service, (Format-LogLine $entry)
}

$previousBackend = $null
$previousSignIn = $null
$previousSnapshot = $env:CLEANSE_KRDS_SNAPSHOT
Push-Location $PSScriptRoot

try {
  $composeFiles = @('--file', 'compose.yml')
  $haveBackend = Test-Path -LiteralPath (Join-Path $backendRoot 'compose.yml') -PathType Leaf

  Write-Step 'Checking Docker'
  Assert-Docker

  if ($Down) {
    # Every file the stack can be started from, so that down finds the backend's network and
    # database volume as well.
    if ($haveBackend) {
      $composeFiles += @('--file', 'compose.local-backend.yml')
    }

    Write-Step 'Stopping the ls-cleanse-ui stack'
    $downArgs = @('down', '--remove-orphans')
    if ($Reset) {
      $downArgs += '--volumes'
    }

    & docker compose --project-name $project @composeFiles @downArgs
    if ($LASTEXITCODE -ne 0) {
      throw 'docker compose down failed; see the output above.'
    }

    if ($Reset) {
      Write-Host 'Stopped, and the database deleted.' -ForegroundColor Green
    }
    else {
      Write-Host 'Stopped. The database is kept; -Down -Reset deletes it.' -ForegroundColor Green
    }

    return
  }

  $rulesOn = $false
  if ($Backend -eq 'local') {
    if (-not $haveBackend) {
      throw "The Cleanse backend was not found at $backendRoot. Clone DEFRA/ls-cleanse-api next to this repository, or use -Backend dev."
    }

    $composeFiles += @('--file', 'compose.local-backend.yml')

    $rulesOn = -not [string]::IsNullOrWhiteSpace($KrdsSnapshot)
    if ($rulesOn) {
      if (-not (Test-Path -LiteralPath $KrdsSnapshot -PathType Leaf)) {
        throw "KRDS snapshot not found: $KrdsSnapshot"
      }

      $KrdsSnapshot = (Resolve-Path -LiteralPath $KrdsSnapshot).ProviderPath
      # Read by the backend's compose.krds.yml. Forward slashes keep the bind source unambiguous on Windows.
      $env:CLEANSE_KRDS_SNAPSHOT = $KrdsSnapshot -replace '\\', '/'
      $composeFiles += @('--file', (Join-Path $backendRoot 'compose.krds.yml'))
    }

    $target = Get-CleanseBackendTarget 'local' -LocalUrl 'http://ls-cleanse-api:8085'
    $target.Description = 'the backend from ../ls-cleanse-api, built and run in this stack'
  }
  else {
    if ($Reset -or $PSBoundParameters.ContainsKey('KrdsSnapshot')) {
      throw '-Reset and -KrdsSnapshot only apply to -Backend local, where the backend runs in this stack.'
    }

    Write-Step 'Checking the dev backend'
    $target = Get-CleanseBackendTarget 'dev'
    Test-CleanseBackendTarget $target
    Write-Host "    $($target.Description)"
  }

  # Read by compose.yml while it is interpolated, and restored afterwards.
  Initialize-LocalEnvironment
  $previousBackend = Set-CleanseBackendVariables $target
  $passwords = @(Get-SignInPasswords)
  $previousSignIn = Set-SignInVariables $passwords

  Write-Step 'Checking ports'
  Assert-PortVariables
  $model = Get-ComposeModel
  Assert-PortsFree @(Get-PortBindings $model)

  if ($Reset) {
    Write-Step 'Deleting the database volume'
    & docker compose --project-name $project @composeFiles down --volumes --remove-orphans
    if ($LASTEXITCODE -ne 0) {
      throw 'docker compose down failed; see the output above.'
    }
  }

  $upArgs = @('up', '--detach', '--wait', '--wait-timeout', '300', '--remove-orphans')
  if ($NoBuild) {
    Write-Step 'Starting the stack (no rebuild)'
  }
  else {
    Write-Step $(if ($Backend -eq 'local') { 'Building the images and starting the stack' } else { 'Building the image and starting ls-cleanse-ui' })
    $upArgs += '--build'
  }

  & docker compose --project-name $project @composeFiles @upArgs
  if ($LASTEXITCODE -ne 0) {
    Show-Failure @($model.services.PSObject.Properties.Name)
    throw 'The stack did not come up healthy; see the state and logs above.'
  }

  if (-not $SkipSmoke) {
    if ($Backend -eq 'local') {
      Test-Backend (Get-HostPort $model 'ls-cleanse-api') $model.services.'ls-cleanse-api'.environment.Auth__ApiKey__Key
    }

    Test-App (Get-HostPort $model 'ls-cleanse-ui') $passwords
  }

  Show-Summary $model $passwords

  if ($Follow) {
    $services = @('ls-cleanse-ui')
    if ($Backend -eq 'local') {
      $services += 'ls-cleanse-api'
    }

    Write-Step 'Following the logs (Ctrl+C stops following; the stack keeps running)'
    & docker compose --project-name $project @composeFiles logs --follow --no-color --tail 20 @services |
      ForEach-Object { Format-ComposeLine $_ }
  }
}
finally {
  if ($previousBackend) {
    Restore-CleanseBackendVariables $previousBackend
  }

  if ($previousSignIn) {
    Restore-SignInVariables $previousSignIn
  }

  $env:CLEANSE_KRDS_SNAPSHOT = $previousSnapshot
  Pop-Location
}
