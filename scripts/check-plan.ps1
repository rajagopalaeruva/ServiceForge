<#
.SYNOPSIS
    Checks a feature's work plan against the coverage rule in pipeline/plans/_template.md.

.DESCRIPTION
    Checks that:
      - every Must functional requirement (FR-n) in the spec appears in the Covers column of some task;
      - every ADR for the feature that is not rejected, deprecated or superseded appears in some task;
      - every task has an Owner and a Done check;
      - every dependency names a task that exists, and the dependencies contain no cycle.

    A range written as "FR-6 to FR-9" in the Covers column counts for every number in the range.
    Exit code 0 = the plan satisfies the rule, 1 = it does not. Nothing is modified.

.EXAMPLE
    powershell -NoProfile -File scripts/check-plan.ps1 -Feature 2
#>
param(
    [Parameter(Mandatory)][int]$Feature
)

. "$PSScriptRoot\_adr.ps1"
$root = Get-RepoRoot
$problems = New-Object System.Collections.Generic.List[string]

$spec = Get-ChildItem -Path (Join-Path $root 'pipeline\features') -Filter "feature-$Feature-*.md" -File -ErrorAction SilentlyContinue |
    Select-Object -First 1
$planPath = Join-Path $root "pipeline\plans\feature-$Feature-plan.md"
if (-not $spec) { Write-Output "FAIL: no spec for feature $Feature"; exit 1 }
if (-not (Test-Path $planPath)) { Write-Output "FAIL: no plan pipeline/plans/feature-$Feature-plan.md"; exit 1 }

# ---- tasks ---------------------------------------------------------------------------------------------
$tasks = New-Object System.Collections.Generic.List[object]
foreach ($line in [System.IO.File]::ReadAllLines($planPath)) {
    if ($line -match '^\|\s*(T-[\w]+)\s*\|') {
        $cells = @($line.Trim().Trim('|').Split('|') | ForEach-Object { $_.Trim() })
        if ($cells.Count -lt 10) { $problems.Add("$($Matches[1]): row has $($cells.Count) columns, expected 10"); continue }
        $tasks.Add([pscustomobject]@{
            Id = $cells[0]; Covers = $cells[2]; Depends = $cells[3]; Owner = $cells[4]; Done = $cells[7]; Status = $cells[9]
        })
    }
}
if ($tasks.Count -eq 0) { $problems.Add('no task rows (T-n) found') }

$active = @($tasks | Where-Object { $_.Status -ne 'Withdrawn' })

# ---- expand "FR-6 to FR-9" and collect covered IDs ----------------------------------------------------------
$covered = New-Object System.Collections.Generic.HashSet[string]
foreach ($t in $active) {
    $text = $t.Covers
    foreach ($m in [regex]::Matches($text, '(FR|NFR|AC|EC)-(\d+)\s+to\s+\1-(\d+)')) {
        $a = [int]$m.Groups[2].Value; $b = [int]$m.Groups[3].Value
        for ($i = $a; $i -le $b; $i++) { [void]$covered.Add("$($m.Groups[1].Value)-$i") }
    }
    foreach ($m in [regex]::Matches($text, '\b(FR|NFR|AC|EC|ADR)-(\d+)')) { [void]$covered.Add("$($m.Groups[1].Value)-$([int]$m.Groups[2].Value)") }
}

# ---- Must FRs from the spec ------------------------------------------------------------------------------------
$mustFr = New-Object System.Collections.Generic.List[string]
foreach ($line in [System.IO.File]::ReadAllLines($spec.FullName)) {
    if ($line -match '^\|\s*(FR-\d+)\s*\|') {
        $cells = @($line.Split('|') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
        if ($cells.Count -ge 2 -and $cells[$cells.Count - 2] -eq 'Must') { $mustFr.Add($Matches[1]) }
    }
}
$missingFr = @($mustFr | Where-Object { -not $covered.Contains($_) })
if ($missingFr.Count -gt 0) { $problems.Add("Must requirement(s) not covered by any task: $($missingFr -join ', ')") }

# ---- ADRs -------------------------------------------------------------------------------------------------------------
$adrs = @(Get-AdrFiles -Root $root | ForEach-Object { Get-AdrInfo -Path $_.FullName } |
    Where-Object { $_ -and $_.Feature -eq "$Feature" -and $_.Status -notmatch '^(rejected|deprecated|superseded)' })
foreach ($adr in $adrs) {
    $id = ($adr.Name -replace '^(ADR-\d+).*$', '$1')
    $num = [int]($id -replace 'ADR-', '')
    if (-not $covered.Contains("ADR-$num")) { $problems.Add("$id is not covered by any task") }
}

# ---- owner, done check, dependencies ------------------------------------------------------------------------------
$ids = @($active | ForEach-Object { $_.Id })
foreach ($t in $active) {
    if ([string]::IsNullOrWhiteSpace($t.Owner)) { $problems.Add("$($t.Id): no owner") }
    if ([string]::IsNullOrWhiteSpace($t.Done)) { $problems.Add("$($t.Id): no done check") }
    if ($t.Depends -and $t.Depends -notmatch '^(—|-|none)?$') {
        foreach ($d in ($t.Depends -split '[,;\s]+' | Where-Object { $_ -match '^T-' })) {
            if ($ids -notcontains $d) { $problems.Add("$($t.Id): depends on unknown task $d") }
            if ($d -eq $t.Id) { $problems.Add("$($t.Id): depends on itself") }
        }
    }
}

# ---- cycle detection (depth-first) ---------------------------------------------------------------------------------
$edges = @{}
foreach ($t in $active) { $edges[$t.Id] = @($t.Depends -split '[,;\s]+' | Where-Object { $_ -match '^T-' -and $ids -contains $_ }) }
$state = @{}
function Visit($node, $trail) {
    if ($state[$node] -eq 1) { $script:problems.Add("dependency cycle: $($trail + $node -join ' -> ')"); return }
    if ($state[$node] -eq 2) { return }
    $state[$node] = 1
    foreach ($next in $edges[$node]) { Visit $next ($trail + $node) }
    $state[$node] = 2
}
foreach ($id in $ids) { Visit $id @() }

# ---- report ------------------------------------------------------------------------------------------------------------
Write-Output "Plan: $(Split-Path -Leaf $planPath). Tasks: $($active.Count). Must FRs in spec: $($mustFr.Count). ADRs: $($adrs.Count)."
if ($problems.Count -gt 0) {
    foreach ($p in ($problems | Select-Object -Unique)) { Write-Output "FAIL: $p" }
    exit 1
}
Write-Output 'PLAN COVERAGE OK.'
exit 0
