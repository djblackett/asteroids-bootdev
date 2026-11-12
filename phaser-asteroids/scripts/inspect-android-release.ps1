param(
    [string]$SdkRoot = "$env:LOCALAPPDATA/Android/Sdk",
    [string]$BuildTools = '36.1.0',
    [switch]$Unsigned,
    # Override the artifact paths (default: Gradle's release outputs). Used to check copies, and to test this script's refusals.
    [string]$ApkPath,
    [string]$AabPath
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$apkName = if ($Unsigned) { 'app-release-unsigned.apk' } else { 'app-release.apk' }
$apkPath = if ($ApkPath) { $ApkPath } else { Join-Path $projectRoot "android/app/build/outputs/apk/release/$apkName" }
$aabPath = if ($AabPath) { $AabPath } else { Join-Path $projectRoot 'android/app/build/outputs/bundle/release/app-release.aab' }
$buildToolsDir = Join-Path $SdkRoot "build-tools/$BuildTools"
$aaptPath = Join-Path $buildToolsDir 'aapt2.exe'
if (-not (Test-Path -LiteralPath $aaptPath)) { throw "Install Android build tools $BuildTools or pass -BuildTools." }

# Text that only the unapproved review copy of the bundled privacy policy contains (src/ui/menu/pages/privacy.ts). A signed artifact
# is meant for testers or Play, and must not ship a draft policy (docs/privacy-policy-draft.md). tests/androidRelease.test.ts keeps
# this list in step with the source while the draft remains.
$draftPolicyMarkers = @('[PRIVACY CONTACT PENDING]', 'DRAFT PRIVACY POLICY - REVIEW PENDING')

Add-Type -AssemblyName System.IO.Compression.FileSystem
$draftFindings = @()
foreach ($artifactPath in @($apkPath, $aabPath)) {
    if (-not (Test-Path -LiteralPath $artifactPath)) { throw "Missing artifact: $artifactPath" }
    $archive = [IO.Compression.ZipFile]::OpenRead($artifactPath)
    try {
        $nativeEntries = @($archive.Entries | Where-Object { $_.FullName -match '\.so$' })
        if ($nativeEntries.Count) { throw "Native libraries present in $artifactPath. Perform ELF and ZIP 16 KB alignment checks before release: $($nativeEntries.FullName -join ', ')" }
        if (@($archive.Entries | Where-Object { $_.FullName -match 'assets/public/node/' }).Count) { throw 'Server verifier was packaged.' }
        Write-Output "PASS no native .so libraries or server verifier: $artifactPath"
        $scripts = @($archive.Entries | Where-Object { $_.FullName -match '(^|/)assets/public/assets/[^/]+\.js$' })
        if (-not $scripts.Count) { throw "No bundled game scripts found in $artifactPath" }
        foreach ($entry in $scripts) {
            $reader = New-Object IO.StreamReader($entry.Open())
            try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
            foreach ($marker in $draftPolicyMarkers) {
                if ($text.Contains($marker)) { $draftFindings += "$marker in $(Split-Path -Leaf $artifactPath):$($entry.FullName)" }
            }
        }
    } finally { $archive.Dispose() }
    $digest = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash
    Write-Output "SHA256 $digest  $artifactPath"
}
$badging = & $aaptPath dump badging $apkPath
if ($LASTEXITCODE) { throw 'aapt2 badging failed' }
$badging | Where-Object { $_ -match '^package:|^sdkVersion:|^targetSdkVersion:' } | ForEach-Object { Write-Output "$_" }
if (-not ($badging -match "name='ca.davidandrea.spacearcade'")) { throw 'Wrong package ID' }
if (-not ($badging -match "targetSdkVersion:'36'")) { throw 'Review target SDK requirement (expected 36)' }
if ($badging -match '^application-debuggable') { throw 'APK is debuggable: release artifacts must come from the release build type' }
$permissions = & $aaptPath dump permissions $apkPath
if ($LASTEXITCODE) { throw 'aapt2 permissions failed' }
$permissions
$unexpected = @($permissions | Select-String "uses-permission.*name='([^']+)'" | ForEach-Object { $_.Matches[0].Groups[1].Value } | Where-Object {
    $_ -notin @('android.permission.INTERNET', 'android.permission.VIBRATE', 'ca.davidandrea.spacearcade.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION')
})
if ($unexpected.Count) { throw "Unexpected permissions: $($unexpected -join ', ')" }
Write-Output 'PASS package, SDK, debuggable and permission audit.'

if ($Unsigned) {
    foreach ($finding in $draftFindings) { Write-Output "WARN draft privacy text bundled (allowed only for unsigned audit/test builds): $finding" }
    Write-Output 'Unsigned audit only: no signature or certificate was checked. Not uploadable.'
} else {
    # Signed artifacts: a real (non-debug) signature on both, and no draft policy. Every problem is reported before failing.
    $problems = @()
    $apksigner = Join-Path $buildToolsDir 'apksigner.bat'
    $apkCerts = & $apksigner verify --print-certs $apkPath 2>&1
    if ($LASTEXITCODE) { $problems += "APK signature does not verify: $(($apkCerts | Select-Object -First 2) -join ' ')" }
    $apkCerts | Where-Object { $_ -match 'certificate (DN|SHA-256 digest)' } | ForEach-Object { Write-Output "APK $_" }
    if ($apkCerts -match 'CN=Android Debug') { $problems += 'APK is signed with the Android debug key, not the upload key' }
    $jarsigner = if ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin/jarsigner.exe'))) { Join-Path $env:JAVA_HOME 'bin/jarsigner.exe' } else { (Get-Command jarsigner -ErrorAction SilentlyContinue).Source }
    if (-not $jarsigner) {
        $problems += 'jarsigner not found: set JAVA_HOME to JDK 21 to verify the AAB signature'
    } else {
        $aabCerts = & $jarsigner -verify -verbose -certs $aabPath 2>&1
        if ($LASTEXITCODE -or -not ($aabCerts -match '^jar verified\.')) { $problems += "AAB is unsigned or its signature does not verify: $(($aabCerts | Where-Object { $_ -match '\S' } | Select-Object -Last 1))" }
        if ($aabCerts -match 'CN=Android Debug') { $problems += 'AAB is signed with the Android debug key, not the upload key' }
    }
    foreach ($finding in $draftFindings) { $problems += "draft privacy policy bundled; approve the policy and contact first (docs/privacy-policy-draft.md): $finding" }
    if ($problems.Count) { throw "Signed release inspection failed:`n  - $($problems -join "`n  - ")" }
    Write-Output 'PASS APK and AAB signatures verify, neither uses the Android debug key, and no draft privacy text is bundled.'
    Write-Output 'Compare the printed certificate digest with the registered upload certificate.'
}
Write-Output 'Still test the Play-delivered app on a 16 KB device/emulator.'
