param([string]$JobFile, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
try {
    Add-Type -Path (Join-Path $PSScriptRoot 'windows-preview.cs')
    if ($CheckOnly) {
        Write-Output 'Native launcher compiled'
        exit 0
    }
    if (-not $JobFile) { throw 'JobFile is required' }
    $job = Get-Content -LiteralPath $JobFile -Raw | ConvertFrom-Json
    [Pptinit.WindowsPreview]::Run([string]$job.executable, [string[]]$job.args, [string]$job.work)
    exit 0
} catch {
    [Console]::Error.WriteLine('Windows preview sandbox failed: ' + $_.Exception.Message)
    exit 1
}
