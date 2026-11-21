#!/bin/sh
# Inlines the modules into one self-contained page.
#   dist/artifact.html  — for publishing (no doctype/head/body; the host wraps it)
#   dist/local.html     — the same page wrapped for opening straight off disk
#   dist/standalone/index.html — deployable: three.js inlined
#   docs/index.html            — the same file, served by GitHub Pages
set -e
cd "$(dirname "$0")"
mkdir -p dist
python3 - <<'PY'
import io, os
order = ['ads.js', 'physics.js', 'world.js', 'hud.js', 'game.js']
missing = [f for f in order if not os.path.exists(f)]
if missing:
    raise SystemExit('missing module(s): ' + ', '.join(missing))
mods = []
for f in order:
    src = io.open(f, encoding='utf-8').read()
    mods.append('/* ==== %s ==== */\n%s' % (f, src))
blob = '\n'.join(mods)
shell = io.open('shell.html', encoding='utf-8').read()
art = shell.replace('__MODULES__', blob)
io.open('dist/artifact.html', 'w', encoding='utf-8').write(art)
# Mirror the reset the artifact host injects, so local.html behaves like the
# published page rather than subtly differently.
# Mirror the reset the artifact host injects, so local.html behaves like the
# published page rather than subtly differently.
HEAD_RESET = ('<style>:root{color-scheme:light}body{margin:0;'
              'font:14px system-ui,sans-serif;background:#faf9f7}'
              'img{max-width:100%}[hidden]{display:none!important}</style>')
local = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
         '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
         + HEAD_RESET + '</head><body>' + art + '</body></html>')
io.open('dist/local.html', 'w', encoding='utf-8').write(local)

# ---- dist/standalone/index.html : the deployable build -----------------------
# Three.js is inlined, so the only remaining network request is the Google
# Fonts stylesheet (the HUD declares real fallback stacks, so it degrades).
# Runs from any static host, an itch.io zip, file://, or a USB stick.
THREE_SRC = 'test/vendor/three.min.js'
if os.path.exists(THREE_SRC):
    three = io.open(THREE_SRC, encoding='utf-8').read()
    body = art.replace(
        '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>',
        '<script>/* three.js r128 (MIT) */\n' + three + '\n</script>')
    if 'cdnjs' in body:
        raise SystemExit('standalone build still references a CDN')
    desc = ('Tile the Mediterranean off the Saida corniche while the sea takes '
            'your edges back. A 3D browser game of the Lebanese saying.')
    # where the game lives: link previews need absolute URLs. Change here for a new domain.
    site = 'https://merhii.github.io/ballet-l-baher/'
    og_title = u'Ballet l Ba7er — بلّط البحر'
    head = (
        '<meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<meta name="description" content="' + desc + '">'
        '<meta name="theme-color" content="#0b3a4f">'
        '<link rel="canonical" href="' + site + '">'
        '<meta property="og:type" content="website">'
        '<meta property="og:site_name" content="Ballet l Ba7er">'
        '<meta property="og:title" content="' + og_title + '">'
        '<meta property="og:url" content="' + site + '">'
        '<meta property="og:description" content="' + desc + '">'
        '<meta property="og:image" content="' + site + 'og-image.jpg">'
        '<meta property="og:image:type" content="image/jpeg">'
        '<meta property="og:image:width" content="1200">'
        '<meta property="og:image:height" content="630">'
        '<meta property="og:image:alt" content="Blue tiles laid out into the sea off the Saida corniche, with the title Ballet l Ba7er">'
        '<meta name="twitter:card" content="summary_large_image">'
        '<meta name="twitter:title" content="' + og_title + '">'
        '<meta name="twitter:description" content="' + desc + '">'
        '<meta name="twitter:image" content="' + site + 'og-image.jpg">'
        '<link rel="icon" type="image/svg+xml" href="favicon.svg">'
        '<link rel="mask-icon" href="favicon.svg" color="#0b3a4f">'
        + HEAD_RESET)
    page = ('<!doctype html><html lang="en"><head>' + head + '</head><body>'
            + body + '</body></html>')
    if not os.path.isdir('dist/standalone'):
        os.makedirs('dist/standalone')
    io.open('dist/standalone/index.html', 'w', encoding='utf-8').write(page)
    # docs/ is what GitHub Pages serves, so the deployed page is a build output
    # and can never drift from the source.
    if not os.path.isdir('docs'):
        os.makedirs('docs')
    io.open('docs/index.html', 'w', encoding='utf-8').write(page)
    io.open('docs/.nojekyll', 'w', encoding='utf-8').write('')
    for name in ('favicon.svg', 'logo-trowel.svg'):
        src = os.path.join('brand', name)
        if os.path.exists(src):
            io.open(os.path.join('docs', name), 'w', encoding='utf-8').write(
                io.open(src, encoding='utf-8').read())
    # the ad list ships with the game; the CMS (cms.html) deliberately does not
    # -- it is the owner's tool and is opened locally from the repo
    for name in ('ads.json',):
        if os.path.exists(name):
            io.open(os.path.join('docs', name), 'w', encoding='utf-8').write(
                io.open(name, encoding='utf-8').read())
    # the link-preview image (binary: copied byte for byte)
    if os.path.exists('brand/og-image.jpg'):
        with open('brand/og-image.jpg', 'rb') as src, open('docs/og-image.jpg', 'wb') as dst:
            dst.write(src.read())
    for stale in ('docs/cms.html', 'docs/ads.js'):
        if os.path.exists(stale):
            os.remove(stale)
    print('standalone/index.html + docs/index.html %.1f KB'
          ' (three.js inlined; fonts still from Google)' % (len(page) / 1024.0))
else:
    print('standalone skipped: %s not found' % THREE_SRC)

print('artifact.html %.1f KB' % (len(art) / 1024.0))
PY
