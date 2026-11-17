<#
.SYNOPSIS
    Reports where a feature is in the pipeline, who must act next, and whether the next gate passes.
    Read-only: it never changes a file.

.DESCRIPTION
    Works out the current phase from the status fields of the artifacts, not from memory, so a new
    session can pick up exactly where the last one stopped.

    Phases (see pipeline/phases.md, draft):
      1 Requirements   2 ADR   3 Design review / ADR acceptance   4 Work plan   5 Build   6 Test   7 Review and merge

    The work plan (phase 4) is required for every feature that is built. Feature 1 is a pre-baked
    reference and has none.

    Exit code 0 = status printed. Exit code 2 = bad input (for example, unknown feature).

.EXAMPLE
    powershell -NoProfile -File scripts/pipeline-status.ps1 -Feature 2
#>
param(
    [Parameter(Mandatory)][int]$Feature
)

. "$PSScriptRoot\_adr.ps1"
$root = Get-RepoRoot

function Get-StatusWord {
    param([string[]]$Lines)
    foreach ($line in $Lines) {
        if ($line -match '^\|\s*\*\*Status\*\*\s*\|\s*(In Review|In Progress|\w+)') { return $Matches[1] }
    }
    return $null
}

function Write-Report {
    param($Phase, $Owner, $Human, $Next, $Gate)
    Write-Output "Feature $Feature : $script:slug"
    Write-Output "Spec status   : $script:specStatus"
    Write-Output "Current phase : $Phase"
    Write-Output "Owner         : $Owner"
    Write-Output "Waiting on    : $Human"
    if ($Gate) { Write-Output "Gate          : $Gate" }
    Write-Output "Next action   : $Next"
}

# ---- spec -----------------------------------------------------------------------------------------
$spec = Get-ChildItem -Path (Join-Path $root 'pipeline\features') -Filter "feature-$Feature-*.md" -File -ErrorAction SilentlyContinue |
    Select-Object -First 1
if (-not $spec) {
    Write-Output "No spec file pipeline/features/feature-$Feature-*.md. Phase 1 (Requirements) has not started."
    Write-Output "Next action   : BA agent writes the spec from the intent."
    exit 2
}
$script:slug = ($spec.BaseName -replace "^feature-$Feature-", '')
$script:specStatus = Get-StatusWord -Lines ([System.IO.File]::ReadAllLines($spec.FullName))

function Invoke-Gate {
    param([string]$Role)
    $out = & "$PSScriptRoot\check-gates.ps1" -Role $Role -Feature $Feature
    $code = $LASTEXITCODE
    $result = if ($code -eq 0) { 'PASS' } else { 'FAIL' }
    $reasons = @($out | Where-Object { $_ -like 'FAIL:*' } | ForEach-Object { $_.Substring(6) })
    if ($reasons.Count -gt 0) { return "$result ($($reasons -join '; '))" }
    return $result
}

# ---- ADRs -----------------------------------------------------------------------------------------
$adrs = @(Get-AdrFiles -Root $root | ForEach-Object { Get-AdrInfo -Path $_.FullName } |
    Where-Object { $_ -and $_.Feature -eq "$Feature" })
$proposed = @($adrs | Where-Object { $_.Status -eq 'proposed' })
$indexPath = Join-Path $root 'pipeline\decisions\adr\_index.md'
$noAdrNeeded = $false
if (Test-Path $indexPath) {
    $noAdrNeeded = [bool]([System.IO.File]::ReadAllLines($indexPath) | Where-Object { $_ -match "^\|\s*$Feature\s*\|" } | Select-Object -First 1)
}

# ---- plan (optional) ------------------------------------------------------------------------------
$plan = Get-ChildItem -Path (Join-Path $root 'pipeline\plans') -Filter "feature-$Feature-plan.md" -File -ErrorAction SilentlyContinue |
    Select-Object -First 1
$planStatus = $null
if ($plan) { $planStatus = Get-StatusWord -Lines ([System.IO.File]::ReadAllLines($plan.FullName)) }

# ---- decide the phase -----------------------------------------------------------------------------
switch ($script:specStatus) {
    'Pre' {
        Write-Report 'None (pre-baked reference, already built)' '-' 'nobody' 'Nothing to build. Use it as a reference.' $null
        exit 0
    }
    'Draft' {
        Write-Report '1 Requirements' 'BA agent' 'nobody' 'BA finishes the spec and sets In Review.' $null
        exit 0
    }
    'In Review' {
        Write-Report '1 Requirements (review)' 'Reviewer agent, then human' 'HUMAN: resolve annotations, complete the sign-off table, set Approved' 'Human approves the scope and acceptance criteria.' $null
        exit 0
    }
    'Approved' {
        if ($adrs.Count -eq 0 -and -not $noAdrNeeded) {
            Write-Report '2 ADR' 'Architect agent' 'nobody' 'Architect writes ADRs (or records the feature as needing none).' (Invoke-Gate 'Architect')
            exit 0
        }
        if ($proposed.Count -gt 0) {
            $names = ($proposed | ForEach-Object { $_.Name -replace '^(ADR-\d+).*$', '$1' }) -join ', '
            Write-Report '3 Design review / ADR acceptance' 'Reviewer agent, then human' "HUMAN: accept, change or reject $names" 'Resolve review questions, then the human accepts the ADRs.' $null
            exit 0
        }
        if (-not $plan) {
            Write-Report '4 Work plan' 'Architect agent (planner duty)' 'nobody' 'Write pipeline/plans/feature-N-plan.md from the template, then run check-plan.ps1.' (Invoke-Gate 'Planner')
            exit 0
        }
        if ($planStatus -eq 'Draft') {
            Write-Report '4 Work plan' 'Architect agent (planner duty)' 'nobody' 'Finish the plan, run check-plan.ps1, set In Review.' $null
            exit 0
        }
        if ($planStatus -eq 'In Review') {
            Write-Report '4 Work plan (review)' 'Reviewer agent, then human' 'HUMAN: approve the plan' 'Resolve review items, then the human approves the plan.' $null
            exit 0
        }
        Write-Report "5 Build (plan $planStatus)" 'Developer agent' 'nobody' 'Developer starts with a context-gatherer, then builds the next ready task.' (Invoke-Gate 'Developer')
        exit 0
    }
    'Implemented' {
        Write-Report '6 Test' 'Tester agent' 'nobody' 'Tester writes tests from the spec, runs them, then runs check-traceability.ps1.' (Invoke-Gate 'Tester')
        exit 0
    }
    'Verified' {
        Write-Report '7 Review and merge' 'Developer prepares summary' 'HUMAN: approve merge' 'Open the change summary for human approval.' $null
        exit 0
    }
    default {
        Write-Output "Unrecognised spec status '$script:specStatus' in $($spec.Name). Stop and report."
        exit 2
    }
}
