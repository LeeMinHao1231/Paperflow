$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BundledPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$SystemPython = Get-Command python -ErrorAction SilentlyContinue
$RuntimePython = if (Test-Path -LiteralPath $BundledPython) { $BundledPython } elseif ($SystemPython) { $SystemPython.Source } else { $null }
$VirtualEnvironment = Join-Path $ProjectRoot ".paddleocr-venv"
$Python = Join-Path $VirtualEnvironment "Scripts\python.exe"

if (-not $RuntimePython) {
    throw "Python is not available. Install Python 3.11 or 3.12, then run this command again."
}

if (-not (Test-Path -LiteralPath $Python)) {
    & $RuntimePython -m venv $VirtualEnvironment
}

& $Python -c "import importlib.metadata as m; [m.version(x) for x in ('fastapi','paddlepaddle','paddleocr','uvicorn')]" 2>$null
if ($LASTEXITCODE -ne 0) {
    & $Python -m pip install --disable-pip-version-check -r (Join-Path $ProjectRoot "ocr_service\requirements.txt")
}
& $Python -m uvicorn ocr_service.app:app --host 127.0.0.1 --port 8765 --app-dir $ProjectRoot
