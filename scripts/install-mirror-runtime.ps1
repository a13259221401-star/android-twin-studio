param(
    [switch]$AllowInsecureTls
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot '.runtime\ws-scrcpy-web'))
$runtimeParent = [System.IO.Path]::GetDirectoryName($runtimeRoot)

if (Test-Path -LiteralPath (Join-Path $runtimeRoot 'start.cmd')) {
    Write-Host "ws-scrcpy-web runtime already installed: $runtimeRoot"
    exit 0
}

$webOptions = @{
    Headers = @{ 'User-Agent' = 'PhoneMirrorDemo-Installer' }
}
if ($AllowInsecureTls) {
    Write-Warning 'TLS certificate validation is disabled for this download. SHA-256 verification remains enabled.'
}

Write-Host 'Resolving latest ws-scrcpy-web portable release...'
if ($AllowInsecureTls) {
    $releaseJson = & curl.exe -k -L --fail --silent --show-error -H 'User-Agent: PhoneMirrorDemo-Installer' 'https://api.github.com/repos/bilbospocketses/ws-scrcpy-web/releases/latest'
    if ($LASTEXITCODE -ne 0) { throw 'Unable to query the GitHub release API.' }
    $release = $releaseJson | ConvertFrom-Json
}
else {
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/bilbospocketses/ws-scrcpy-web/releases/latest' @webOptions
}
$asset = $release.assets | Where-Object { $_.name -eq 'WsScrcpyWeb-beta-Portable.zip' } | Select-Object -First 1
if (-not $asset) {
    throw 'Portable Windows release asset was not found.'
}

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('phone-mirror-runtime-' + [guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $temporaryRoot $asset.name
$extractRoot = Join-Path $temporaryRoot 'expanded'
New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null

try {
    Write-Host "Downloading $($asset.name) ($([math]::Round($asset.size / 1MB, 1)) MB)..."
    if ($AllowInsecureTls) {
        & curl.exe -k -L --fail --show-error --output $archivePath $asset.browser_download_url
        if ($LASTEXITCODE -ne 0) { throw 'Runtime download failed.' }
    }
    else {
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archivePath @webOptions
    }

    if ($asset.digest -and $asset.digest.StartsWith('sha256:')) {
        $expectedHash = $asset.digest.Substring(7).ToUpperInvariant()
        $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToUpperInvariant()
        if ($actualHash -ne $expectedHash) {
            throw "SHA-256 mismatch. Expected $expectedHash but got $actualHash."
        }
    }

    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force
    $launcher = Get-ChildItem -LiteralPath $extractRoot -Filter 'start.cmd' -File -Recurse | Sort-Object { $_.FullName.Length } | Select-Object -First 1
    if (-not $launcher) {
        throw 'The downloaded archive does not contain start.cmd.'
    }

    New-Item -ItemType Directory -Path $runtimeParent -Force | Out-Null
    if (Test-Path -LiteralPath $runtimeRoot) {
        $resolvedRuntime = [System.IO.Path]::GetFullPath($runtimeRoot)
        if (-not $resolvedRuntime.StartsWith($runtimeParent, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to replace unexpected path: $resolvedRuntime"
        }
        Remove-Item -LiteralPath $resolvedRuntime -Recurse -Force
    }
    Copy-Item -LiteralPath $launcher.Directory.FullName -Destination $runtimeRoot -Recurse
    Write-Host "Installed ws-scrcpy-web $($release.tag_name) to $runtimeRoot"
}
finally {
    $resolvedTemporary = [System.IO.Path]::GetFullPath($temporaryRoot)
    $systemTemporary = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if ((Test-Path -LiteralPath $resolvedTemporary) -and $resolvedTemporary.StartsWith($systemTemporary, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force
    }
}
