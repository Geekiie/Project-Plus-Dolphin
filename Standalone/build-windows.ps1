param([string]$CMake = 'cmake')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $repoRoot
try {
    git submodule update --init --recursive
    if ($LASTEXITCODE -ne 0) { throw 'Submodule fetch failed' }
    & $CMake -S . -B build/standalone -G 'Visual Studio 18 2026' -A x64 -DENABLE_QT=OFF -DENABLE_NOGUI=ON -DENABLE_TESTS=ON -DUSE_DISCORD_PRESENCE=OFF -DUSE_MGBA=OFF -DUSE_RETRO_ACHIEVEMENTS=OFF -DENABLE_AUTOUPDATE=OFF '-DORCA_VERSION=0.3.28' -DDISTRIBUTOR=ProjectPlusStandalone
    if ($LASTEXITCODE -ne 0) { throw 'CMake configure failed' }
    & $CMake --build build/standalone --config Release --target dolphin-nogui dolphin-tool tests --parallel 8
    if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
} finally { Pop-Location }
