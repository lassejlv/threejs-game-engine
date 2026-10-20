# Three.js Game Engine

A Unity-style game engine that runs in the browser. You build scenes in the editor, press Play to test them, and export finished games as a single HTML file.
It is built with TypeScript, React 19, Vite 8, three.js r186 and Rapier physics.

```bash
npm install
npm run dev        # opens the editor at http://localhost:5173 (builds the game player first)
npm test           # unit tests (ECS, physics, Rapier, document, scripting, particles)
npm run build      # typecheck + production build of the editor
```

On first launch the editor opens **Coin Rush**, a sample project made only with editor features: prefabs, two scenes linked by portals, built-in scripts and project scripts. Press ▶ (Ctrl/Cmd+P) to play it.
In play mode: WASD moves, Space jumps, Shift sprints, E throws a ball, drag the mouse to look.

## The editor

| Area      | What it does |
| --------- | ------------ |
| Toolbar   | File (new / open / export JSON), undo/redo, move/rotate/scale tools, snapping, Create, Play / Pause / Step, and Build (run or download the game) |
| Hierarchy | Entity tree. Shift/Ctrl/Cmd-click selects several entities, double-click renames, drag reparents, and the prefab button turns the selection into a prefab |
| Viewport  | **Scene** tab: orbit camera, gizmos (they move every selected entity), click to select, collider outlines. **Game** tab: the view through the main camera. Play switches to Game automatically |
| Inspector | Transform and components, plus Add Component. Prefab instances show Open / Unpack and script parameter overrides. With nothing selected it shows scene settings |
| Project   | Scenes (open, rename, set the start scene), prefabs (edit, drag into the hierarchy, place), scripts, and assets with thumbnails |
| Console   | Script logs and errors. A script that throws is disabled and reported with its line number; the game keeps running |

Panels can be resized by dragging their edges. Shortcuts: `W` `E` `R` pick the tool, `F` focuses the selection, `Del` deletes, `Ctrl/Cmd+D` duplicates, `Ctrl/Cmd+C` / `V` copy and paste, `Ctrl/Cmd+Z` / `Shift+Z` undo and redo, `Ctrl/Cmd+P` plays and stops, and `` ` `` toggles the stats panel.

The project autosaves to localStorage. Assets (.glb models, .png/.jpg/.webp textures, .mp3/.ogg/.wav audio) are stored in IndexedDB.

### Components

- Mesh Renderer: 7 primitives, PBR material, texture
- Model: glTF, with an animation clip, speed and loop
- Light: directional, point, spot or hemisphere, with shadows
- Camera: the *main* camera is used in play mode
- Audio Source: 2D or 3D, loop, play on start
- Particle Emitter: rate, burst and duration, point/sphere/box shapes, spread, gravity, drag, size, color and opacity over life, additive or normal blending, optional texture, world or local space. The Scene view previews it live, and **Auto destroy** turns it into a one-shot effect you can `spawn`
- Rigid Body: dynamic, kinematic or character
- Collider: box, sphere, capsule or cylinder, rotated with the entity, trigger option
- Scripts

### Prefabs and scenes

Select an entity and click the prefab button in the Hierarchy. The subtree becomes a prefab, and the entity becomes an instance of it. Changes made to the prefab (Project → click a prefab) apply to every instance.
Each instance keeps its own transform, name and script parameter overrides. **Unpack** turns an instance back into plain entities.
Prefabs can contain other prefabs. A project can have several scenes; the first one is where an exported game starts.

### Scripts

Project scripts are edited in Monaco. They get autocomplete, hover docs and type errors for the full script API, and saving a script while the game is playing hot-reloads it.

```js
/** @type {import('engine').Script} */
export default {
  // Shown in the Inspector. The field type comes from the default value
  // (number, boolean, string, or '#rrggbb' for a color).
  params: { speed: 90, enemy: 'Enemy' },

  start(ctx) {},
  fixedUpdate(ctx, dt) {},            // 60 Hz, runs before physics
  update(ctx, dt) {
    ctx.object.rotation.y += THREE.MathUtils.degToRad(ctx.params.speed) * dt
  },
  lateUpdate(ctx, dt) {},
  onCollisionEnter(ctx, other) {
    if (other.name === ctx.params.enemy) ctx.loadScene('Game Over')
  },
}
```

| `ctx.` | |
| ------ | - |
| `object`, `body`, `params`, `state`, `globals`, `input`, `time` | the entity, its rigid body, its inspector values, per-instance and shared storage, input, time |
| `find(name)`, `spawn(prefab, { position })`, `destroy()`, `loadScene(name)` | entities and scenes |
| `physics.raycast(origin, dir)`, `physics.applyImpulse(handle, v)` | Rapier queries and forces |
| `ui.text / button / bar / label`, `hud.set / message` | in-game UI (DOM overlay) |
| `sound.play(asset)`, `sound.tone(freq)`, `audio.play()` | one-shot sounds, a built-in synth, the entity's Audio Source |
| `animation.play(clip, { fade, loop, speed })` | glTF animation |
| `particles.play() / stop() / burst(n) / clear()` | the entity's Particle Emitter |

Built-in scripts: `PlayerController`, `FollowCamera`, `Collectible`, `Rotate`, `Bob`, `DestroyBelow`. `Collectible` can spawn an effect prefab where it was picked up (Coin Rush uses a `Sparkle` burst).

### Exporting a game

**Build → Download game** writes one self-contained `.html` file containing the player, your project and every imported asset (as base64). Open it from disk or upload it to any static host (itch.io, GitHub Pages, Netlify).
**Build → Run in new tab** opens the same build directly.
The file is about 5 MB plus your assets (1.9 MB gzipped), and Rapier's WASM accounts for most of that.

## Architecture

```
src/engine/      runtime with no React or editor code: loop, ECS, input, assets, physics
  physics/       built-in AABB physics, and the Rapier adapter used by the editor and exported games
src/react/       <GameCanvas>, hooks, stats overlay
src/editor/
  document.ts    the project format (v2: scenes, prefabs, scripts); expands prefab instances
  editor.ts      editor state, undo/redo (with transactions for drags), actions, autosave
  scripting.ts   script API, compiler, built-in scripts
  scriptTypes.ts type declarations shown in Monaco
  runtime/       turns documents into running worlds: edit view, play session,
                 game UI, audio, animators, particles, collider outlines
  ui/            the editor's React panels
src/player/      standalone player for exported games (no React, no editor)
```

The editor only ever edits the **document**. Edit mode renders it directly and rebuilds only the entities whose data changed. Play mode copies the document and turns it into a running ECS world with Rapier physics. Stop throws that world away. As in Unity, nothing that happens during play changes the scene, except script source edits, which hot-reload.
The exported player runs the same `runtime/` code, so games behave the same inside and outside the editor.

Performance:
- The fixed-timestep simulation is interpolated, so motion stays smooth at 120/144 Hz.
- ECS queries are cached in sparse sets. React reads engine state through stores and never re-renders once per frame.
- Rapier, the glTF loader and Monaco are lazy-loaded. The editor's first load is about 310 kB gzipped (React, three.js and the app).

## Known limits

- Joints are not exposed in the editor yet.
- Mesh colliders for imported models are not supported; models use primitive colliders.
- Prefab overrides cover the transform, name, active flag and script parameters, not other component fields.
- Exported games include every imported asset, even unused ones.
