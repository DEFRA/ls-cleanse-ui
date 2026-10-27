<#
.SYNOPSIS
Runs ls-cleanse-ui on Node with live reload, against a local or a deployed Cleanse backend.

.DESCRIPTION
Loads local settings and secrets from the ignored .env file. Entra mode requires
ENTRA_TENANT_ID, ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET. The admin area retains its password.

.PARAMETER Backend
local  The backend's Docker stack on http://localhost:8085 (../ls-cleanse-api/dev-docker-up.ps1). The default.
dev    cleanse in CDP's dev environment, through CDP's developer ephemeral gateway. Needs the User
       environment variables CDP_EPHEMERAL_GW_KEY (your developer key for dev, from your user profile
       in the CDP Portal; it lasts 24 hours) and CLEANSE_APIKEY (cleanse's Auth__ApiKey__Key secret
       for dev). Changes you make are made to dev's data.

.PARAMETER Demo
Anonymise all backend data shown in the UI (see README "Demo anonymisation").

.EXAMPLE
./dev-up.ps1

.EXAMPLE
./dev-up.ps1 -Backend dev
#>
[CmdletBinding()]
param(
  [ValidateSet('local', 'dev')]
  [string]$Backend = 'local',

  [switch]$Demo
)

$ErrorActionPreference = 'Stop'

Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'scripts\backend-target.ps1')
. (Join-Path $PSScriptRoot 'scripts\sign-in.ps1')
. (Join-Path $PSScriptRoot 'scripts\local-env.ps1')
Initialize-LocalEnvironment

$previousAnonymise = $env:DEMO_ANONYMISE
$previousKey = $env:DEMO_ANONYMISE_KEY
$previousBackend = $null
$previousSignIn = $null

try {
  $target = Get-CleanseBackendTarget $Backend
  Test-CleanseBackendTarget $target
  $previousBackend = Set-CleanseBackendVariables $target

  if ($Demo) {
    # Stable per-machine key, so fakes stay consistent across restarts on this machine.
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $bytes = [System.Text.Encoding]::UTF8.GetBytes("cleanse-demo:$([Environment]::MachineName)")
      $hash = $sha.ComputeHash($bytes)
    } finally {
      $sha.Dispose()
    }

    $env:DEMO_ANONYMISE = 'true'
    $env:DEMO_ANONYMISE_KEY = [System.BitConverter]::ToString($hash).Replace('-', '').ToLowerInvariant()

    Write-Host 'Demo mode: backend data will be anonymised.' -ForegroundColor Yellow
    Write-Host 'Actions taken during the demo still change real issues.' -ForegroundColor Yellow
  } else {
    Remove-Item Env:DEMO_ANONYMISE -ErrorAction SilentlyContinue
    Remove-Item Env:DEMO_ANONYMISE_KEY -ErrorAction SilentlyContinue
  }

  Write-Host "Backend: $($target.Description)"
  Write-Host "         $($target.Url)"
  if ($target.Name -eq 'dev') {
    Write-Host 'Changes you make here are made to the dev environment''s data.' -ForegroundColor Yellow
  }

  $passwords = @(Get-SignInPasswords)
  $previousSignIn = Set-SignInVariables $passwords

  Write-Host 'Starting Cleanse frontend at http://localhost:3000 (status: http://localhost:3000/admin/status)'
  Write-Host 'Sign in with:'
  Format-SignInPasswords $passwords | ForEach-Object { Write-Host "  $_" }
  npm.cmd run dev
} finally {
  # $env: changes persist in the calling PowerShell session, so restore them.
  $env:DEMO_ANONYMISE = $previousAnonymise
  $env:DEMO_ANONYMISE_KEY = $previousKey
  if ($previousBackend) {
    Restore-CleanseBackendVariables $previousBackend
  }
  if ($previousSignIn) {
    Restore-SignInVariables $previousSignIn
  }
}
