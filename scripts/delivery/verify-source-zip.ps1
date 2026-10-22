param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$Archive
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $Archive) { throw 'Archive already exists' }
[IO.Compression.ZipFile]::CreateFromDirectory($Source, $Archive, [IO.Compression.CompressionLevel]::Optimal, $true)
$zip = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
  $prefix = (Split-Path -Leaf $Source) + '/'
  $manifestEntry = $zip.GetEntry($prefix + 'DELIVERY-MANIFEST.json')
  if (-not $manifestEntry) { throw 'Missing manifest' }
  $reader = [IO.StreamReader]::new($manifestEntry.Open())
  try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
  $expected = @{}
  foreach ($file in $manifest.files) {
    if ($expected.ContainsKey($file.path) -or $file.path -match '(^/|(^|/)\.\.(/|$)|\\|:)') { throw 'Unsafe manifest path' }
    $expected[$file.path] = $file
  }
  $seen = @{}
  foreach ($entry in $zip.Entries) {
    if ($entry.FullName.EndsWith('/')) { continue }
    if (-not $entry.FullName.StartsWith($prefix, [StringComparison]::Ordinal)) { throw 'Unexpected root' }
    $relative = $entry.FullName.Substring($prefix.Length)
    if ($relative -eq 'DELIVERY-MANIFEST.json') { continue }
    if (-not $expected.ContainsKey($relative) -or $seen.ContainsKey($relative)) { throw 'Unexpected or duplicate entry' }
    $stream = $entry.Open()
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $digest = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose(); $stream.Dispose() }
    if ($digest -ne $expected[$relative].sha256 -or $entry.Length -ne $expected[$relative].bytes) { throw 'Entry hash or length mismatch' }
    $seen[$relative] = $true
  }
  if ($seen.Count -ne $expected.Count) { throw 'Missing entries' }
  [pscustomobject]@{ verified = $true; files = $seen.Count; manifestIncluded = $true } | ConvertTo-Json -Compress
} finally { $zip.Dispose() }
