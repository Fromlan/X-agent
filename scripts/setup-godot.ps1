# Install a pinned official editor into the CI temporary directory; verify its published asset digest first.
$ErrorActionPreference = 'Stop'
if (-not $env:RUNNER_TEMP) { throw 'RUNNER_TEMP is required for isolated CI installation' }
$godotVersion = '4.7.2'
$godotAsset = "Godot_v$godotVersion-stable_win64.exe.zip"
$godotArchive = Join-Path $env:RUNNER_TEMP $godotAsset
$godotDirectory = Join-Path $env:RUNNER_TEMP "x-agent-godot-$godotVersion"
# Source: https://github.com/godotengine/godot-builds/releases/expanded_assets/4.7.2-stable
$expectedDigest = '731980f9608d61333e5baf54a2ef17210acc7a538446c0cb9969f002aca1e953'
Invoke-WebRequest -Uri "https://github.com/godotengine/godot-builds/releases/download/$godotVersion-stable/$godotAsset" -OutFile $godotArchive
if ((Get-FileHash -LiteralPath $godotArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedDigest) { throw 'Godot archive digest mismatch' }
Expand-Archive -LiteralPath $godotArchive -DestinationPath $godotDirectory -Force
$godotBinary = Join-Path $godotDirectory "Godot_v$godotVersion-stable_win64_console.exe"
if (-not (Test-Path -LiteralPath $godotBinary -PathType Leaf)) { throw 'Verified Godot executable is missing' }
"GODOT_BIN=$godotBinary" >> $env:GITHUB_ENV
