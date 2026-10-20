# Three.js Game Engine (MVP)

A small, Unity-style game engine that runs in the browser. You build scenes in the editor, press Play to run them, and press Stop to go back to editing.
It is built with TypeScript, React 19, Vite 8 and three.js r186.

```bash
npm install
npm run dev        # opens the editor at http://localhost:5173
npm test           # unit tests (ECS, physics, document, scripting)
npm run build      # typecheck + production build
```

On first launch the editor opens **Coin Rush**, a small platformer built entirely from editor components and built-in scripts. Press ▶ (Ctrl/Cmd+P) to play it.

## The editor

| Panel     | What it does |
| --------- | ------------ |
| Toolbar   | File (new / open / export JSON), undo/redo, move/rotate/scale tools, snapping, Create menu, Play / Pause / Step |
| Hierarchy | Entity tree. Click to select, double-click to rename, drag to reparent (drop on empty space to unparent) |
| Scene view | Orbit camera (left-drag orbits, right-drag pans, wheel zooms), click to select, gizmos for moving, rotating and scaling |
| Inspector | Edits the transform and components, and Add Component. With nothing selected it shows scene settings (sky, ambient light, fog, gravity) |
| Project   | Project scripts, built-in scripts, and imported assets (.glb models, .png/.jpg/.webp textures) |
| Console   | Script logs and errors. A script that throws is disabled and reported with its line number; the game keeps running |

Shortcuts: `W` `E` `R` pick the tool, `F` focuses the selection, `Del` deletes, `Ctrl/Cmd+D` duplicates, `Ctrl/Cmd+Z` undoes, `Ctrl/Cmd+Shift+Z` redoes, `Ctrl/Cmd+P` plays/stops, and `` ` `` toggles the stats panel.

The project autosaves to localStorage. Imported assets are stored in IndexedDB. Exported JSON includes the scene and scripts, but not the binary assets.

### Components

Mesh Renderer (7 primitives, PBR material, texture), Model (glTF), Light (directional, point, spot, hemisphere, with shadows), Camera (the *main* camera is used in play mode), Rigid Body, Collider (box or sphere, trigger) and Scripts.

### Scripts

Built-in scripts: `Rotate`, `Bob`, `PlayerController`, `FollowCamera`, `Collectible`, `DestroyBelow`.
To write your own, use **Project → New script**:

```js
export default {
  // Shown in the Inspector. The field type comes from the default value:
  // number, boolean, string, or '#rrggbb' for a color.
  params: { speed: 90, target: 'Player' },

  start(ctx) {},
  fixedUpdate(ctx, dt) {}, // 60 Hz, runs before physics
  update(ctx, dt) {
    ctx.object.rotation.y += THREE.MathUtils.degToRad(ctx.params.speed) * dt
  },
  lateUpdate(ctx, dt) {},
  onCollisionEnter(ctx, other) {
    if (other.name === ctx.params.target) ctx.destroy()
  },
}
```

`ctx` gives you `object` (the three.js node), `body` (its rigid body, if any), `params`, `input`, `time`, `state` (per instance), `globals` (shared across scripts), `hud.set(key, value)` / `hud.message(text)`, `find(name)`, `destroy(handle?)`, and `log` / `warn` / `error`. `THREE` is available as a global.

## Architecture

```
src/engine/   runtime with no React or editor code: loop, ECS, input, assets, physics
src/react/    <GameCanvas>, hooks, stats overlay
src/editor/
  document.ts     the serializable project format (plain JSON)
  editor.ts       editor state, undo/redo history, actions, autosave
  scripting.ts    script API, compiler, built-in scripts
  runtime/
    editScene.ts  edit mode: diffs the document into three.js, gizmos, picking
    playScene.ts  play mode: builds ECS entities from a frozen copy of the document
    playSession   runs scripts, collision callbacks, the HUD
  ui/             toolbar, hierarchy, inspector, project, console, script editor
```

The editor only ever edits the **document**. Edit mode renders the document directly and rebuilds only the entities whose data changed. Play makes a copy of the document and turns it into a running ECS world. Stop throws that world away. As in Unity, nothing that happens during play changes the scene.

The engine core works the same as in the first phase. Simulation runs at a fixed timestep and rendering is interpolated between steps. The ECS uses sparse sets and cached queries. Collision detection uses a spatial-hash broadphase. React reads engine state through stores and never re-renders once per frame. See `src/engine` for details.

## Known limits (MVP)

- Colliders are axis-aligned boxes and spheres; rotation is ignored.
- Rigid bodies are simulated in world space and are detached from their parent in play mode.
- One scene per project. There are no prefabs yet.
- There is no audio and no animation playback for glTF clips yet.

## Roadmap

Prefabs and multiple scenes, a Rapier physics adapter (rotated shapes), audio, glTF animation, Monaco-based script editing with TypeScript types, collider gizmos, a separate game view, standalone game export (a build without the editor), and a WebGPU renderer.
