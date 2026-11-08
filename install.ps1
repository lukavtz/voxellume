[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$commit = '__VOXELLUME_COMMIT__'
$archiveSha256 = '__VOXELLUME_ZIP_SHA256__'
$tempDir = $null

function Assert-NativeSuccess([string]$Message) {
    if ($LASTEXITCODE -ne 0) {
        throw "Voxellume install failed: $Message"
    }
}

try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Voxellume install failed: Node.js 24.9.0 or newer is required.'
    }
    $nodeVersion = [version](& node -p 'process.versions.node')
    Assert-NativeSuccess 'Could not determine the Node.js version.'
    if ($nodeVersion -lt [version]'24.9.0') {
        throw 'Voxellume install failed: Node.js 24.9.0 or newer is required.'
    }
    if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) {
        throw 'Voxellume install failed: Corepack is required.'
    }
    & corepack pnpm --version | Out-Null
    Assert-NativeSuccess 'pnpm is unavailable through Corepack.'

    if ($env:PNPM_HOME) {
        $env:PATH = "$env:PNPM_HOME;$env:PNPM_HOME\bin;$env:PATH"
    }

    $commitPlaceholder = '__VOXELLUME_' + 'COMMIT__'
    $archivePlaceholder = '__VOXELLUME_' + 'ZIP_SHA256__'
    $localMode = $false
    if ($commit -eq $commitPlaceholder -and $archiveSha256 -eq $archivePlaceholder) {
        $localMode = $true
    }
    elseif ($commit -eq $commitPlaceholder -or $archiveSha256 -eq $archivePlaceholder) {
        throw 'Voxellume install failed: Installer pins were not rendered consistently.'
    }
    elseif ($commit -notmatch '^[0-9a-f]{40}$' -or $archiveSha256 -notmatch '^[0-9a-f]{64}$') {
        throw 'Voxellume install failed: Invalid installer pins.'
    }

    $tempDir = Join-Path ([IO.Path]::GetTempPath()) ('voxellume-install-' + [guid]::NewGuid().ToString('N'))
    $packDir = Join-Path $tempDir 'package'
    New-Item -ItemType Directory -Path $packDir -Force | Out-Null

    if ($localMode) {
        $sourceDir = $PSScriptRoot
        if (-not (Test-Path -LiteralPath (Join-Path $sourceDir 'package.json') -PathType Leaf) -or
            -not (Test-Path -LiteralPath (Join-Path $sourceDir 'pnpm-lock.yaml') -PathType Leaf)) {
            throw 'Voxellume install failed: Local install must run from a Voxellume source checkout.'
        }
    }
    else {
        $archive = Join-Path $tempDir 'voxellume.zip'
        $archiveUrl = 'https://codeload.github.com/lukavtz/voxellume/zip/__VOXELLUME_COMMIT__'
        Invoke-WebRequest -Uri $archiveUrl -OutFile $archive -UseBasicParsing
        $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $archiveSha256) {
            throw 'Voxellume install failed: Source archive SHA-256 mismatch.'
        }
        $sourceRoot = Join-Path $tempDir 'source'
        Expand-Archive -LiteralPath $archive -DestinationPath $sourceRoot
        $roots = @(Get-ChildItem -LiteralPath $sourceRoot -Directory)
        if ($roots.Count -ne 1) {
            throw 'Voxellume install failed: Unexpected source archive layout.'
        }
        $sourceDir = $roots[0].FullName
    }

    Push-Location $sourceDir
    try {
        & corepack pnpm install --frozen-lockfile
        Assert-NativeSuccess 'Dependency installation failed.'
        & corepack pnpm pack --pack-destination $packDir
        Assert-NativeSuccess 'Package build failed.'
        $packages = @(Get-ChildItem -LiteralPath $packDir -Filter '*.tgz' -File)
        if ($packages.Count -ne 1) {
            throw 'Voxellume install failed: Expected exactly one packed artifact.'
        }
        & corepack pnpm add -g $packages[0].FullName
        Assert-NativeSuccess 'Global package installation failed.'
    }
    finally {
        Pop-Location
    }

    $globalBin = (& corepack pnpm bin -g | Select-Object -Last 1)
    Assert-NativeSuccess 'Could not determine the global pnpm bin directory.'
    Write-Output 'Installed. Run: voxellume-mcp'
    if (($env:PATH -split [IO.Path]::PathSeparator) -notcontains $globalBin) {
        Write-Output "Add the pnpm global bin directory to PATH: $globalBin"
    }
}
finally {
    if ($tempDir -and (Test-Path -LiteralPath $tempDir)) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force
    }
}
