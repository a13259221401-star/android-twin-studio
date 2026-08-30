$ErrorActionPreference = 'Stop'

$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sdkRoot = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot '.runtime\android-sdk'))
$commandLineTools = Join-Path $sdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat'
$sdkManagerLibrary = Join-Path $sdkRoot 'cmdline-tools\latest\lib\sdklib\tools.sdklib.jar'
$archiveUrl = 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip'
$archiveSha256 = '90AE805D20434428BFFCB699C290860F19BB5F66A67E6B330067E3DE801FB04A'

if (-not (Test-Path -LiteralPath $commandLineTools) -or -not (Test-Path -LiteralPath $sdkManagerLibrary)) {
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

        $latestRoot = [System.IO.Path]::GetFullPath((Join-Path $sdkRoot 'cmdline-tools\latest'))
        $commandLineRoot = [System.IO.Path]::GetFullPath((Join-Path $sdkRoot 'cmdline-tools'))
        if (-not $latestRoot.StartsWith($commandLineRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to replace unexpected SDK path: $latestRoot"
        }
        if (Test-Path -LiteralPath $latestRoot) {
            Remove-Item -LiteralPath $latestRoot -Recurse -Force
        }
        New-Item -ItemType Directory -Path $latestRoot -Force | Out-Null
        & tar.exe -xf $archivePath -C $latestRoot --strip-components 1
        if ($LASTEXITCODE -ne 0) {
            throw 'Unable to extract the Android command-line tools archive.'
        }
        if (-not (Test-Path -LiteralPath $commandLineTools) -or -not (Test-Path -LiteralPath $sdkManagerLibrary)) {
            throw 'Android command-line tools extraction is incomplete.'
        }
    }
    finally {
        $resolvedTemporary = [System.IO.Path]::GetFullPath($temporaryRoot)
        $systemTemporary = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
        if ((Test-Path -LiteralPath $resolvedTemporary) -and $resolvedTemporary.StartsWith($systemTemporary, [System.StringComparison]::OrdinalIgnoreCase)) {
            try {
                Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force -ErrorAction Stop
            }
            catch {
                Write-Warning "Temporary SDK directory could not be fully removed: $resolvedTemporary"
            }
        }
    }
}

$env:ANDROID_SDK_ROOT = $sdkRoot
$configuredJava = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin\java.exe' } else { $null }
if (-not $configuredJava -or -not (Test-Path -LiteralPath $configuredJava)) {
    $javaCommand = Get-Command java.exe -ErrorAction SilentlyContinue
    if (-not $javaCommand) {
        throw 'Java 17 is required to install the Android SDK. Configure JAVA_HOME and retry.'
    }
    $env:JAVA_HOME = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetDirectoryName($javaCommand.Source))
}
function Invoke-SdkManager {
    param(
        [string[]]$Arguments,
        [switch]$AcceptPrompts
    )

    $processInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $processInfo.FileName = Join-Path $env:JAVA_HOME 'bin\java.exe'
    $processInfo.UseShellExecute = $false
    $processInfo.RedirectStandardInput = $AcceptPrompts
    $quotedArguments = ($Arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join ' '
    $toolsDirectory = Join-Path $sdkRoot 'cmdline-tools\latest'
    $sdkManagerClasspath = Join-Path $toolsDirectory 'lib\sdkmanager-classpath.jar'
    $processInfo.Arguments = '-Dcom.android.sdklib.toolsdir="' + $toolsDirectory + '" -classpath "' +
        $sdkManagerClasspath + '" com.android.sdklib.tool.sdkmanager.SdkManagerCli ' + $quotedArguments

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $processInfo
    if (-not $process.Start()) {
        throw 'Unable to start Android SDK manager.'
    }
    if ($AcceptPrompts) {
        $process.StandardInput.AutoFlush = $true
        for ($index = 0; $index -lt 100; $index++) {
            $process.StandardInput.WriteLine('y')
        }
        $process.StandardInput.Close()
    }
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "Android SDK manager failed with exit code $($process.ExitCode)."
    }
}

Invoke-SdkManager -Arguments @("--sdk_root=$sdkRoot", '--licenses') -AcceptPrompts
Invoke-SdkManager -Arguments @("--sdk_root=$sdkRoot", 'platform-tools', 'platforms;android-36', 'build-tools;36.0.0')

$requiredPackages = @(
    (Join-Path $sdkRoot 'platform-tools\adb.exe'),
    (Join-Path $sdkRoot 'platforms\android-36\android.jar'),
    (Join-Path $sdkRoot 'build-tools\36.0.0\aapt2.exe')
)
foreach ($requiredPackage in $requiredPackages) {
    if (-not (Test-Path -LiteralPath $requiredPackage)) {
        throw "Android SDK package installation is incomplete: $requiredPackage"
    }
}

Write-Host "Android SDK ready at $sdkRoot"
