<#
.SYNOPSIS
    The two passwords a locally running ls-cleanse-ui asks for. Dot-sourced by dev-up.ps1 and
    dev-docker-up.ps1.

.DESCRIPTION
    PASSWORD signs in to the service, and ADMIN_PASSWORD then opens the admin area. On CDP both
    are Portal secrets. Local entry points load the ignored .env file into the process first.
    Process settings take precedence over the User environment. Startup persists missing
    local passwords in .env.
#>

$script:SignInVariables = @('PASSWORD', 'ADMIN_PASSWORD')
$script:GeneratedForRun = 'generated for this run'

<# Random and URL-safe, from the OS CSPRNG. 18 bytes is 24 characters: easy to paste. #>
function New-SignInPassword {
    $bytes = [byte[]]::new(18)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    }
    finally {
        $rng.Dispose()
    }

    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

<# Each password, the value to run with, and where it came from. #>
function Get-SignInPasswords {
    foreach ($name in $script:SignInVariables) {
        $value = $null
        $source = $script:GeneratedForRun

        foreach ($scope in 'Process', 'User') {
            $candidate = [Environment]::GetEnvironmentVariable($name, $scope)
            if (-not [string]::IsNullOrWhiteSpace($candidate)) {
                $value = $candidate
                $source = "$scope environment"
                break
            }
        }

        if (-not $value) {
            $value = New-SignInPassword
        }

        [pscustomobject]@{
            Name      = $name
            Value     = $value
            Source    = $source
            Generated = $source -eq $script:GeneratedForRun
        }
    }
}

<# Sets each in this process, for the app or Compose to read, and returns what was there before. #>
function Set-SignInVariables($Passwords) {
    $previous = @{}
    foreach ($password in $Passwords) {
        $previous[$password.Name] = [Environment]::GetEnvironmentVariable($password.Name, 'Process')
        Set-Item -LiteralPath "Env:$($password.Name)" -Value $password.Value
    }

    return $previous
}

function Restore-SignInVariables([hashtable] $Previous) {
    foreach ($name in $Previous.Keys) {
        if ([string]::IsNullOrEmpty($Previous[$name])) {
            Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
        }
        else {
            Set-Item -LiteralPath "Env:$name" -Value $Previous[$name]
        }
    }
}

<# One line per password. A generated one is shown, because there is no other way to know it. #>
function Format-SignInPasswords($Passwords) {
    foreach ($password in $Passwords) {
        if ($env:AUTH_MODE -eq 'entra' -and $password.Name -eq 'PASSWORD') {
            continue
        }
        $label = if ($password.Name -eq 'PASSWORD') { 'password' } else { 'admin password' }

        if ($password.Generated) {
            "{0,-14} {1}   ({2}; set {3} as a User environment variable to keep one)" -f
                $label, $password.Value, $script:GeneratedForRun, $password.Name
        }
        else {
            "{0,-14} {1}, from the {2}" -f $label, $password.Name, $password.Source
        }
    }
}

<#
    Signs in through a sign-in page as a person would: opens it for its CSRF token, then posts the
    password. Redirects are followed, so the answer is the page the sign-in was for.
#>
function Invoke-SignIn([string] $Base, [string] $Path, [string] $Password, $Session) {
    try {
        $page = Invoke-WebRequest -UseBasicParsing -Uri "$Base$Path" -WebSession $Session -TimeoutSec 60
    }
    catch {
        throw "GET $Path failed: $($_.Exception.Message) A 503 means the app has no password to check against."
    }

    $crumb = [regex]::Match([string] $page.Content, 'name="crumb" value="([^"]+)"').Groups[1].Value
    if (-not $crumb) {
        throw "$Path offered no sign-in form."
    }

    try {
        return Invoke-WebRequest -UseBasicParsing -Uri "$Base$Path" -Method Post -WebSession $Session -TimeoutSec 60 `
            -Body @{ crumb = $crumb; password = $Password }
    }
    catch {
        throw "Signing in at $Path failed: $($_.Exception.Message) A 400 means the password was refused."
    }
}
