<#
.SYNOPSIS
    Checks the pipeline entry gate for a role and feature, so the gate is not left to interpretation.

.DESCRIPTION
    Architect : the feature spec Status must be Approved (or later).
    Developer : the spec Status must be Approved or Implemented, no Must functional requirement may
                be Proposed, and every ADR for the feature must be accepted (rejected, deprecated and
                superseded ADRs are ignored). A feature with no ADRs needs a row in the
                "Features without ADRs" table of pipeline/decisions/adr/_index.md.
    Tester    : same checks as Developer.

    Exit code 0 = gate passes, 1 = gate fails. Reasons are printed. Nothing is modified.

.EXAMPLE
    powershell -NoProfile -File scripts/check-gates.ps1 -Role Developer -Feature 2
#>
param(
    [Parameter(Mandatory)][ValidateSet('Architect', 'Developer', 'Tester')][string]$Role,
    [Parameter(Mandatory)][int]$Feature
)

. "$PSScriptRoot\_adr.ps1"
$root = Get-RepoRoot
$failures = New-Object System.Collections.Generic.List[string]
$passes = New-Object System.Collections.Generic.List[string]

# ---- spec ------------------------------------------------------------------------------------
$spec = Get-ChildItem -Path (Join-Path $root 'pipeline\features') -Filter "feature-$Feature-*.md" -File -ErrorAction SilentlyContinue |
    Select-Object -First 1
if (-not $spec) {
    Write-Output "FAIL: no spec file pipeline/features/feature-$Feature-*.md"
    exit 1
}

$specLines = [System.IO.File]::ReadAllLines($spec.FullName)
$status = $null
foreach ($line in $specLines) {
    if ($line -match '^\|\s*\*\*Status\*\*\s*\|\s*(\w+)') { $status = $Matches[1]; break }
}

$allowed = switch ($Role) {
    'Architect' { @('Approved', 'Implemented', 'Verified') }
    'Developer' { @('Approved', 'Implemented') }
    'Tester'    { @('Approved', 'Implemented') }
}

if (-not $status) {
    $failures.Add("spec $($spec.Name) has no '| **Status** |' row")
} elseif ($status -eq 'Pre') {
    $failures.Add("spec $($spec.Name) is a pre-baked reference that is already built; it is not a build target")
} elseif ($allowed -contains $status) {
    $passes.Add("spec $($spec.Name) Status is $status")
} else {
    $failures.Add("spec $($spec.Name) Status is '$status'; $Role needs one of: $($allowed -join ', ')")
}

# ---- Must requirements still Proposed (Developer, Tester) ---------------------------------------
if ($Role -ne 'Architect') {
    $proposed = @($specLines | Where-Object { $_ -match '^\|\s*FR-\d+\s*\|.*\|\s*Must\s*\|\s*Proposed' })
    if ($proposed.Count -gt 0) {
        $failures.Add("$($proposed.Count) Must functional requirement(s) are still Proposed")
    } else {
        $passes.Add('no Must functional requirement is Proposed')
    }
}

# ---- ADRs (Developer, Tester) -------------------------------------------------------------------
if ($Role -ne 'Architect') {
    $adrs = @(Get-AdrFiles -Root $root | ForEach-Object { Get-AdrInfo -Path $_.FullName } |
        Where-Object { $_ -and $_.Feature -eq "$Feature" })

    if ($adrs.Count -eq 0) {
        $indexPath = Join-Path $root 'pipeline\decisions\adr\_index.md'
        $exempt = $false
        if (Test-Path $indexPath) {
            $exempt = [bool]([System.IO.File]::ReadAllLines($indexPath) | Where-Object { $_ -match "^\|\s*$Feature\s*\|" } | Select-Object -First 1)
        }
        if ($exempt) {
            $passes.Add("feature $Feature has no ADRs, recorded in the index as not needed")
        } else {
            $failures.Add("feature $Feature has no ADRs and no 'Features without ADRs' row in pipeline/decisions/adr/_index.md")
        }
    } else {
        foreach ($adr in $adrs) {
            if ($adr.Status -like 'accepted*') {
                $passes.Add("$($adr.Name) is accepted")
            } elseif ($adr.Status -match '^(rejected|deprecated|superseded)') {
                $passes.Add("$($adr.Name) is $($adr.Status) (ignored)")
            } else {
                $failures.Add("$($adr.Name) status is '$($adr.Status)'; it must be accepted by a human")
            }
        }
    }
}

# ---- report -------------------------------------------------------------------------------------
foreach ($p in $passes) { Write-Output "PASS: $p" }
foreach ($f in $failures) { Write-Output "FAIL: $f" }
if ($failures.Count -gt 0) {
    Write-Output "GATE FAILED for $Role on feature $Feature. Stop and report; do not proceed."
    exit 1
}
Write-Output "GATE PASSED for $Role on feature $Feature."
exit 0
