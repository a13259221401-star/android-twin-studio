$ErrorActionPreference = 'Stop'
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRoot = Join-Path $workspaceRoot '.runtime\ws-scrcpy-web'
$launcher = Join-Path $runtimeRoot 'start.cmd'
$runtimeConfig = Join-Path $PSScriptRoot 'ws-scrcpy-config.json'

if (-not (Test-Path -LiteralPath $launcher)) {
    throw 'ws-scrcpy-web runtime is not installed. Run npm run runtime:install first.'
}

# The public embed helper enables fitToScreen unconditionally. That makes the
# Android encoder use the small Hero iframe dimensions (for example 132x288)
# instead of the maxSize requested by PhoneMirror. Disable this upstream flag
# reproducibly after every install so the stream keeps its configured 2K size;
# CSS still scales the decoded canvas to the model on the page.
$clientBundle = Join-Path $runtimeRoot 'dist\public\ws-scrcpy.umd.js'
if (Test-Path -LiteralPath $clientBundle) {
    $bundleText = [System.IO.File]::ReadAllText($clientBundle)
    if ($bundleText.Contains('fitToScreen:!0')) {
        $bundleText = $bundleText.Replace('fitToScreen:!0', 'fitToScreen:!1')
    }
    # startStream also passes fitToScreen as a positional argument to the
    # internal starter. This is separate from the parameter object above.
    if ($bundleText.Contains(',void 0,!0,u,t,')) {
        $bundleText = $bundleText.Replace(',void 0,!0,u,t,', ',void 0,!1,u,t,')
    }
    [System.IO.File]::WriteAllText(
        $clientBundle,
        $bundleText,
        [System.Text.UTF8Encoding]::new($false)
    )
    Write-Host 'Verified ws-scrcpy embed client for fixed high-resolution streaming.'
}

$embedDocument = Join-Path $runtimeRoot 'dist\public\embed.html'
if (Test-Path -LiteralPath $embedDocument) {
    $embedText = [System.IO.File]::ReadAllText($embedDocument)
    if ($embedText -match 'src="ws-scrcpy\.umd\.js(?:\?[^\"]*)?"') {
        $embedText = [regex]::Replace(
            $embedText,
            'src="ws-scrcpy\.umd\.js(?:\?[^\"]*)?"',
            'src="ws-scrcpy.umd.js?phoneMirror=fixed-resolution-v2"'
        )
        [System.IO.File]::WriteAllText(
            $embedDocument,
            $embedText,
            [System.Text.UTF8Encoding]::new($false)
        )
    }
}

function Find-RuntimeUrl {
    foreach ($runtimePort in 8000..8010) {
        try {
            $runtimeUrl = "http://127.0.0.1:$runtimePort"
            $response = Invoke-WebRequest -Uri "$runtimeUrl/embed.html" -TimeoutSec 1 -UseBasicParsing
            if ($response.StatusCode -eq 200) { return $runtimeUrl }
        }
        catch {
            # A closed port is expected while probing the bounded local range.
        }
    }
    return $null
}

$existingUrl = Find-RuntimeUrl
if ($existingUrl) {
    Write-Host "ws-scrcpy-web is already running at $existingUrl"
    exit 0
}

$env:WS_SCRCPY_CONFIG = $runtimeConfig
$env:WS_SCRCPY_NO_BROWSER = '1'
Start-Process -FilePath $launcher -WorkingDirectory $runtimeRoot -WindowStyle Hidden
Write-Host 'Starting ws-scrcpy-web runtime...'

for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 1000
    $readyUrl = Find-RuntimeUrl
    if ($readyUrl) {
        Write-Host "ws-scrcpy-web is ready at $readyUrl"
        exit 0
    }
}

throw 'ws-scrcpy-web did not become ready within 30 seconds. Check its runtime logs.'
