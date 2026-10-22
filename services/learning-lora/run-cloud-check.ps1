param(
  [Parameter(Mandatory=$true)][string]$Template,
  [Parameter(Mandatory=$true)][string]$Tokenizer
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$config = Get-Content -LiteralPath (Join-Path $projectRoot '.taskbook-working/ascend-demo/connection.local.json') -Raw | ConvertFrom-Json
if ($config.host -notmatch '^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$' -or $config.port -lt 1 -or $config.port -gt 65535) { throw 'Invalid saved SSH target' }
if (!(Test-Path -LiteralPath $config.keyPath) -or !(Test-Path -LiteralPath (Join-Path $projectRoot $config.knownHostsPath))) { throw 'Saved SSH files unavailable' }
$sourceLock = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'source-lock.json') -Raw | ConvertFrom-Json
$templateFile = (Resolve-Path -LiteralPath $Template).Path
if ((Get-FileHash -LiteralPath $templateFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sourceLock.files.'research/qwen2_5/finetune_qwen2_5_1_5b_8k.yaml'.sha256) { throw 'Official template hash mismatch' }
$tokenizerPath = (Resolve-Path -LiteralPath $Tokenizer).Path
foreach ($asset in $sourceLock.tokenizerAssets.PSObject.Properties) {
  if ((Get-FileHash -LiteralPath (Join-Path $tokenizerPath $asset.Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $asset.Value.sha256) { throw 'Tokenizer hash mismatch' }
}
$runId = 'prep-' + ([Guid]::NewGuid().ToString('N').Substring(0,12))
$remote = '/home/ma-user/work/taskbook-lora-' + $runId
$scratch = '/home/ma-user/.cache/taskbook-learning-lora/' + $runId
$localEvidence = Join-Path $projectRoot ('.taskbook-working/lora-pilot-20261018/' + $runId)
New-Item -ItemType Directory -Path $localEvidence | Out-Null
@{ remote=$remote; scratch=$scratch; pretrainedWeightsDownloaded=$false; semanticAcceptance=$false } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $localEvidence 'run.json') -Encoding UTF8
$knownHosts = Join-Path $projectRoot $config.knownHostsPath
$common = @('-o','BatchMode=yes','-o','ConnectTimeout=8','-o','ConnectionAttempts=1','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','-o','StrictHostKeyChecking=yes','-o',('UserKnownHostsFile=' + $knownHosts),'-i',$config.keyPath)
$sshArgs = $common + @('-p',[string]$config.port,$config.host)
$scpArgs = $common + @('-P',[string]$config.port)
# Only new owned paths are created; no deletion, package installation, service start or weight download.
& ssh @sshArgs "set -e; umask 077; mkdir '$remote'; mkdir '$remote/lab'; mkdir -p '/home/ma-user/.cache/taskbook-learning-lora'; mkdir '$scratch'"
if ($LASTEXITCODE -ne 0) { throw 'Cannot create isolated remote directories' }
foreach ($name in @('prepare.py','runtime_smoke.py','check_tokens.py','test_prepare.py','seed-cases.jsonl','source-lock.json')) {
  & scp @scpArgs (Join-Path $PSScriptRoot $name) ('{0}:{1}/lab/{2}' -f $config.host,$remote,$name)
  if ($LASTEXITCODE -ne 0) { throw 'Code transfer failed' }
}
& scp @scpArgs $templateFile ('{0}:{1}/template.yaml' -f $config.host,$remote)
if ($LASTEXITCODE -ne 0) { throw 'Template transfer failed' }
& ssh @sshArgs "mkdir '$remote/tokenizer'"
if ($LASTEXITCODE -ne 0) { throw 'Tokenizer directory creation failed' }
foreach ($asset in $sourceLock.tokenizerAssets.PSObject.Properties) {
  & scp @scpArgs (Join-Path $tokenizerPath $asset.Name) ('{0}:{1}/tokenizer/{2}' -f $config.host,$remote,$asset.Name)
  if ($LASTEXITCODE -ne 0) { throw 'Tokenizer transfer failed' }
}
$command = @"
set -e
umask 077
cd '$scratch'
python -m unittest discover -s '$remote/lab' -p 'test_*.py' -v
python '$remote/lab/prepare.py' --template '$remote/template.yaml' --output '$remote/bundle' --remote-root '$scratch'
python '$remote/lab/check_tokens.py' --bundle '$remote/bundle' --tokenizer '$remote/tokenizer' --output '$remote/token-check.json'
source /usr/local/Ascend/ascend-toolkit/set_env.sh >/dev/null 2>&1
timeout -k 5s 120s python '$remote/lab/runtime_smoke.py' --output '$remote/runtime.json' --tiny-lora
"@
try {
  # Native stderr is a log stream, not a reason to abandon evidence retrieval.
  $ErrorActionPreference = 'Continue'
  & ssh @sshArgs $command 2>&1 | Tee-Object -FilePath (Join-Path $localEvidence 'remote.log')
  $result = $LASTEXITCODE
} finally { $ErrorActionPreference = 'Stop' }
# Pull evidence even on runtime failure; original failures and directories remain reviewable.
foreach ($name in @('bundle','token-check.json','runtime.json')) {
  $ErrorActionPreference = 'Continue'
  & scp @scpArgs -r ('{0}:{1}/{2}' -f $config.host,$remote,$name) $localEvidence 2>&1 | Out-Null
  $ErrorActionPreference = 'Stop'
}
$evidenceValid = $false
try {
  $runtime = Get-Content -LiteralPath (Join-Path $localEvidence 'runtime.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $tokens = Get-Content -LiteralPath (Join-Path $localEvidence 'token-check.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $bundle = Get-Content -LiteralPath (Join-Path $localEvidence 'bundle/manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $evidenceValid = $runtime.passed -eq $true -and $tokens.passed -eq $true -and $bundle.counts.train -eq 12 -and $bundle.counts.heldout -eq 6
} catch { $evidenceValid = $false }
@{ remoteExitCode=$result; evidenceValidated=$evidenceValid; output=$localEvidence; semanticAcceptance=$false; pretrainedWeightsDownloaded=$false } | ConvertTo-Json -Compress | Write-Output
if ($result -ne 0 -or !$evidenceValid) { exit 1 }
