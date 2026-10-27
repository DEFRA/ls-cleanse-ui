<#
.SYNOPSIS
    Which Cleanse backend a locally running ls-cleanse-ui talks to. Dot-sourced by dev-up.ps1 and
    dev-docker-up.ps1.

.DESCRIPTION
    local  The backend's own Docker stack (../ls-cleanse-api, ./dev-docker-up.ps1), on port 8085, with
           the local development key the app already defaults to.
    dev    The backend deployed in CDP's dev environment, through CDP's developer ephemeral
           gateway. Needs two User environment variables:
             CDP_EPHEMERAL_GW_KEY  your developer key, from your user profile in the CDP Portal.
                                   It lasts 24 hours and only works in the environment it was
                                   issued for.
             CLEANSE_APIKEY        cleanse's Auth__ApiKey__Key secret for dev.

    Keys are read from the User environment first, so a key renewed in Windows settings works
    without opening a new terminal, and are only ever passed to the app as environment variables.
#>

$script:DevGatewayUrl = 'https://ephemeral-protected.api.dev.cdp-int.defra.cloud/ls-cleanse-api'
$script:GatewayKeyVariable = 'CDP_EPHEMERAL_GW_KEY'
$script:ServiceKeyVariable = 'CLEANSE_APIKEY'

# Every variable a backend target sets. Kept together so a caller can save and restore them all.
$script:BackendVariables = @('CLEANSE_API_URL', 'CLEANSE_API_AUTH', 'CLEANSE_API_KEY', 'CLEANSE_GATEWAY_KEY')

function Get-CleanseKey([string] $Variable) {
    foreach ($scope in 'User', 'Process') {
        $value = [Environment]::GetEnvironmentVariable($Variable, $scope)
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            return $value.Trim()
        }
    }

    return $null
}

<#
    The environment variables that point the app at a backend. A null value means "leave unset",
    so the app falls back to its own default. $LocalUrl is where the local backend is reached: a
    container sees it by its service name rather than on localhost.
#>
function Get-CleanseBackendTarget([string] $Backend, [string] $LocalUrl = 'http://localhost:8085') {
    if ($Backend -eq 'dev') {
        $gatewayKey = Get-CleanseKey $script:GatewayKeyVariable
        $serviceKey = Get-CleanseKey $script:ServiceKeyVariable

        $missing = @()
        if (-not $gatewayKey) { $missing += "$($script:GatewayKeyVariable) (your CDP developer key for dev, from your user profile in the Portal)" }
        if (-not $serviceKey) { $missing += "$($script:ServiceKeyVariable) (cleanse's Auth__ApiKey__Key secret for dev)" }
        if ($missing.Count -gt 0) {
            throw "To use the dev backend, set these User environment variables: $($missing -join '; ')."
        }

        return [pscustomobject]@{
            Name        = 'dev'
            Description = "cleanse in CDP's dev environment, through the developer gateway"
            Url         = $script:DevGatewayUrl
            GatewayKey  = $gatewayKey
            ServiceKey  = $serviceKey
            Variables   = [ordered]@{
                CLEANSE_API_URL     = $script:DevGatewayUrl
                CLEANSE_API_AUTH    = 'apiKey'
                CLEANSE_API_KEY     = $serviceKey
                CLEANSE_GATEWAY_KEY = $gatewayKey
            }
        }
    }

    return [pscustomobject]@{
        Name        = 'local'
        Description = 'the local backend stack (../ls-cleanse-api/dev-docker-up.ps1)'
        Url         = $LocalUrl
        GatewayKey  = $null
        ServiceKey  = $null
        Variables   = [ordered]@{
            CLEANSE_API_URL     = $LocalUrl
            CLEANSE_API_AUTH    = 'apiKey'
            CLEANSE_API_KEY     = $null
            CLEANSE_GATEWAY_KEY = $null
        }
    }
}

function Invoke-CleanseProbe([string] $Url, [hashtable] $Headers) {
    if ($PSVersionTable.PSEdition -eq 'Desktop') {
        Add-Type -AssemblyName System.Net.Http
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    }

    $client = New-Object System.Net.Http.HttpClient
    $client.Timeout = [TimeSpan]::FromSeconds(20)
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $Url)
    foreach ($name in $Headers.Keys) {
        [void] $request.Headers.TryAddWithoutValidation($name, [string] $Headers[$name])
    }

    try {
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        $status = [int] $response.StatusCode
        $response.Dispose()
        return [pscustomobject]@{ Status = $status; Failure = $null }
    }
    catch {
        return [pscustomobject]@{ Status = 0; Failure = $_.Exception.GetBaseException().Message }
    }
    finally {
        $request.Dispose()
        $client.Dispose()
    }
}

<#
    Checks the backend answers before the app is started against it. For dev a refused key is
    fatal, because nothing would work; for local an absent backend is only a warning, because the
    app still starts and its status page says what is wrong. $ProbeUrl is where this machine can
    reach the backend, which for a container is not the URL the container uses.
#>
function Test-CleanseBackendTarget($Target, [string] $ProbeUrl = $Target.Url) {
    if ($Target.Name -eq 'dev') {
        $health = Invoke-CleanseProbe "$ProbeUrl/health" @{ 'x-api-key' = $Target.GatewayKey }
        if ($health.Status -eq 0) {
            throw "Could not reach the CDP developer gateway: $($health.Failure.TrimEnd('.')). It is only reachable from the DEFRA network, so check Zscaler or the VPN."
        }

        if ($health.Status -eq 403) {
            throw "The gateway refused the developer key in $($script:GatewayKeyVariable). Keys last 24 hours and only work in the environment they were issued for: generate a new one for dev from your user profile in the CDP Portal."
        }

        $diagnostics = Invoke-CleanseProbe "$ProbeUrl/v1/diagnostics" @{
            'x-api-key'         = $Target.GatewayKey
            'x-cleanse-api-key' = $Target.ServiceKey
        }

        if ($diagnostics.Status -eq 401) {
            throw "cleanse refused the key in $($script:ServiceKeyVariable). It must equal cleanse's Auth__ApiKey__Key secret for dev."
        }

        if ($diagnostics.Status -ne 200) {
            Write-Warning "The dev backend answered /v1/diagnostics with $($diagnostics.Status); the app's status page will show what is wrong."
        }

        return
    }

    $health = Invoke-CleanseProbe "$ProbeUrl/health" @{}
    if ($health.Status -ne 200) {
        Write-Warning "The local backend is not answering on $ProbeUrl. Start it with ../ls-cleanse-api/dev-docker-up.ps1, or use -Backend dev."
    }
}

<#
    Sets a variable in this process, or removes it when the value is null or empty. Not
    [Environment]::SetEnvironmentVariable: PowerShell passes $null to it as '', which PowerShell 7
    keeps as an empty variable, and an empty CLEANSE_API_KEY would override the app's default.
#>
function Set-ProcessVariable([string] $Name, [string] $Value) {
    if ([string]::IsNullOrEmpty($Value)) {
        Remove-Item -LiteralPath "Env:$Name" -ErrorAction SilentlyContinue
    }
    else {
        Set-Item -LiteralPath "Env:$Name" -Value $Value
    }
}

<# Sets each variable in this process, removing those whose value is null, and returns what was there before. #>
function Set-CleanseBackendVariables($Target) {
    $previous = @{}
    foreach ($name in $script:BackendVariables) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        Set-ProcessVariable $name $Target.Variables[$name]
    }

    return $previous
}

function Restore-CleanseBackendVariables([hashtable] $Previous) {
    foreach ($name in $Previous.Keys) {
        Set-ProcessVariable $name $Previous[$name]
    }
}
