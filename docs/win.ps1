# Slidepad helper for Windows.
#   irm https://armaugustas.github.io/slidepad/win.ps1 | iex
# A loopback-only HTTP server the Slidepad web page calls to press slide keys and move the mouse.
# It runs only while this window is open; nothing is installed. Press Ctrl+C to stop.

$ErrorActionPreference = 'Stop'
$SlidepadVersion = '1.0.0'
$SlidepadPort = 7421
$ReferenceWidth = 700.0
$AllowedOrigins = @('https://armaugustas.github.io')

if (-not ('Slidepad.Native' -as [type])) {
  Add-Type -Namespace Slidepad -Name Native -MemberDefinition @'
public struct POINT { public int X; public int Y; }
[DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
'@
}
[void][Slidepad.Native]::SetProcessDPIAware()

# Virtual-key codes. Arrows/Home/End are "extended" keys and need the extended flag.
$SlideKeys = @{ next = 0x27; prev = 0x25; first = 0x24; last = 0x23; blank = 0x42; escape = 0x1B }
$ExtendedKeys = @(0x27, 0x25, 0x24, 0x23)

function Send-SlideKey([int]$vk) {
  $flags = if ($ExtendedKeys -contains $vk) { 1 } else { 0 }
  [Slidepad.Native]::keybd_event([byte]$vk, 0, $flags, [UIntPtr]::Zero)
  [Slidepad.Native]::keybd_event([byte]$vk, 0, ($flags -bor 2), [UIntPtr]::Zero)
}

function Move-SlideMouse([double]$dx, [double]$dy) {
  $scale = [Slidepad.Native]::GetSystemMetrics(0) / $ReferenceWidth   # SM_CXSCREEN
  $p = New-Object Slidepad.Native+POINT
  [void][Slidepad.Native]::GetCursorPos([ref]$p)
  [void][Slidepad.Native]::SetCursorPos([int]($p.X + $dx * $scale), [int]($p.Y + $dy * $scale))
}

function Invoke-SlideClick {
  [Slidepad.Native]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)  # left down
  [Slidepad.Native]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)  # left up
}

function Test-SlideOrigin([string]$origin) {
  if ($AllowedOrigins -contains $origin) { return $true }
  return $origin -match '^http://(localhost|127\.0\.0\.1)(:\d+)?$'
}

function Read-SlideRequest($stream) {
  $buffer = New-Object byte[] 65536
  $total = 0
  $headerEnd = -1
  while ($headerEnd -lt 0) {
    if ($total -ge $buffer.Length) { return $null }
    $n = $stream.Read($buffer, $total, $buffer.Length - $total)
    if ($n -le 0) { return $null }
    $total += $n
    $headerEnd = [Text.Encoding]::ASCII.GetString($buffer, 0, $total).IndexOf("`r`n`r`n")
  }
  $lines = [Text.Encoding]::ASCII.GetString($buffer, 0, $headerEnd) -split "`r`n"
  $parts = $lines[0] -split ' '
  $headers = @{}
  foreach ($line in ($lines | Select-Object -Skip 1)) {
    $i = $line.IndexOf(':')
    if ($i -gt 0) { $headers[$line.Substring(0, $i).Trim().ToLower()] = $line.Substring($i + 1).Trim() }
  }
  $length = 0
  if ($headers.ContainsKey('content-length')) { $length = [Math]::Min([int]$headers['content-length'], 32768) }
  $bodyStart = $headerEnd + 4
  while (($total - $bodyStart) -lt $length) {
    $n = $stream.Read($buffer, $total, $buffer.Length - $total)
    if ($n -le 0) { break }
    $total += $n
  }
  $body = [Text.Encoding]::UTF8.GetString($buffer, $bodyStart, [Math]::Max(0, [Math]::Min($length, $total - $bodyStart)))
  return @{ Method = $parts[0]; Path = $parts[1]; Headers = $headers; Body = $body }
}

function Send-SlideResponse($stream, [string]$status, [string]$origin, [string]$json) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $head = "HTTP/1.1 $status`r`nConnection: close`r`nCache-Control: no-store`r`nVary: Origin`r`n"
  if ($origin) {
    $head += "Access-Control-Allow-Origin: $origin`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`n"
    $head += "Access-Control-Allow-Headers: Content-Type`r`nAccess-Control-Allow-Private-Network: true`r`nAccess-Control-Max-Age: 600`r`n"
  }
  if ($json) { $head += "Content-Type: application/json`r`n" }
  $head += "Content-Length: $($bytes.Length)`r`n`r`n"
  $headBytes = [Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($headBytes, 0, $headBytes.Length)
  if ($bytes.Length) { $stream.Write($bytes, 0, $bytes.Length) }
}

function Invoke-SlideRequest($stream, $req) {
  # Reject DNS-rebinding attempts: the browser must address us by a loopback name.
  $hostHeader = $req.Headers['host']
  if ($hostHeader -ne "127.0.0.1:$SlidepadPort" -and $hostHeader -ne "localhost:$SlidepadPort") {
    return Send-SlideResponse $stream '403 Forbidden' $null ''
  }
  $origin = $req.Headers['origin']
  if ($origin -and -not (Test-SlideOrigin $origin)) { return Send-SlideResponse $stream '403 Forbidden' $null '' }

  if ($req.Method -eq 'OPTIONS') { return Send-SlideResponse $stream '204 No Content' $origin '' }
  if ($req.Method -eq 'GET' -and $req.Path -eq '/status') {
    return Send-SlideResponse $stream '200 OK' $origin "{`"app`":`"slidepad-helper`",`"version`":`"$SlidepadVersion`",`"os`":`"windows`",`"trusted`":true}"
  }
  if ($req.Method -eq 'POST' -and $req.Path -eq '/input') {
    if (-not $origin) { return Send-SlideResponse $stream '403 Forbidden' $null '' }
    try { $commands = ConvertFrom-Json -InputObject $req.Body } catch { return Send-SlideResponse $stream '400 Bad Request' $origin '' }
    $count = 0
    foreach ($c in $commands) {
      if (++$count -gt 64) { break }
      switch ($c.t) {
        'move' {
          $dx = [double]$c.dx; $dy = [double]$c.dy
          if ([Math]::Abs($dx) -lt 4000 -and [Math]::Abs($dy) -lt 4000) { Move-SlideMouse $dx $dy }
        }
        'click' { Invoke-SlideClick }
        'key' { if ($c.k -and $SlideKeys.ContainsKey([string]$c.k)) { Send-SlideKey $SlideKeys[[string]$c.k] } }
      }
    }
    return Send-SlideResponse $stream '204 No Content' $origin ''
  }
  Send-SlideResponse $stream '404 Not Found' $origin ''
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $SlidepadPort)
try { $listener.Start() } catch {
  Write-Host "  Port $SlidepadPort is already in use - is another Slidepad helper running?" -ForegroundColor Red
  return
}

Write-Host ""
Write-Host "  slidepad helper $SlidepadVersion" -ForegroundColor White
Write-Host ""
Write-Host "  Ready - your browser tab will find this automatically." -ForegroundColor Green
Write-Host "  Keep this window open while presenting. Press Ctrl+C to stop."
Write-Host ""

try {
  while ($true) {
    # Poll instead of blocking so Ctrl+C stays responsive.
    while (-not $listener.Pending()) { Start-Sleep -Milliseconds 4 }
    $client = $listener.AcceptTcpClient()
    try {
      $client.NoDelay = $true
      $stream = $client.GetStream()
      $stream.ReadTimeout = 2000
      $req = Read-SlideRequest $stream
      if ($req) { Invoke-SlideRequest $stream $req }
    } catch {
      # A broken request never takes the helper down.
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
  Write-Host "`n  Stopped. Nothing was installed, so there's nothing to clean up.`n"
}
