$startup = [wmiclass]"Win32_ProcessStartup"
$startupConfig = $startup.CreateInstance()
$startupConfig.ShowWindow = 0
$process = [wmiclass]"Win32_Process"
$dir = "C:\Vinicius - Arquivos\Doc Vinicius\Projetos IA\youtube-validador"
$result = $process.Create("node index.js", $dir, $startupConfig)
Write-Output "Started node with PID $($result.ProcessId)"
