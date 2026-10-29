# Puts a "pixel3d" shortcut on the desktop that runs start-pixel3d.ps1 with no console window.
$desktop = [Environment]::GetFolderPath('Desktop')
$link = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'pixel3d.lnk'))
$link.TargetPath = (Get-Command powershell.exe).Source
$link.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'start-pixel3d.ps1')`""
$link.WorkingDirectory = Split-Path -Parent $PSScriptRoot
# Explorer often won't load an icon from a network drive (Z:), so keep a local copy.
$iconDir = Join-Path $env:LOCALAPPDATA 'pixel3d'
New-Item -ItemType Directory -Force $iconDir | Out-Null
$icon = Join-Path $iconDir 'pixel3d.ico'
Copy-Item (Join-Path $PSScriptRoot 'pixel3d.ico') $icon -Force
$link.IconLocation = "$icon,0"
$link.Description = 'Open the pixel3d app'
$link.Save()
"Shortcut made: $(Join-Path $desktop 'pixel3d.lnk')"
