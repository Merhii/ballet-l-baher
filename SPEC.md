# BALLET L BA7ER — shared build spec (AUTHORITATIVE)

A 3D browser game. Lebanese saying "بلّط البحر" / "ballet l ba7er" = "go tile the sea",
said to dismiss someone: go do something gloriously pointless. The game is that task,
taken literally and lovingly. You are a mason on the Lebanese coast laying ceramic
tiles out over the Mediterranean. The sea eats your edges. You keep going.

Scenery is REAL Lebanese coast: Saida (Sidon) corniche with the Crusader Sea Castle
(Qalaat al-Bahr) on its stone causeway, the harbour mole with its beacon, and
Jazirat Ziri lying low offshore. Mount Lebanon behind. The game is Saida and
only Saida — no Beirut landmarks. Cartoonish low-poly, flat-shaded,
chunky — Minecraft *feel* (blocky, placeable, tactile) without voxel terrain.

## Non-negotiable technical constraints

- THREE.js **r128**, loaded as a UMD global `THREE` from cdnjs. ONLY APIs that exist in
  r128. No ES module imports, no `import`, no OrbitControls/examples/addons (not loaded).
  No `THREE.Color.setStyle` with css vars. `renderer.outputEncoding = THREE.sRGBEncoding`
  is fine. `InstancedMesh`, `Fog`, `PlaneGeometry(w,h,segW,segH)`, `MeshLambertMaterial`,
  `MeshBasicMaterial`, `BufferGeometry`, `Points`, `ShaderMaterial`, `Group`, `MathUtils`,
  `DirectionalLight`, `HemisphereLight`, `AmbientLight` all exist in r128 — use them.
- **No external assets whatsoever.** No image URLs, no textures from the network, no
  fonts in the 3D scene, no model files. Every texture must be generated procedurally
  with an offscreen `<canvas>` → `new THREE.CanvasTexture(canvas)`. Every mesh built from
  built-in geometries or hand-built BufferGeometry.
- Each module is a **plain script** (no modules) that attaches ONE global, e.g.
  `window.BLB_WORLD = { createWorld }`. No top-level side effects beyond that assignment.
  Assume `THREE` already exists. Pass nothing else implicitly.
- Must run at 60fps on an integrated-GPU laptop. Budget: keep total scene under ~900 draw
  calls; use `InstancedMesh` or merged geometry for anything repeated (railing balusters,
  palm fronds, tiles, crowd). Reuse materials — do NOT create a material per mesh.
- Code style: ES2017 plain JS, 2-space indent, `const`/`let`, no TypeScript, no build step.
  Comment the non-obvious. Verify your file parses with `node --check <file>` before
  finishing. Do not `npm install` anything.
- Never call `alert`, `confirm` or `prompt`.

## World coordinate system (ALL modules must obey exactly)

- Y is up. Units are meters. Sea surface rest height **y = 0**.
- **+Z points out to open sea. −Z is inland.** The shoreline runs along the X axis.
- Corniche promenade deck: flat walkable surface at **y = 1.5**, spanning
  x ∈ [−130, 130], z ∈ [−34, −2]. Its seaward face is a vertical stone wall at z = −2
  dropping from y = 1.5 to y = −1.2.
- **The Ramp**: the only way down to sea level. A walkable incline at x ∈ [−5, 5],
  going from (z = −2, y = 1.5) down to (z = 6, y = 0.3). Treat as a plane; the player
  walks on it. Nothing may be built on x ∈ [−5,5], z ∈ [−2, 6].
- **Tile grid**: cell size **2.0**. Cell (i, j) with integer i ∈ [−64, 64], j ∈ [0, 400].
  Cell centre = `(i * 2, 0.3, 4 + j * 2)`. So j = 0 is the first row of sea, 4m out.
  A placed tile is a 1.94 × 0.3 × 1.94 slab whose **top surface is y = 0.30**.
  "Supported" means j === 0 OR an orthogonal neighbour tile exists.
- Inland is decorative only (player cannot leave the deck; z < −34 is backdrop).
- Jazirat Ziri: low flat limestone island centred near **(74, 0, 98)**, cap ~5.7 m —
  a line on the horizon, never a sea stack.
- Harbour mole: tumbled blocks curving from about (−76, 0, 32) out to (−32, 0, 59),
  top ~2.5 m, with a small banded beacon tower (~8.5 m) at its head whose lamp is
  registered in `nightLights`.
- Saida Sea Castle: centred near **(−86, 0, 30)** on a rock islet, joined to the deck by
  a stone causeway/bridge running roughly from (−86, 2.2, 10) to (−70, 1.5, −2).
  Nothing in the tile grid region may be blocked by it: the causeway deck sits at
  y ≈ 2.4, i.e. ABOVE tile level, and its piers occupy only i ∈ [−48, −33].
- Sand/aggregate piles (resource nodes) sit ON the deck at y = 1.5.

## Shared palette (authoritative — 3D materials AND HUD use these, no other hues)

```
SEA_DEEP    #0B3A4F   SEA_MID     #16708C   SEA_SHALLOW #3FA8B4
FOAM        #EDF6F3   SKY_TOP     #6FC3DE   SKY_HAZE    #D9EEF2
LIMESTONE   #E4D7B3   STONE_DARK  #A08F6A   STONE_WET   #7D6E4F
TERRACOTTA  #B9502F   CEMENT      #9AA0A0   RUST        #8C4A2F
PALM_GREEN  #3F6B3A   PALM_LIGHT  #5E8C3F   TRUNK       #7A6245
SUN         #F6C445   HAZARD      #F2B733   NIGHT_TOP   #0A1A33
SKIN        #C98A5E   SHIRT       #E8E2D4   DENIM       #3B5C73
```
Tile tier colours: `ramleh #CDBD92`, `beton #9AA0A0`, `qarmid #2E7FA8`, `marble #EFE7DA`.

## One balata (simplified build)

There is exactly ONE tile and ONE thing to collect. No tiers, no kiosk, no
currency, no hired workers.

| id    | name  | hp | mouna cost |
|-------|-------|----|------------|
| balat | Balat | 14 | 1          |

Mouna is shovelled from any pile on the deck (hold E); the barrow holds 20.
`E` next to a character talks to them instead — each has an ordered
conversation that wraps, and Im Khalil hands you mouna on some of her lines.

## Module contracts

### A. `world.js` → `window.BLB_WORLD`
```js
BLB_WORLD.createWorld(THREE, { palette })  // => world
world.group        // THREE.Group — add to scene. Contains ALL scenery.
world.sky          // THREE.Mesh (sky dome) — game tints it for day/night
world.setTimeOfDay(k)   // k: 0=dawn 0.25=noon 0.5=dusk 0.75=night, wraps. Tints sky/fog.
world.update(t, dt, ctx)// ctx = { waves, camera, playerPos } — animate gulls, palms, boats
world.landColliders     // [{x1,z1,x2,z2,top}] axis-aligned boxes the player stands on / is blocked by
world.sandPiles         // [{ x, y, z, kind:'sand'|'cement'|'gravel' }] on the deck, y=1.5
world.kiosk             // { x, y, z } the muallim's kiosk on the deck (upgrade shop trigger)
world.heckler           // { x, y, z } where the heckling uncle stands (on the deck, by the railing)
world.dispose()
```
### B. `physics.js` → `window.BLB_PHYSICS`
```js
BLB_PHYSICS.createWaveField({ seed })  // => waves
waves.height(x, z, t)        // sea surface y. CHEAP: called ~20k/frame. <=4 trig terms.
waves.normal(x, z, t, outV3) // approximate normal, finite-difference ok
waves.swell(t)               // 0..1 global storminess, slow drift + occasional squalls
waves.breakerAmount(z)       // 0..1 shore-break factor (waves steepen near z small)

BLB_PHYSICS.createTileSim({ waves, tiers })   // => sim   (authoritative tile state)
sim.place(i, j, tierIdx, t)  // => true if placed (must be supported & empty)
sim.remove(i, j)
sim.get(i, j)                // => { i,j,tier,hp,maxHp,placedAt } | null
sim.count                    // live tile count
sim.isSupported(i, j)
sim.exposure(i, j)           // 0..1 — fraction of the 4 neighbours missing, +bonus if j large
sim.update(dt, t)            // wave damage on exposed tiles → returns [{i,j,tier}] destroyed this step
sim.solidAt(x, z)            // => tile top y (0.3) if a tile covers world (x,z), else null
sim.forEach(cb)              // cb(tile) over live tiles
sim.serialize() / sim.load(data)

BLB_PHYSICS.createPlayerBody({ sim, world })  // => body
body.pos                     // THREE.Vector3, feet position
body.vel
body.inWater                 // bool
body.grounded
body.step(dt, t, input, waves)  // input = { moveX, moveZ, jump, run } in world axes, already camera-rotated
body.teleport(x, y, z)

BLB_PHYSICS.createSplashes(THREE, { palette })  // => fx
fx.object                    // THREE.Points — add to scene
fx.burst(x, y, z, strength)  // splash / dust puff
fx.crumble(x, y, z)          // a tile losing the fight: grey debris
fx.update(dt)
```
### C. `hud.js` → `window.BLB_HUD`
```js
BLB_HUD.create({ root, palette, tiers, onBuy, onSelectTier, onStart, onToggleSound })
  // builds the whole 2D overlay in `root` (a div layered over the canvas) and returns hud
hud.setStats({ mortar, mortarMax, tiles, metres, lira, tierIdx, unlocked, workers, swell })
hud.setPrompt(text|null)     // contextual "hold E to shovel" line near the crosshair
hud.toast(text, kind)        // kind: 'good'|'bad'|'info'
hud.heckle(text)             // speech bubble from the uncle, auto-dismiss
hud.setPhase(name)           // 'day'|'dusk'|'night'
hud.openShop(state) / hud.closeShop()
hud.showIntro() / hud.hideIntro()
hud.setLoading(pct|null)
hud.frame(dt)                // per-frame tick for animations
BLB_HUD.createAudio()        // => sfx, all procedural WebAudio, no files
sfx.unlock()  // call on first user gesture
sfx.clack() sfx.pour() sfx.crumble() sfx.splash() sfx.gull() sfx.ui() sfx.purchase()
sfx.wash(level) // continuous surf bed, level 0..1
sfx.muted = bool
```
### D. `game.js` (the orchestrator writes this) — owns scene, camera, controls, player
mesh, tile instancing, economy, workers, save/load, day-night, and the main loop.

## Tone of all written copy
Lebanese, warm, deadpan. Latin-script Lebanese Arabic ("yalla", "shu", "khalas",
"ya 3ammi", "balatle", "muallim", "rou2 3a 7alak") is welcome, with Arabic script used
for the title and a few labels. Never mock; it's affectionate. Keep it short.
