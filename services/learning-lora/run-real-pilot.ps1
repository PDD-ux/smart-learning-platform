param(
  [Parameter(Mandatory=$true)][ValidateSet('download','baseline','train','reload')][string]$Phase,
  [string]$RunFile,
  [ValidateRange(1,3)][int]$Attempt = 1
)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$connection = Get-Content -LiteralPath (Join-Path $project '.taskbook-working/ascend-demo/connection.local.json') -Raw | ConvertFrom-Json
if ($connection.host -notmatch '^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$' -or $connection.port -lt 1 -or $connection.port -gt 65535) { throw 'Invalid saved SSH target' }
$common = @('-o','BatchMode=yes','-o','ConnectTimeout=8','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','-o','StrictHostKeyChecking=yes','-o',('UserKnownHostsFile=' + (Join-Path $project $connection.knownHostsPath)),'-i',$connection.keyPath)
$sshArgs = $common + @('-p',[string]$connection.port,$connection.host)
$scpArgs = $common + @('-P',[string]$connection.port)
if ($Phase -eq 'download') {
  if ($Attempt -ne 1) { throw 'Download cannot be automatically retried' }
  if ($RunFile) { throw 'Download starts a new experiment; no overwrite/resume' }
  $id = [Guid]::NewGuid().ToString('N').Substring(0,12)
  $evidence = Join-Path $project ('.taskbook-working/lora-real-20261018/run-' + $id)
  New-Item -ItemType Directory -Path $evidence | Out-Null
  $run = @{ remote=('/home/ma-user/work/taskbook-lora-real-' + $id); scratch=('/home/ma-user/.cache/taskbook-learning-lora/real-' + $id); output=$evidence; deadlineEpoch=([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 1800) }
  $RunFile = Join-Path $evidence 'run.json'
  $run | ConvertTo-Json | Set-Content -LiteralPath $RunFile -Encoding UTF8
  & ssh @sshArgs "set -e; umask 077; mkdir '$($run.remote)'; mkdir '$($run.remote)/lab'; mkdir '$($run.remote)/artifacts'; mkdir '$($run.scratch)'"
  if ($LASTEXITCODE -ne 0) { throw 'Cannot create isolated experiment' }
} else {
  if (!$RunFile) { throw 'Existing run.json is required' }
  $run = Get-Content -LiteralPath $RunFile -Raw -Encoding UTF8 | ConvertFrom-Json
}
if ($run.remote -notmatch '^/home/ma-user/work/taskbook-lora-real-[a-f0-9]{12}$' -or $run.scratch -notmatch '^/home/ma-user/\.cache/taskbook-learning-lora/real-[a-f0-9]{12}$') { throw 'Invalid experiment paths' }
if (![IO.Path]::GetFullPath($run.output).StartsWith((Join-Path $project '.taskbook-working/lora-real-20261018/run-'))) { throw 'Invalid evidence location' }
$remaining = [int64]$run.deadlineEpoch - [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
if ($remaining -le 0) { throw 'Experiment budget expired; no automatic extension' }
$timeout = [Math]::Min($remaining, $(if ($Phase -eq 'train') { 900 } else { 600 }))
$attemptName = if ($Attempt -eq 1) { $Phase } else { "$Phase-attempt$Attempt" }
$snapshot = Join-Path $run.output ($attemptName + '-source')
New-Item -ItemType Directory -Path $snapshot | Out-Null
foreach ($name in @('pilot.py','evaluate.py','prepare.py','seed-cases.jsonl','source-lock.json')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $snapshot $name)
  & scp @scpArgs (Join-Path $PSScriptRoot $name) ('{0}:{1}/lab/{2}' -f $connection.host,$run.remote,$name)
  if ($LASTEXITCODE -ne 0) { throw 'Experiment source transfer failed' }
}
Get-ChildItem -LiteralPath $snapshot -File | Get-FileHash -Algorithm SHA256 |
  Select-Object @{Name='file';Expression={Split-Path $_.Path -Leaf}},Hash |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $snapshot 'sha256.json') -Encoding UTF8
# Reuse only previously hash-verified tiny assets, not packages, models or private course data.
$assets = '/home/ma-user/work/taskbook-lora-prep-7f984f85cb12'
if ($Phase -eq 'download') {
  & ssh @sshArgs "set -e; umask 077; python '$($run.remote)/lab/prepare.py' --template '$assets/template.yaml' --output '$($run.remote)/bundle' --remote-root '$($run.scratch)'; cp '$($run.remote)/bundle/candidate.yaml' '$($run.scratch)/candidate.yaml'"
  if ($LASTEXITCODE -ne 0) { throw 'Candidate generation failed' }
}
$command = @"
set -e
umask 077
cd '$($run.scratch)'
source /usr/local/Ascend/ascend-toolkit/set_env.sh >/dev/null 2>&1
timeout -k 10s ${timeout}s python '$($run.remote)/lab/pilot.py' '$Phase' --scratch '$($run.scratch)' --artifacts '$($run.remote)/artifacts' --tokenizer '$assets/tokenizer' --attempt '$Attempt'
"@
$ErrorActionPreference = 'Continue'
& ssh @sshArgs $command 2>&1 | Tee-Object -FilePath (Join-Path $run.output ($attemptName + '.log'))
$result = $LASTEXITCODE
& scp @scpArgs -r ('{0}:{1}/artifacts' -f $connection.host,$run.remote) $run.output 2>&1 | Out-Null
$pullResult = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
@{ phase=$Phase; remoteExitCode=$result; evidenceCopied=($pullResult -eq 0); runFile=$RunFile } | ConvertTo-Json -Compress | Write-Output
if ($result -ne 0 -or $pullResult -ne 0) { exit 1 }
