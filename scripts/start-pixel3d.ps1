# Starts the pixel3d app on this PC (if it isn't running yet) and opens it in the default browser.
# The desktop shortcut runs this; make the shortcut with scripts/make-shortcut.ps1.
# The server keeps running in the background until you sign out or restart; its log is %TEMP%\pixel3d-server.log.
$root = Split-Path -Parent $PSScriptRoot
$url = 'http://localhost:5180/'

function Test-Up {
  try { (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false }
}

if (-not (Test-Up)) {
  $log = Join-Path $env:TEMP 'pixel3d-server.log'
  Start-Process -WindowStyle Hidden -WorkingDirectory $root -FilePath 'cmd.exe' `
    -ArgumentList '/c', "npm run dev:web -- --port 5180 --strictPort > `"$log`" 2>&1"
  # wait up to 30 s for the server to answer
  for ($i = 0; $i -lt 60 -and -not (Test-Up); $i++) { Start-Sleep -Milliseconds 500 }
}
Start-Process $url
