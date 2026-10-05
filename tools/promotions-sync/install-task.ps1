# Registra (ou atualiza) a tarefa diária no Agendador de Tarefas do Windows.
# Roda com o seu usuário logado; se o PC estiver desligado no horário, executa assim que ligar.
param(
    [string]$Time = "07:30",
    [string]$TaskName = "yt-dashboard: sincronizar promoções"
)

$ErrorActionPreference = "Stop"
$toolDir = $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source

$action = New-ScheduledTaskAction -Execute $node -Argument "sync.mjs" -WorkingDirectory $toolDir
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 20) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Tarefa '$TaskName' registrada: todo dia às $Time (ou assim que o PC ligar)."
Write-Host "Testar agora:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Log:           $toolDir\.data\promotions-sync.log"
