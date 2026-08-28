$ErrorActionPreference = 'Stop'

$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sdkRoot = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot '.runtime\android-sdk'))
$commandLineTools = Join-Path $sdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat'
$archiveUrl = 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip'
$archiveSha256 = '90AE805D20434428BFFCB699C290860F19BB5F66A67E6B330067E3DE801FB04A'

if (-not (Test-Path -LiteralPath $commandLineTools)) {
    $temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('phone-motion-sdk-' + [guid]::NewGuid().ToString('N'))
    $archivePath = Join-Path $temporaryRoot 'command-line-tools.zip'
    $extractRoot = Join-Path $temporaryRoot 'expanded'
    New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null

    try {
        Write-Host 'Downloading Android command-line tools...'
        Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath -UseBasicParsing
        $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToUpperInvariant()
        if ($actualHash -ne $archiveSha256) {
            throw "Android command-line tools SHA-256 mismatch: $actualHash"
        }

        Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force
        $latestRoot = Join-Path $sdkRoot 'cmdline-tools\latest'
        New-Item -ItemType Directory -Path $latestRoot -Force | Out-Null
        Copy-Item -Path (Join-Path $extractRoot 'cmdline-tools\*') -Destination $latestRoot -Recurse -Force
    }
    finally {
        $resolvedTemporary = [System.IO.Path]::GetFullPath($temporaryRoot)
        $systemTemporary = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
        if ((Test-Path -LiteralPath $resolvedTemporary) -and $resolvedTemporary.StartsWith($systemTemporary, [System.StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force
        }
    }
}

$env:ANDROID_SDK_ROOT = $sdkRoot
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
$licenses = (1..20 | ForEach-Object { 'y' }) -join [Environment]::NewLine
$licenses | & $commandLineTools --sdk_root=$sdkRoot --licenses | Out-Null
& $commandLineTools --sdk_root=$sdkRoot 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0'

Write-Host "Android SDK ready at $sdkRoot"
