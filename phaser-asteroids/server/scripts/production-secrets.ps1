# Windows-only helper. Secret values never belong in command arguments, Wrangler vars, or Vite.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Initialize', 'Check', 'CopyAdminToken', 'DryRun', 'Deploy')]
    [string]$Action
)

$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne 'Win32NT') {
    throw 'This helper uses Windows DPAPI. On other systems use a password manager and Wrangler --secrets-file.'
}
$serverDir = Split-Path -Parent $PSScriptRoot
$secretDir = Join-Path $serverDir '.wrangler/production-secrets'
$backupPath = Join-Path $secretDir 'secrets.clixml'
$names = @('IP_HASH_SALT', 'ADMIN_TOKEN')

$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
if ($Action -eq 'Initialize') {
    if (Test-Path -LiteralPath $backupPath) {
        throw 'Production secrets already exist. Use Check; initialization never overwrites or rotates secrets.'
    }
    # Restrict access before writing. Start from the existing ACL so owner/audit metadata is preserved.
    $null = New-Item -ItemType Directory -Force -Path $secretDir
    $acl = Get-Acl -LiteralPath $secretDir
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($existing in @($acl.Access)) { $null = $acl.RemoveAccessRuleSpecific($existing) }
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'
    )
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $secretDir -AclObject $acl
    $secureValues = @{}
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        foreach ($name in $names) {
            $bytes = New-Object byte[] 32
            $rng.GetBytes($bytes)
            $value = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
            $secureValues[$name] = ConvertTo-SecureString -String $value -AsPlainText -Force
            [Array]::Clear($bytes, 0, $bytes.Length)
            $value = $null
        }
        $secureValues | Export-Clixml -LiteralPath $backupPath
    } finally {
        $rng.Dispose()
        foreach ($secret in $secureValues.Values) { $secret.Dispose() }
    }
    Write-Output 'Prepared IP_HASH_SALT and ADMIN_TOKEN (independent 256-bit random values). Backup encrypted with Windows DPAPI. Nothing uploaded.'
    return
}

if (!(Test-Path -LiteralPath $backupPath)) { throw 'Run Initialize first.' }
foreach ($path in @($secretDir, $backupPath)) {
    $acl = Get-Acl -LiteralPath $path
    foreach ($entry in $acl.Access) {
        if ($entry.AccessControlType -eq 'Allow' -and
            $entry.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) {
            throw 'Secret backup permissions are too broad; restrict access to your Windows user.'
        }
    }
}
$secureValues = Import-Clixml -LiteralPath $backupPath
$values = @{}
$uploadPath = $null
$savedEnv = @{}
try {
    foreach ($name in $names) {
        if ($secureValues[$name] -isnot [System.Security.SecureString]) { throw 'Invalid encrypted secret backup.' }
        $values[$name] = [System.Net.NetworkCredential]::new('', $secureValues[$name]).Password
        if ($values[$name] -cnotmatch '^[0-9a-f]{64}$') { throw 'Secret backup failed validation.' }
    }
    if ($values['IP_HASH_SALT'] -eq $values['ADMIN_TOKEN']) { throw 'Secrets must be independent.' }
    if ($Action -eq 'Check') {
        Write-Output 'Both production secrets decrypt and validate. Values withheld. Nothing uploaded.'
        return
    }
    if ($Action -eq 'CopyAdminToken') {
        Set-Clipboard -Value $values['ADMIN_TOKEN']
        Write-Output 'ADMIN_TOKEN copied to the clipboard. Save it in your password manager, then clear the clipboard with Set-Clipboard -Value "".'
        return
    }

    # Only Deploy publishes. DryRun compiles the same configuration and secret bindings without uploading.
    # The temporary plaintext file inherits the user-only ACL, is git-ignored, and is removed even if Wrangler fails.
    $uploadPath = Join-Path $secretDir ('upload-' + [Guid]::NewGuid().ToString('N') + '.json')
    [System.IO.File]::WriteAllText($uploadPath, ($values | ConvertTo-Json -Compress))
    foreach ($key in @('WRANGLER_WRITE_LOGS', 'WRANGLER_LOG_SANITIZE', 'WRANGLER_LOG', 'WRANGLER_SEND_METRICS')) {
        $savedEnv[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    }
    $env:WRANGLER_WRITE_LOGS = 'false'
    $env:WRANGLER_LOG_SANITIZE = 'true'
    $env:WRANGLER_LOG = 'log'
    $env:WRANGLER_SEND_METRICS = 'false'
    $wranglerArgs = @('deploy', '--env', 'production', '--no-autoconfig', '--secrets-file', $uploadPath)
    if ($Action -eq 'DryRun') { $wranglerArgs += @('--dry-run', '--outdir', '.wrangler/production-dry-run') }
    Push-Location $serverDir
    try {
        & (Join-Path $serverDir 'node_modules/.bin/wrangler.cmd') @wranglerArgs 2>&1 | ForEach-Object {
            $line = "$_"
            foreach ($value in $values.Values) { $line = $line.Replace($value, '[REDACTED]') }
            Write-Output $line
        }
        if ($LASTEXITCODE -ne 0) { throw "Wrangler failed with exit code $LASTEXITCODE." }
    } finally { Pop-Location }
} finally {
    if ($uploadPath -and (Test-Path -LiteralPath $uploadPath)) { Remove-Item -LiteralPath $uploadPath -Force }
    foreach ($key in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($key, $savedEnv[$key], 'Process') }
    foreach ($secret in $secureValues.Values) { $secret.Dispose() }
    $values.Clear()
}
