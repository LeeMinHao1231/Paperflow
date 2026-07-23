$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$WorkFolder = Join-Path $ProjectRoot "work"
$OcrPidFile = Join-Path $WorkFolder "paddleocr.pid"
$WebPidFile = Join-Path $WorkFolder "paperflow-web.pid"
$BundledPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$SystemPython = Get-Command python -ErrorAction SilentlyContinue
$RuntimePython = if (Test-Path -LiteralPath $BundledPython) { $BundledPython } elseif ($SystemPython) { $SystemPython.Source } else { $null }
$VirtualEnvironment = Join-Path $ProjectRoot ".paddleocr-venv"
$Python = Join-Path $VirtualEnvironment "Scripts\python.exe"
$Node = (Get-Command node -ErrorAction Stop).Source
$VinextCli = Join-Path $ProjectRoot "node_modules\vinext\dist\cli.js"

New-Item -ItemType Directory -Force -Path $WorkFolder | Out-Null

function Test-LocalPort([int]$Port) {
    foreach ($Address in @("127.0.0.1", "::1")) {
        $Client = [System.Net.Sockets.TcpClient]::new()
        try {
            $Connection = $Client.ConnectAsync($Address, $Port)
            if ($Connection.Wait(500) -and $Client.Connected) {
                return $true
            }
        }
        catch {
        }
        finally {
            $Client.Dispose()
        }
    }
    return $false
}

function Start-HiddenProcess([string]$FileName, [string]$Arguments) {
    $Info = [System.Diagnostics.ProcessStartInfo]::new()
    $Info.FileName = $FileName
    $Info.Arguments = $Arguments
    $Info.WorkingDirectory = $ProjectRoot
    $Info.UseShellExecute = $false
    $Info.CreateNoWindow = $true
    return [System.Diagnostics.Process]::Start($Info)
}

if (-not $RuntimePython) {
    throw "Python is not available. Install Python 3.11 or 3.12, then try again."
}
if (-not (Test-Path -LiteralPath $Python)) {
    & $RuntimePython -m venv $VirtualEnvironment
}
& $Python -c "import importlib.metadata as m; [m.version(x) for x in ('fastapi','paddlepaddle','paddleocr','uvicorn')]" 2>$null
if ($LASTEXITCODE -ne 0) {
    & $Python -m pip install --disable-pip-version-check -r (Join-Path $ProjectRoot "ocr_service\requirements.txt")
}

if (-not (Test-LocalPort 8765)) {
    $OcrProcess = Start-HiddenProcess $Python "-m uvicorn ocr_service.app:app --host 127.0.0.1 --port 8765 --app-dir `"$ProjectRoot`""
    Set-Content -LiteralPath $OcrPidFile -Value $OcrProcess.Id
}

$OcrReady = $false
for ($Attempt = 0; $Attempt -lt 120; $Attempt++) {
    if (Test-LocalPort 8765) {
        $OcrReady = $true
        break
    }
    Start-Sleep -Milliseconds 500
}
if (-not $OcrReady) {
    throw "The local OCR reader did not start. Run 'npm run dev:ocr' to see its detailed error."
}

if (-not (Test-LocalPort 3000)) {
    $WebProcess = Start-HiddenProcess $Node "`"$VinextCli`" dev --hostname 127.0.0.1 --port 3000"
    Set-Content -LiteralPath $WebPidFile -Value $WebProcess.Id
}

$WebReady = $false
for ($Attempt = 0; $Attempt -lt 120; $Attempt++) {
    if (Test-LocalPort 3000) {
        $WebReady = $true
        break
    }
    Start-Sleep -Milliseconds 500
}
if (-not $WebReady) {
    throw "The Paperflow website did not start. Run 'npm run dev' to see its detailed error."
}

Write-Host ""
Write-Host "Paperflow is running:"
Write-Host "http://localhost:3000"
Write-Host ""
Write-Host "To stop both services later, run: npm run stop"
