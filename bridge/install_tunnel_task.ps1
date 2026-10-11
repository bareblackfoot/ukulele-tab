# Registers \NuRILab\Ukulele-Tunnel: keeps a Cloudflare quick tunnel to the bridge open so the page works on
# other devices (iPad). Starts at logon and checks every 10 minutes (a second copy exits at once).
$py = "$env:USERPROFILE\miniconda3\pythonw.exe"
$script = "D:\codes\ukulele-tab\bridge\tunnel.py"
if (-not (Test-Path $py)) { throw "pythonw not found: $py" }
$action = New-ScheduledTaskAction -Execute $py -Argument "`"$script`"" -WorkingDirectory (Split-Path $script)
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$every = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 10)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskPath "\NuRILab\" -TaskName "Ukulele-Tunnel" -Action $action -Trigger @($logon, $every) `
  -Settings $settings -Description "우쿨렐레 악보 페이지를 아이패드 등 다른 기기에서 로그인·기록·내 악보로 쓰게 브리지를 Cloudflare 터널로 엶 (D:\codes\ukulele-tab\bridge\tunnel.py)" -Force | Out-Null
Start-ScheduledTask -TaskPath "\NuRILab\" -TaskName "Ukulele-Tunnel"
"registered"
