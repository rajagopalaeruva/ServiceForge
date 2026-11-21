<#
.SYNOPSIS
  Scans the commits that a git push would send for secrets and sensitive details.

.DESCRIPTION
  The remote is public, so everything in the outgoing commits is exposed, including lines
  that a later commit removed. The script scans the added lines of every outgoing commit
  and the names of every file those commits add or change.

  BLOCK findings (secrets, private keys, credential files) exit 1.
  WARN findings (local paths, personal emails, private IPs) exit 0 unless -Strict is set.
  Secret values are never printed in full: at most 4 leading characters, then ****.
  Add "pushscan:allow" to a line to suppress findings on that line (use sparingly).
  List path globs in .pushscan-allow (repo root) to ignore findings in those files.

.PARAMETER Range
  Revision range to scan, for example "origin/main..HEAD". Default: the upstream of the
  current branch, or every commit not yet on any remote if there is no upstream.

.PARAMETER Strict
  Treat WARN findings as BLOCK.

.EXAMPLE
  powershell -NoProfile -File scripts/check-push.ps1
  powershell -NoProfile -File scripts/check-push.ps1 -Range "origin/main..HEAD" -Strict
#>
param(
  [string]$Range = "",
  [switch]$Strict
)

# Continue (not Stop): Windows PowerShell 5.1 turns native stderr output into errors under Stop.
$ErrorActionPreference = "Continue"

function Mask([string]$v) {
  if ([string]::IsNullOrEmpty($v)) { return "" }
  if ($v.Length -le 4) { return "****" }
  return $v.Substring(0, 4) + "****"
}

# --- Resolve the range -------------------------------------------------------
$revArgs = @()
if ($Range) {
  $revArgs = @($Range -split '\s+' | Where-Object { $_ })
} else {
  $upstream = (& git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>$null)
  if ($LASTEXITCODE -eq 0 -and $upstream) {
    $revArgs = @("$upstream..HEAD")
  } else {
    $revArgs = @("HEAD", "--not", "--remotes")
  }
}
$commits = @(& git rev-list @revArgs 2>$null)
if ($LASTEXITCODE -ne 0) { Write-Host "check-push: could not resolve range '$($revArgs -join ' ')'"; exit 2 }
if ($commits.Count -eq 0) { Write-Host "check-push: PASS (no outgoing commits in '$($revArgs -join ' ')')"; exit 0 }

# --- Rules -------------------------------------------------------------------
# Content rules: Name, Severity, Regex (applied to added lines).
$placeholder = '(?i)(changeme|change_me|example|placeholder|your[_-]?|<[^>]+>|xxxx|\*\*\*\*|dummy|sample|test(ing)?[_-]?(key|token|secret|password)?$|\$\{|%[A-Z_]+%|process\.env|System\.getenv)'
$contentRules = @(
  @{ Name = "Private key block";        Sev = "BLOCK"; Rx = '-----BEGIN ((RSA|EC|DSA|OPENSSH|PGP|ENCRYPTED) )?PRIVATE KEY' },
  @{ Name = "AWS access key id";        Sev = "BLOCK"; Rx = '\b(AKIA|ASIA)[0-9A-Z]{16}\b' },
  @{ Name = "GitHub token";             Sev = "BLOCK"; Rx = '\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b' },
  @{ Name = "Slack token";              Sev = "BLOCK"; Rx = '\bxox[abprs]-[A-Za-z0-9-]{10,}' },
  @{ Name = "Google API key";           Sev = "BLOCK"; Rx = '\bAIza[0-9A-Za-z_\-]{35}\b' },
  @{ Name = "Stripe live key";          Sev = "BLOCK"; Rx = '\b(sk|rk)_live_[0-9A-Za-z]{16,}\b' },
  @{ Name = "JSON Web Token";           Sev = "BLOCK"; Rx = '\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}' },
  @{ Name = "URL with embedded credentials"; Sev = "BLOCK"; Rx = '\b[a-zA-Z][a-zA-Z0-9+.\-]*://[^/\s:@"'']+:[^/\s:@"'']{3,}@[^/\s"'']+'; Group = 0 },
  @{ Name = "Hard-coded credential";    Sev = "BLOCK"; Rx = '(?i)\b[\w.\-]*(password|passwd|pwd|secret|api[_-]?key|access[_-]?key|auth[_-]?token|client[_-]?secret|private[_-]?key)\b["'']?\s*[:=]\s*["'']?([^\s"'',;]{8,})'; Group = 2; CheckPlaceholder = $true },
  @{ Name = "Local user path";          Sev = "WARN";  Rx = '(?i)\b[A-Z]:\\Users\\[A-Za-z0-9._-]+|/Users/[A-Za-z0-9._-]+/|/home/[A-Za-z0-9._-]+/' },
  @{ Name = "Email address";            Sev = "WARN";  Rx = '\b[A-Za-z0-9._%+-]+@(?!example\.(com|org)\b|users\.noreply\.github\.com\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b' },
  @{ Name = "Private IP address";       Sev = "WARN";  Rx = '\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b' }
)

# File-name rules: files that should not be pushed at all.
$fileRules = @(
  @{ Name = "Environment file";            Rx = '(^|/)\.env(\.[^/]+)?$'; Allow = '\.(example|sample|template)$' },
  @{ Name = "Key or certificate file";     Rx = '\.(pem|key|pfx|p12|jks|keystore|ppk)$' },
  @{ Name = "SSH private key";             Rx = '(^|/)id_(rsa|dsa|ecdsa|ed25519)$' },
  @{ Name = "Credentials file";            Rx = '(^|/)(credentials|secrets?)\.(json|ya?ml|properties|xml|txt)$|(^|/)\.(npmrc|pypirc|netrc)$' },
  @{ Name = "Terraform state";             Rx = '\.tfstate(\.backup)?$' },
  @{ Name = "Personal steering (git-ignored by design)"; Rx = '(^|/)\.kiro/steering/' }
)

# --- Scan --------------------------------------------------------------------
$findings = New-Object System.Collections.Generic.List[object]

# Path allowlist: .pushscan-allow at the repo root, one glob per line (# comments allowed).
# Findings in matching paths are ignored. Use for deliberate fake secrets in tests and docs.
$allowGlobs = @()
$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if ($repoRoot -and (Test-Path (Join-Path $repoRoot ".pushscan-allow"))) {
  $allowGlobs = @(Get-Content (Join-Path $repoRoot ".pushscan-allow") |
    ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith("#") } |
    ForEach-Object { $_ -replace '\*\*', '*' })
}
function Test-Allowed([string]$path) {
  foreach ($g in $allowGlobs) { if ($path -like $g) { return $true } }
  return $false
}

function Add-Finding($sev, $rule, $commit, $file, $line, $detail) {
  if (Test-Allowed $file) { return }
  $findings.Add([pscustomobject]@{ Severity = $sev; Rule = $rule; Commit = $commit.Substring(0, 8); File = $file; Line = $line; Detail = $detail })
}

# Added or changed file names, per commit.
foreach ($c in $commits) {
  $names = @(& git diff-tree --no-commit-id --name-only --diff-filter=AMR -r --root $c)
  foreach ($n in $names) {
    foreach ($fr in $fileRules) {
      if ($n -match $fr.Rx -and -not ($fr.Allow -and $n -match $fr.Allow)) {
        Add-Finding "BLOCK" $fr.Name $c $n 0 "file name matches a sensitive pattern"
      }
    }
  }
}

# Added lines, per commit, with line numbers.
$log = & git -c core.quotepath=off log -p -U0 --no-color --no-ext-diff --diff-filter=AMR --format="@@commit:%H" @revArgs
$commit = ""; $file = ""; $lineNo = 0
foreach ($raw in $log) {
  if ($raw -like "@@commit:*") { $commit = $raw.Substring(9); continue }
  if ($raw -like "+++ b/*")    { $file = $raw.Substring(6); continue }
  if ($raw -like "+++ *")      { $file = ""; continue }
  if ($raw -like "--- *")      { continue }
  if ($raw -match '^@@ -\d+(,\d+)? \+(\d+)(,\d+)? @@') { $lineNo = [int]$Matches[2]; continue }
  if ($raw.StartsWith("+")) {
    $text = $raw.Substring(1)
    $cur = $lineNo; $lineNo++
    if ($text -match 'pushscan:allow') { continue }
    if ($text.Length -gt 4000) { $text = $text.Substring(0, 4000) }
    foreach ($r in $contentRules) {
      $m = [regex]::Match($text, $r.Rx)
      if (-not $m.Success) { continue }
      $val = if ($r.ContainsKey("Group")) { $m.Groups[$r.Group].Value } else { $m.Value }
      if ($r.ContainsKey("CheckPlaceholder") -and $val -match $placeholder) { continue }
      Add-Finding $r.Sev $r.Name $commit $file $cur ("value starts: " + (Mask $val))
    }
  }
}

# --- Report ------------------------------------------------------------------
$blocks = @($findings | Where-Object { $_.Severity -eq "BLOCK" })
$warns  = @($findings | Where-Object { $_.Severity -eq "WARN" })

Write-Host ("check-push: scanned {0} commit(s) in '{1}'" -f $commits.Count, ($revArgs -join " "))
if ($findings.Count -gt 0) {
  $findings | Sort-Object Severity, Commit, File, Line | Format-Table Severity, Rule, Commit, File, Line, Detail -AutoSize | Out-String -Width 240 | Write-Host
}
Write-Host ("BLOCK: {0}   WARN: {1}   Strict: {2}" -f $blocks.Count, $warns.Count, [bool]$Strict)

if ($blocks.Count -gt 0 -or ($Strict -and $warns.Count -gt 0)) {
  Write-Host "check-push: BLOCK. Do not push."
  Write-Host "If a secret was found: rotate it first, then ask the owner before cleaning history."
  exit 1
}
Write-Host "check-push: PASS"
exit 0
