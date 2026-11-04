param(
    [string]$SdkRoot = "$env:LOCALAPPDATA/Android/Sdk",
    [string]$BuildTools = '36.1.0',
    [switch]$Unsigned
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$apkName = if ($Unsigned) { 'app-release-unsigned.apk' } else { 'app-release.apk' }
$apkPath = Join-Path $projectRoot "android/app/build/outputs/apk/release/$apkName"
$aabPath = Join-Path $projectRoot 'android/app/build/outputs/bundle/release/app-release.aab'
$aaptPath = Join-Path $SdkRoot "build-tools/$BuildTools/aapt2.exe"
if (-not (Test-Path -LiteralPath $aaptPath)) { throw "Install Android build tools $BuildTools or pass -BuildTools." }

Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($artifactPath in @($apkPath, $aabPath)) {
    if (-not (Test-Path -LiteralPath $artifactPath)) { throw "Missing artifact: $artifactPath" }
    $archive = [IO.Compression.ZipFile]::OpenRead($artifactPath)
    try {
        $nativeEntries = @($archive.Entries | Where-Object { $_.FullName -match '\.so$' })
        if ($nativeEntries.Count) { throw "Native libraries present in $artifactPath. Perform ELF and ZIP 16 KB alignment checks before release: $($nativeEntries.FullName -join ', ')" }
        if (@($archive.Entries | Where-Object { $_.FullName -match 'assets/public/node/' }).Count) { throw 'Server verifier was packaged.' }
        Write-Output "PASS no native .so libraries or server verifier: $artifactPath"
    } finally { $archive.Dispose() }
    $digest = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash
    Write-Output "SHA256 $digest  $artifactPath"
}
$badging = & $aaptPath dump badging $apkPath
if ($LASTEXITCODE) { throw 'aapt2 badging failed' }
$badging | Where-Object { $_ -match '^package:|^sdkVersion:|^targetSdkVersion:' } | ForEach-Object { Write-Output "$_" }
if (-not ($badging -match "name='ca.davidandrea.spacearcade'")) { throw 'Wrong package ID' }
if (-not ($badging -match "targetSdkVersion:'36'")) { throw 'Review target SDK requirement (expected 36)' }
$permissions = & $aaptPath dump permissions $apkPath
if ($LASTEXITCODE) { throw 'aapt2 permissions failed' }
$permissions
$unexpected = @($permissions | Select-String "uses-permission.*name='([^']+)'" | ForEach-Object { $_.Matches[0].Groups[1].Value } | Where-Object {
    $_ -notin @('android.permission.INTERNET', 'android.permission.VIBRATE', 'ca.davidandrea.spacearcade.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION')
})
if ($unexpected.Count) { throw "Unexpected permissions: $($unexpected -join ', ')" }
Write-Output 'PASS package, SDK and permission audit. Still test the Play-delivered app on a 16 KB device/emulator.'
