# Shared helpers for the pipeline check scripts. Dot-source this file; do not run it directly.
# Compatible with Windows PowerShell 5.1 and PowerShell 7.

function Get-RepoRoot {
    return (Split-Path -Parent $PSScriptRoot)
}

# Reads the YAML front matter of an ADR file and returns status and feature (both lower-cased and
# stripped of trailing comments), or $null if the file has no front matter.
function Get-AdrInfo {
    param([Parameter(Mandatory)][string]$Path)

    $lines = [System.IO.File]::ReadAllLines($Path)
    if ($lines.Length -eq 0 -or $lines[0].Trim() -ne '---') { return $null }

    $status = $null
    $feature = $null
    for ($i = 1; $i -lt $lines.Length; $i++) {
        $line = $lines[$i]
        if ($line.Trim() -eq '---') { break }
        if ($line -match '^status:\s*(.*)$') { $status = ($Matches[1] -replace '\s+#.*$', '').Trim().ToLower() }
        if ($line -match '^feature:\s*(.*)$') { $feature = ($Matches[1] -replace '\s+#.*$', '').Trim().ToLower() }
    }

    return [pscustomobject]@{
        Name    = [System.IO.Path]::GetFileName($Path)
        Status  = $status
        Feature = $feature
    }
}

# Returns the ADR files (not the template or index) under pipeline/decisions/adr.
function Get-AdrFiles {
    param([Parameter(Mandatory)][string]$Root)

    $dir = Join-Path $Root 'pipeline\decisions\adr'
    if (-not (Test-Path $dir)) { return @() }
    return @(Get-ChildItem -Path $dir -Filter 'ADR-*.md' -File | Sort-Object Name)
}
