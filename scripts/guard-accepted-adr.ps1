<#
.SYNOPSIS
    Hook helper: asks for confirmation before a file-writing tool touches an ADR whose status is accepted.

.DESCRIPTION
    Accepted ADRs are immutable history. A change of mind is a new ADR that supersedes the old one, and
    only the old ADR's status line changes. This script reads the hook's JSON from stdin, finds any path
    that points at pipeline/decisions/adr/ADR-NNN-*.md, and, if that ADR is accepted, prints a
    permissionDecision of "ask". Otherwise it prints nothing. It always exits 0 and never blocks by itself.
#>
. "$PSScriptRoot\_adr.ps1"
$root = Get-RepoRoot

$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

# JSON escapes backslashes as \\ ; normalise to forward slashes before matching a path.
$text = ($raw -replace '\\\\', '/') -replace '\\/', '/'
$matched = [regex]::Matches($text, 'pipeline/decisions/adr/(ADR-\d+[^"/\s\\]*\.md)', 'IgnoreCase')

foreach ($m in $matched) {
    $file = Join-Path $root ('pipeline\decisions\adr\' + $m.Groups[1].Value)
    if (-not (Test-Path $file)) { continue }
    $info = Get-AdrInfo -Path $file
    if ($info -and $info.Status -like 'accepted*') {
        $reason = "$($m.Groups[1].Value) is accepted and immutable. Only its status line may change, to deprecated or superseded by a new ADR. Confirm this edit."
        $out = @{ hookSpecificOutput = @{ permissionDecision = 'ask'; permissionDecisionReason = $reason } }
        Write-Output ($out | ConvertTo-Json -Compress -Depth 4)
        exit 0
    }
}
exit 0
