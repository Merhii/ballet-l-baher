# Windows twin of build.sh, for machines without Python. Same outputs:
#   dist/artifact.html, dist/local.html, dist/standalone/index.html, docs/index.html
# plus ads.json copied into docs/. The CMS stays out of docs/ on purpose.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Read-Text($p) { [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot $p), $utf8) }
function Write-Text($p, $s) {
  $full = Join-Path $PSScriptRoot $p
  $dir = Split-Path $full
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  [System.IO.File]::WriteAllText($full, $s, $utf8)
}

$order = 'ads.js', 'physics.js', 'world.js', 'hud.js', 'game.js'
$mods = foreach ($f in $order) {
  if (-not (Test-Path $f)) { throw "missing module: $f" }
  "/* ==== $f ==== */`n" + (Read-Text $f)
}
$blob = $mods -join "`n"
$art = (Read-Text 'shell.html').Replace('__MODULES__', $blob)
Write-Text 'dist/artifact.html' $art

$reset = '<style>:root{color-scheme:light}body{margin:0;font:14px system-ui,sans-serif;background:#faf9f7}img{max-width:100%}[hidden]{display:none!important}</style>'
$local = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' + $reset + '</head><body>' + $art + '</body></html>'
Write-Text 'dist/local.html' $local

$threeSrc = 'test/vendor/three.min.js'
if (Test-Path $threeSrc) {
  $cdn = '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>'
  $body = $art.Replace($cdn, "<script>/* three.js r128 (MIT) */`n" + (Read-Text $threeSrc) + "`n</script>")
  if ($body.Contains('cdnjs')) { throw 'standalone build still references a CDN' }
  $desc = 'Tile the Mediterranean off the Saida corniche while the sea takes your edges back. A 3D browser game of the Lebanese saying.'
  # where the game lives: link previews need absolute URLs. Change here for a new domain.
  $site = 'https://merhii.github.io/ballet-l-baher/'
  # "Ballet l Ba7er — بلّط البحر", spelled in code points: Windows PowerShell 5.1
  # reads a BOM-less script as ANSI and would garble literal Arabic here
  $ogTitle = 'Ballet l Ba7er ' + [char]0x2014 + ' ' + (-join [char[]](0x0628,0x0644,0x0651,0x0637,0x20,0x0627,0x0644,0x0628,0x062D,0x0631))
  $head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<meta name="description" content="' + $desc + '"><meta name="theme-color" content="#0b3a4f">' +
    '<link rel="canonical" href="' + $site + '">' +
    '<meta property="og:type" content="website"><meta property="og:site_name" content="Ballet l Ba7er">' +
    '<meta property="og:title" content="' + $ogTitle + '"><meta property="og:url" content="' + $site + '">' +
    '<meta property="og:description" content="' + $desc + '">' +
    '<meta property="og:image" content="' + $site + 'og-image.jpg"><meta property="og:image:type" content="image/jpeg">' +
    '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' +
    '<meta property="og:image:alt" content="Blue tiles laid out into the sea off the Saida corniche, with the title Ballet l Ba7er">' +
    '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' + $ogTitle + '">' +
    '<meta name="twitter:description" content="' + $desc + '"><meta name="twitter:image" content="' + $site + 'og-image.jpg">' +
    '<link rel="icon" type="image/svg+xml" href="favicon.svg"><link rel="mask-icon" href="favicon.svg" color="#0b3a4f">' +
    '<link rel="manifest" href="manifest.webmanifest"><link rel="apple-touch-icon" href="apple-touch-icon.png">' +
    '<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes">' +
    '<meta name="apple-mobile-web-app-title" content="Ballet l Ba7er">' +
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">' + $reset
  $page = '<!doctype html><html lang="en"><head>' + $head + '</head><body>' + $body + '</body></html>'
  Write-Text 'dist/standalone/index.html' $page
  Write-Text 'docs/index.html' $page
  Write-Text 'docs/.nojekyll' ''
  foreach ($n in 'favicon.svg', 'logo-trowel.svg', 'manifest.webmanifest', 'sw.js') {
    if (Test-Path "brand/$n") { Write-Text "docs/$n" (Read-Text "brand/$n") }
  }
  # the ad list ships with the game; the CMS (cms.html) deliberately does not:
  # it is the owner's tool, opened locally from the repo
  if (Test-Path 'ads.json') { Write-Text 'docs/ads.json' (Read-Text 'ads.json') }
  # the link-preview image and the app icons (binary: copied, not re-encoded)
  foreach ($n in 'og-image.jpg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png') {
    if (Test-Path "brand/$n") { Copy-Item "brand/$n" "docs/$n" -Force }
  }
  foreach ($n in 'docs/cms.html', 'docs/ads.js') { if (Test-Path $n) { Remove-Item $n } }
  '{0:N1} KB  standalone/index.html + docs/index.html (three.js inlined)' -f ($page.Length / 1024)
} else {
  "standalone skipped: $threeSrc not found"
}
'{0:N1} KB  artifact.html' -f ($art.Length / 1024)
