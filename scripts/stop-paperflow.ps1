$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PidFiles = @(
    (Join-Path $ProjectRoot "work\paperflow-web.pid"),
    (Join-Path $ProjectRoot "work\paddleocr.pid")
)

foreach ($PidFile in $PidFiles) {
    if (-not (Test-Path -LiteralPath $PidFile -PathType Leaf)) {
        continue
    }
    $SavedPid = Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue
    if ($SavedPid -match "^\d+$") {
        Stop-Process -Id ([int]$SavedPid) -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

Write-Host "Paperflow services stopped."
