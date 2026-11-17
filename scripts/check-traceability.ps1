<#
.SYNOPSIS
    Lists acceptance criteria (AC-n) and edge cases (EC-n) in a feature spec that have no test tagged
    with their ID.

.DESCRIPTION
    A test covers an ID when its name or a nearby string contains F<feature>_AC_<n> or F<feature>_EC_<n>
    (a hyphen instead of an underscore is also accepted), for example F2_AC_6_insufficientStockIsAtomic.
    The feature prefix stops IDs from different features, or from bug records (BUG003_AC1), from being
    confused with each other.

    Searched: *.java under backend/src/test and *.spec.ts under frontend/src.
    Must acceptance criteria and all edge cases are required. Should and Could are reported as warnings
    (failures with -Strict). Specs with no AC or EC rows (legacy, e.g. Feature 1) are skipped.

    Exit code 0 = nothing required is missing, 1 = something required has no test. Nothing is modified.

.EXAMPLE
    powershell -NoProfile -File scripts/check-traceability.ps1 -Feature 2
#>
param(
    [Parameter(Mandatory)][int]$Feature,
    [switch]$Strict
)

. "$PSScriptRoot\_adr.ps1"
$root = Get-RepoRoot

$spec = Get-ChildItem -Path (Join-Path $root 'pipeline\features') -Filter "feature-$Feature-*.md" -File -ErrorAction SilentlyContinue |
    Select-Object -First 1
if (-not $spec) {
    Write-Output "FAIL: no spec file pipeline/features/feature-$Feature-*.md"
    exit 1
}

# ---- IDs from the spec ------------------------------------------------------------------------------
$items = New-Object System.Collections.Generic.List[object]
foreach ($line in [System.IO.File]::ReadAllLines($spec.FullName)) {
    if ($line -match '^\|\s*(AC|EC)-(\d+)\s*\|') {
        $kind = $Matches[1]
        $num = [int]$Matches[2]
        $cells = @($line.Split('|') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
        $priority = 'Must'
        if ($kind -eq 'AC') { $priority = $cells[$cells.Count - 1] }
        $items.Add([pscustomobject]@{ Kind = $kind; Number = $num; Id = "$kind-$num"; Priority = $priority })
    }
}

if ($items.Count -eq 0) {
    Write-Output "SKIP: $($spec.Name) has no AC-n or EC-n rows (legacy format). Use its Definition of Done instead."
    exit 0
}

# ---- test text ----------------------------------------------------------------------------------------
$testFiles = @()
$backendTests = Join-Path $root 'backend\src\test'
$frontendSrc = Join-Path $root 'frontend\src'
if (Test-Path $backendTests) { $testFiles += Get-ChildItem -Path $backendTests -Recurse -Filter '*.java' -File }
if (Test-Path $frontendSrc) { $testFiles += Get-ChildItem -Path $frontendSrc -Recurse -Filter '*.spec.ts' -File }
$testText = ($testFiles | ForEach-Object { [System.IO.File]::ReadAllText($_.FullName) }) -join "`n"

# ---- report ----------------------------------------------------------------------------------------------
$missingRequired = New-Object System.Collections.Generic.List[string]
$missingOptional = New-Object System.Collections.Generic.List[string]
$covered = 0

foreach ($item in $items) {
    $pattern = "F$Feature[_-]$($item.Kind)[_-]$($item.Number)(?!\d)"
    if ($testText -match $pattern) {
        $covered++
    } elseif ($item.Priority -eq 'Must') {
        $missingRequired.Add($item.Id)
    } else {
        $missingOptional.Add("$($item.Id) ($($item.Priority))")
    }
}

Write-Output "Spec: $($spec.Name). IDs: $($items.Count). With a tagged test: $covered. Test files scanned: $($testFiles.Count)."
if ($missingRequired.Count -gt 0) { Write-Output "FAIL: no tagged test for required: $($missingRequired -join ', ')" }
if ($missingOptional.Count -gt 0) { Write-Output "WARN: no tagged test for optional: $($missingOptional -join ', ')" }

if ($missingRequired.Count -gt 0 -or ($Strict -and $missingOptional.Count -gt 0)) { exit 1 }
Write-Output 'TRACEABILITY OK.'
exit 0
