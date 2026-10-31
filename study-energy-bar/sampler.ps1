# sampler.ps1 - study-time sampler (standalone process, does NOT depend on DSH runtime).
#
# What it does: every IntervalSec seconds it looks at (a) which process owns the
# foreground window and (b) how long the machine has been idle. Time is added to a
# per-local-date ledger ONLY when the foreground process is DSH or VS Code AND the
# idle time is below IdleLimitSec.
#
# It only accumulates; it does not compute statistics. "today / this week / last week"
# are derived from `days` by the host half (index.js). The JSON file is the single
# source of truth and can be read by anything.
#
# Run it by hand (bypassing DSH):
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File sampler.ps1 `
#       -IntervalSec 2 -IdleLimitSec 99999 -MaxSec 20 -OutFile .\test-study.json -Verbose2
# NOTE: this machine's execution policy is Restricted, so -ExecutionPolicy Bypass is
# mandatory, otherwise the script file cannot even be loaded.
#
# NOTE: keep this file pure ASCII. Windows PowerShell 5.1 reads .ps1 files using the
# ANSI code page (GBK here) unless the file has a UTF-8 BOM, so non-ASCII comments
# would be mis-decoded and can break parsing. Verified: same file, GBK -> 1 parse
# error at line 44, UTF-8 -> 0 errors.
#
# Exit conditions (any of them):
#   1) the parent process (DSH) is gone -> exit, never leave an orphan behind
#   2) -MaxSec reached (>0 means test mode)
#   3) killed
param(
  [int]$ParentPid = 0,
  [int]$IntervalSec = 5,
  [int]$IdleLimitSec = 300,
  [string]$OutFile = (Join-Path $env:USERPROFILE '.dsh\study-time\study.json'),
  [string]$DshProc = 'DeepSeek Harness',
  [string]$CodeProc = 'Code',
  [string]$BrowserProcs = 'msedge,chrome,firefox,msedgewebview2,brave,opera',
  [int]$MaxSec = 0,
  [switch]$Verbose2,
  [switch]$AllowMultiple
)

$ErrorActionPreference = 'Continue'
$lockFile = "$OutFile.lock"

function Get-LiveSamplerPid {
  # Returns the pid of another sampler that is really running, or 0.
  # A lock file alone is not trusted: the pid must still be alive AND its command
  # line must mention sampler.ps1 (guards against pid reuse).
  try {
    if (-not (Test-Path -LiteralPath $lockFile)) { return 0 }
    $raw = [System.IO.File]::ReadAllText($lockFile)
    if ([string]::IsNullOrWhiteSpace($raw)) { return 0 }
    $info = $raw | ConvertFrom-Json
    $other = [int]$info.pid
    if ($other -le 0) { return 0 }
    if ($other -eq $PID) { return 0 }
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$other" -ErrorAction Stop
    if ($null -eq $p) { return 0 }
    if ($p.CommandLine -and ($p.CommandLine -match 'sampler\.ps1')) { return $other }
    return 0
  } catch { return 0 }
}

# Single-instance guard: DSH may open several windows and HMR reloads can start the
# sampler again; two samplers would double-count every second.
if (-not $AllowMultiple) {
  $live = Get-LiveSamplerPid
  if ($live -gt 0) { exit 0 }
}

$dir = Split-Path -Parent $OutFile
if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$lockBody = @{ pid = $PID; startedAt = (Get-Date).ToString('o'); outFile = $OutFile } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText($lockFile, $lockBody, (New-Object System.Text.UTF8Encoding($false)))

try {

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class StudyFg {
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  public static uint IdleMs() {
    LASTINPUTINFO l = new LASTINPUTINFO();
    l.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
    if (!GetLastInputInfo(ref l)) return 0;
    return (uint)Environment.TickCount - l.dwTime;
  }
  public static string Title() { StringBuilder sb = new StringBuilder(512); GetWindowText(GetForegroundWindow(), sb, 512); return sb.ToString(); }
  public static int FgPid() { int pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return pid; }
}
'@

$browserSet = @{}
foreach ($b in $BrowserProcs.Split(',')) { $browserSet[$b.Trim()] = $true }

function Get-ForegroundSample {
  try {
    $procId = [StudyFg]::FgPid()
    $title  = [StudyFg]::Title()
    $proc   = ''
    if ($procId -gt 0) {
      try { $proc = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { $proc = '' }
    }
    $idle = [math]::Round([StudyFg]::IdleMs() / 1000.0, 1)
    $cat = $null
    if ($proc -eq $DshProc) { $cat = 'dsh' }
    elseif ($proc -eq $CodeProc) { $cat = 'vscode' }
    elseif ($proc -ne '' -and $browserSet.ContainsKey($proc) -and $title -match 'DeepSeek Harness') { $cat = 'dsh' }
    return [pscustomobject]@{ cat = $cat; proc = $proc; title = $title; idle = $idle }
  } catch {
    return [pscustomobject]@{ cat = $null; proc = ''; title = "sample-error: $($_.Exception.Message)"; idle = 0 }
  }
}

function Read-State {
  if (Test-Path -LiteralPath $OutFile) {
    try {
      $raw = [System.IO.File]::ReadAllText($OutFile)
      if ($raw.Trim().Length -gt 0) { return ($raw | ConvertFrom-Json) }
    } catch { }
  }
  return [pscustomobject]@{ schema = 1; days = [pscustomobject]@{}; created = (Get-Date).ToString('o') }
}

function Write-State($state) {
  $tmp = "$OutFile.tmp"
  # UTF-8 without BOM on purpose: a BOM makes Node's JSON.parse throw.
  $json = $state | ConvertTo-Json -Depth 6 -Compress
  [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $OutFile -Force
}

# ---- load the ledger ----
$state = Read-State
$days = @{}
if ($state.days) {
  foreach ($p in $state.days.PSObject.Properties) {
    $days[$p.Name] = @{ dsh = [double]$p.Value.dsh; vscode = [double]$p.Value.vscode }
  }
}
$startedAt = (Get-Date)
$rootPid = if ($ParentPid -gt 0) { $ParentPid } else { 0 }

$sw = [System.Diagnostics.Stopwatch]::StartNew()

while ($true) {
  Start-Sleep -Seconds $IntervalSec
  $elapsed = $sw.Elapsed.TotalSeconds
  $sw.Restart()

  # After sleep / hibernate do not back-fill a huge block of time.
  if ($elapsed -gt ($IntervalSec * 3)) { $elapsed = [double]$IntervalSec }

  $s = Get-ForegroundSample
  $counted = $false
  if ($null -ne $s.cat -and $s.idle -lt $IdleLimitSec) {
    $day = (Get-Date).ToString('yyyy-MM-dd')
    if (-not $days.ContainsKey($day)) { $days[$day] = @{ dsh = 0.0; vscode = 0.0 } }
    $days[$day][$s.cat] = [math]::Round($days[$day][$s.cat] + $elapsed, 1)
    $counted = $true
  }

  $out = [ordered]@{
    schema       = 1
    updated      = (Get-Date).ToString('o')
    startedAt    = $startedAt.ToString('o')
    samplerPid   = $PID
    intervalSec  = $IntervalSec
    idleLimitSec = $IdleLimitSec
    tracked      = @($DshProc, $CodeProc)
    last         = [ordered]@{ cat = $s.cat; proc = $s.proc; title = $s.title; idleSec = $s.idle; counted = $counted; deltaSec = [math]::Round($elapsed, 1) }
    days         = [ordered]@{}
  }
  foreach ($k in ($days.Keys | Sort-Object)) { $out.days[$k] = [ordered]@{ dsh = $days[$k].dsh; vscode = $days[$k].vscode } }

  Write-State ([pscustomobject]$out)
  if ($Verbose2) { Write-Host ("[{0}] cat={1} proc={2} idle={3}s counted={4} +{5}s" -f (Get-Date -Format 'HH:mm:ss'), $s.cat, $s.proc, $s.idle, $counted, [math]::Round($elapsed, 1)) }

  if ($rootPid -gt 0) {
    if (-not (Get-Process -Id $rootPid -ErrorAction SilentlyContinue)) { break }
  }
  if ($MaxSec -gt 0 -and ((Get-Date) - $startedAt).TotalSeconds -ge $MaxSec) { break }
}

} finally {
  # Remove the lock only if it is ours; never delete a successor's lock.
  try {
    if (Test-Path -LiteralPath $lockFile) {
      $l = [System.IO.File]::ReadAllText($lockFile) | ConvertFrom-Json
      if ([int]$l.pid -eq $PID) { Remove-Item -LiteralPath $lockFile -Force }
    }
  } catch { }
}
