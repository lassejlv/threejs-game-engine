# Three.js Game Engine

A Unity-style game engine that runs in the browser. You build scenes in the editor, press Play to test them, and export finished games as a single HTML file or an installable web app.
It is built with TypeScript, React 19, Vite 8, three.js r186 and Rapier physics.

```bash
npm install
npm run dev        # opens the editor at http://localhost:5173 (builds the game player first, starts the file server with Bun)
npm start          # serves a built editor and the file server together on http://127.0.0.1:5174 (after npm run build)
npm test           # unit tests (engine, physics, navigation, document, editor, scripting, runtime, storage)
npm run test:server  # file server tests (Bun)
npm run test:e2e   # browser smoke test: loads the editor, plays, collects a coin
npm run build      # typecheck + production build of the editor
```

CI (GitHub Actions) runs the typecheck, unit tests, build and the browser smoke test on every push and pull request.

On first launch the editor opens **Coin Rush**, a sample project made only with editor features: prefabs and a prefab variant, two scenes linked by portals, joints, particles, a patrolling hazard, a checkpoint, an elevator, a pathfinding ghost, editor-made screen UI, built-in scripts and project scripts. Press ▶ (Ctrl/Cmd+P) to play it.
In play mode: WASD moves, Space jumps, Shift sprints, E throws a ball, drag the mouse to look. On touch screens an on-screen joystick and buttons appear.

**File → New from template…** starts from one of five projects: Coin Rush, **Sky Hopper** (a 2D platformer), **Arena** (top-down waves of enemies that path-find to you), **Kart Loop** (racing with laps and a saved best lap) and Empty.

## The editor

| Area      | What it does |
| --------- | ------------ |
| Toolbar   | File (new project from a template, open/duplicate/delete projects, import, export .zip or .json, Project Settings), save status, undo/redo, move/rotate/scale tools, snapping, Create, Play / Pause / Step, and Build (run, download `.html`, download installable web app `.zip`) |
| Hierarchy | Screen UI elements, then the entity tree. Search by name or component (`t:light`, `t:script`, `t:collider`…). Shift/Ctrl/Cmd-click selects several entities, double-click renames, drag reparents, and the prefab button turns the selection into a prefab |
| Viewport  | **Scene** tab: orbit camera (or a flat side view with the **2D** toggle), gizmos (they move every selected entity), click to select, collider outlines and draggable collider handles. **Game** tab: the view through the main camera, where screen UI is laid out by dragging. Play switches to Game automatically. The Colliders toggle also draws physics shapes, joints and the navigation grid while playing |
| Inspector | Transform and components, plus Add Component. Edits apply to every selected entity that has the field. Prefab instances can override any field of any part of their prefab. With nothing selected it shows scene settings. While playing, a **Live** panel shows the selected entity's runtime state and lets you tweak it |
| Project   | Scenes (open, rename, set the start scene), prefabs (edit, place, create variants), scripts, and assets with thumbnails. Deleting an asset lists where it is used first |
| Console   | Script logs and errors. A script that throws is disabled and reported with its line number; the game keeps running |
| History   | Every undoable step with a readable name; click one to undo or redo to it |

Panels can be resized by dragging their edges. Shortcuts: `W` `E` `R` pick the tool, `F` focuses the selection, `Del` deletes, `Ctrl/Cmd+D` duplicates, `Ctrl/Cmd+C` / `V` copy and paste, `Ctrl/Cmd+Z` / `Shift+Z` undo and redo, `Ctrl/Cmd+P` plays and stops, and `` ` `` toggles the stats panel.

### Projects are local files

The engine is local-first: there is no account and no cloud. With [Bun](https://bun.sh) installed, `npm run dev` also starts a small file server (`server/files.ts`), and every project is a plain folder:

```
projects/coin-rush/
  project.json   # the document (readable, diff-friendly JSON)
  assets.json    # asset names and kinds
  assets/        # .glb models, .png/.jpg/.webp textures, .mp3/.ogg/.wav audio
```

Back up, copy or version that folder like any other files (`projects/` is git-ignored here; set `GE_PROJECTS_DIR` to keep projects elsewhere). Deleted projects move to `projects/.trash/`. Without Bun the editor keeps projects in the browser (IndexedDB) instead; the toolbar always shows where the open project is saved, and a banner appears if saving ever fails.

The file server only listens on 127.0.0.1 and only accepts requests from the editor itself: other websites and DNS-rebinding tricks are refused, and no path can leave the projects folder.

Every edit autosaves. **File → Export project** writes a `.zip` bundle (the same layout as a project folder, assets included) to share or move a project; **Import** accepts a bundle or a `.json` and always creates a new project. Project files carry a format version (currently 3): older files are migrated when opened, broken ones are refused with a message saying what and where, and files from a newer editor are refused rather than misread.

**Project Settings** (File menu): project name, start scene, renderer and export options; input actions and axes (record keys by pressing them) and touch controls; and 16 named physics layers with a collision matrix.

### Scene settings

- Sky: flat color, three-color gradient, or a 360° image; optional sky lighting (image-based lighting) and fog
- Shadows: off / low / medium / high
- Post-processing: exposure, bloom, vignette, saturation, contrast
- Music: play a track (cross-fading from the previous scene's), keep the current one, or stop
- Physics gravity, and the navigation grid used for pathfinding (cell size, agent radius and height, step, slope)

### Components

- Mesh Renderer: 7 primitives; PBR material with color, normal, roughness, metalness and emissive maps, tiling, opacity and double-sided rendering
- Model: glTF with a single clip or an **animation state machine** (states, 1D blends by a parameter, transitions on conditions like `speed > 0.1 && grounded`, triggers, or when a clip ends), up to four LOD levels and a cull distance
- Light: directional, point, spot or hemisphere, with shadows
- Camera: perspective or orthographic; the *main* camera is used in play mode
- Sprite: a flat, unlit image or colored rectangle with tint, flip, pixel-art filtering, sprite-sheet animation and draw order
- Terrain: a heightfield you sculpt in the Scene view (raise, lower, smooth, flatten), colored by slope, with a matching physics collider
- Audio Source: 2D or 3D, loop, play on start
- Particle Emitter: rate per second and per meter (trails), burst and duration, point/sphere/box shapes, spread, gravity, drag, size and opacity curves, color over life, spin, sprite sheets, additive or normal (sorted) blending, world or local space, and sub-emitters that fire where a parent's particles spawn or die. **Auto destroy** makes one-shot effects you can `spawn`
- Rigid Body: dynamic, kinematic or character; **2D** locks it to the XY plane
- Collider: box, sphere, capsule, cylinder, exact mesh or convex hull (built from the mesh or model); trigger option; a physics layer
- Joint: hinge, ball, fixed, slider or spring to another body or the world, with limits and motors
- Scripts

### Prefabs and scenes

Select an entity and click the prefab button in the Hierarchy. The subtree becomes a prefab, and the entity becomes an instance of it. Changes made to the prefab (Project → click a prefab) apply to every instance.
An instance keeps its own transform, name and script parameters, and can override any component field on any part of the prefab, or add and remove components on just that instance (overridden parts are marked •; revert a part or everything). **Unpack** turns an instance back into plain entities.
**Variant** creates a prefab based on another one: it follows the base and changes only what it overrides. Prefabs can contain other prefabs. A project can have several scenes; the start scene is where an exported game begins.

### Screen UI

Each scene has a list of screen UI elements (text, button, bar, image), added from the Hierarchy and laid out by dragging in the Game view. Text can show live values with `{key}` (from `ctx.globals`), bars can show a key or a `key/key` ratio, and buttons can load a scene or send an event without a script. Scripts change an element through `ctx.ui` using its name.

### Scripts

The full reference is in [docs/script-api.md](docs/script-api.md) (generated from the editor's typings), with a tutorial per template in [docs/tutorials](docs/README.md). The API on that page is stable: from 1.0 it only changes in a major release.

Project scripts are edited in Monaco. They get autocomplete, hover docs and type errors for the full script API, and saving a script while the game is playing hot-reloads it.

```js
/** @type {import('engine').Script} */
export default {
  // Shown in the Inspector. The field type comes from the default value
  // (number, boolean, string, or '#rrggbb' for a color).
  params: { speed: 90, enemy: 'Enemy' },

  start(ctx) {
    ctx.every(1, () => ctx.log('tick'))
  },
  fixedUpdate(ctx, dt) {},            // 60 Hz, runs before physics
  update(ctx, dt) {
    ctx.object.rotation.y += THREE.MathUtils.degToRad(ctx.params.speed) * dt
    if (ctx.input.actionPressed('Jump')) ctx.tween(ctx.object.position, { y: 2 }, 0.4, { ease: 'backOut' })
  },
  lateUpdate(ctx, dt) {},
  onCollisionEnter(ctx, other) {
    if (other.name === ctx.params.enemy) ctx.loadScene('Game Over')
  },
}
```

| `ctx.` | |
| ------ | - |
| `object`, `body`, `params`, `state`, `globals`, `time` | the entity, its rigid body, its inspector values, per-instance and shared storage, time |
| `input.action / actionPressed / getAxis` | named actions and axes from Project Settings (keyboard, mouse, gamepad and touch combined) |
| `find(name)`, `spawn(prefab, { position })`, `destroy()`, `loadScene(name)` | entities and scenes |
| `after(s, fn)`, `every(s, fn)`, `tween(target, to, s, { ease, loop, yoyo })` | timers and tweens on game time, cancelled with the entity |
| `emit(name, data)`, `on(name, fn)` | events between scripts |
| `save(key, value)`, `load(key, fallback)` | data that survives reloads (per project) |
| `physics.raycast / sphereCast / overlap`, `applyImpulse / addForce / addTorque / setAngularVelocity` | Rapier queries and forces |
| `nav.moveTo(point or entity)`, `nav.findPath`, `nav.randomPoint` | pathfinding on a grid baked from static colliders |
| `ui.text / button / bar / image / label`, `hud.set / message` | in-game UI (DOM overlay) |
| `sound.play(asset)`, `sound.tone(freq)`, `audio.play()`, `music.play(asset)`, `volume.set(group, v)` | one-shots, a built-in synth, the entity's Audio Source, cross-fading music, master/music/sfx volume |
| `animation.play(clip or state)`, `animation.set(param, v)`, `animation.trigger(name)` | glTF animation and its state machine |
| `particles.play() / stop() / burst(n) / clear()` | the entity's Particle Emitter |
| `sprite.frame / fps / flipX / color` | the entity's Sprite |

Built-in scripts: `PlayerController`, `FollowCamera`, `PlayerController2D`, `FollowCamera2D`, `Collectible`, `Rotate`, `Bob`, `DestroyBelow`, `MovingPlatform`, `Patrol`, `Health`, `Hazard`, `Checkpoint`, `Door`, `Chase` and `Wander`. They read the default input names (Jump, Sprint, Fire, Interact, MoveX/Y, LookX/Y), so remapping keys in Project Settings works for them too.

### Exporting a game

**Build → Download game** writes one self-contained `.html` file containing the player, your project and the assets it uses (as base64). Open it from disk or upload it to any static host (itch.io, GitHub Pages, Netlify).
**Build → Download installable web app** adds a manifest, icons and an offline service worker in a `.zip`, so players can install the game and play offline.
**Build → Run in new tab** opens a quick build directly.
By default exports leave out unused assets, meshopt-compress models and re-encode textures as WebP when that is smaller (Project Settings → General).
The player is about 5.3 MB plus your assets (1.9 MB gzipped), and Rapier's WASM accounts for most of that. WebGPU projects use a separate player build that is 0.7 MB larger, so WebGL games don't carry the WebGPU renderer. Exported games show a loading screen and fade between scenes.

### 2D games

Add a **2D Camera** (orthographic, from Create → 2D) and **Sprites**, and tick **2D** on rigid bodies so they stay in the XY plane. The 2D toggle above the Scene view switches to a flat side view. `PlayerController2D` and `FollowCamera2D` handle running, jumping and a camera that follows with look-ahead. Sky Hopper is a complete example.

### WebGPU

Project Settings → Renderer switches between WebGL and **WebGPU (experimental)**. WebGPU uses three.js's `WebGPURenderer` with node materials. Particles and post-processing have TSL versions, and browsers without WebGPU fall back to WebGL 2 through the same renderer. The viewport switches right away, the stats panel (`` ` ``) shows which backend is running, and exported games follow the setting.

## Security model

Scripts are ordinary JavaScript with the same powers as the page they run in. The engine doesn't sandbox them, so these are the boundaries:

- **In the editor**, Play runs project scripts in the editor's own page. A script could read or change your other projects (through browser storage or the local file server). Projects you create are trusted. A project you **import** (a bundle, a `.json`, or a folder copied into `projects/`) asks before its scripts run for the first time ("Run scripts" or "Cancel"), and remembers the answer. Built-in scripts never ask.
- **The file server** (`server/files.ts`) only listens on `127.0.0.1`. It refuses requests from other websites (Origin check) and from foreign host names (DNS rebinding), keeps every path inside the projects folder, and caps request sizes.
- **Exported games** are self-contained HTML files with no network calls of their own. Scripts can use whatever the page they're hosted on allows (`ctx.save` uses that site's `localStorage`). Problems show up in an on-screen error list instead of only the console.
- **Nothing leaves your machine:** no accounts, telemetry or cloud services.

Running play mode in a separate, sandboxed origin would isolate untrusted scripts completely. That is deliberately not done while the editor is local-first and single-user. The trust prompt covers the realistic case (opening someone else's project). Revisit it if the editor is ever hosted for others.

## Architecture

```
src/engine/       runtime with no React or editor code: loop, ECS, input, assets, physics
  physics/        built-in AABB physics, and the Rapier adapter (joints, queries, debug lines)
  navigation/     the walkable grid and A* behind ctx.nav
  render/         post-processing (WebGL passes and a TSL version for WebGPU)
src/react/        <GameCanvas>, hooks, stats overlay
src/editor/
  document.ts     the project format (v2: scenes, prefabs, scripts, settings); prefab expansion and overrides
  editor.ts       editor state, labelled undo/redo (with transactions for drags), actions, autosave
  scripting.ts    script API, compiler, built-in scripts
  scriptTypes.ts  type declarations shown in Monaco
  exportGame.ts   single-file and web-app exports, asset stripping and compression
  runtime/        turns documents into running worlds: edit view, play session, environment and
                  post-processing, instancing, particles, animation, navigation, timers, audio mixer,
                  game and scene UI, touch controls, fades, collider outlines and handles
  ui/             the editor's React panels
src/player/       standalone player for exported games (no React, no editor); WebGL and WebGPU builds
e2e/              browser smoke test
```

The editor only ever edits the **document**. Edit mode renders it directly and rebuilds only the entities whose data changed. Play mode copies the document and turns it into a running ECS world with Rapier physics. Stop throws that world away. As in Unity, nothing that happens during play changes the scene, except script source edits, which hot-reload.
The exported player runs the same `runtime/` code, so games behave the same inside and outside the editor.

Performance:
- The fixed-timestep simulation is interpolated, so motion stays smooth at 120/144 Hz.
- In play mode, identical meshes are drawn as instanced batches (Coin Rush: 101 → 37 draw calls).
- ECS queries are cached in sparse sets. React reads engine state through stores and never re-renders once per frame.
- Rapier, the glTF loader, post-processing, the WebGPU renderer, export compression and Monaco are lazy-loaded. The editor's first load is about 355 kB gzipped (React, three.js and the app).

## Known limits

- Joint frames are taken from the bodies' poses when play starts; joints can't be added or retargeted while playing.
- LOD levels and blended animation states apply to static models and the model's own clips; LOD levels don't animate.
- Navigation is a grid baked once per scene from static colliders; moving obstacles aren't avoided.
- Export compression doesn't recompress textures embedded inside .glb files.
