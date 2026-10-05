# Registra (ou atualiza) a tarefa diaria no Agendador de Tarefas do Windows.
# Roda com o seu usuario logado; se o PC estiver desligado no horario, executa assim que ligar.
param(
    [string]$Time = "07:30",
    [string]$TaskName = "yt-dashboard-promocoes"
)

$ErrorActionPreference = "Stop"
$toolDir = $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source

$action = New-ScheduledTaskAction -Execute $node -Argument "sync.mjs" -WorkingDirectory $toolDir
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Tarefa '$TaskName' registrada: todo dia as $Time (ou assim que o PC ligar)."
Write-Host "Testar agora:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Log:           $toolDir\.data\promotions-sync.log"
