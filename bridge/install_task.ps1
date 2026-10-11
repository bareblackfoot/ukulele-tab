# Registers \NuRILab\Ukulele-Bridge: starts bridge.py with pythonw at logon and checks every 10 minutes
# (a second copy exits at once because the port is taken, so the check only restarts a bridge that died).
$py = "$env:USERPROFILE\miniconda3\pythonw.exe"
$script = "D:\codes\ukulele-tab\bridge\bridge.py"
if (-not (Test-Path $py)) { throw "pythonw not found: $py" }
$action = New-ScheduledTaskAction -Execute $py -Argument "`"$script`"" -WorkingDirectory (Split-Path $script)
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$every = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 10)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskPath "\NuRILab\" -TaskName "Ukulele-Bridge" -Action $action -Trigger @($logon, $every) `
  -Settings $settings -Description "우쿨렐레 악보 페이지가 이 PC의 Claude에게 유튜브 채보를 맡기는 연결 프로그램 (D:\codes\ukulele-tab\bridge)" -Force | Out-Null
Start-ScheduledTask -TaskPath "\NuRILab\" -TaskName "Ukulele-Bridge"
"registered"
