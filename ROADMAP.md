# Project Roadmap

The goal: take the engine from a feature-rich prototype to something people can rely on to build, keep, share and publish browser games.

## Project snapshot

**What it is.** A Unity-style game engine that runs in the browser: a React editor (`src/editor/`), a runtime with no React dependency (`src/engine/` plus `src/editor/runtime/`), and an exporter. The exporter turns a project into a single `.html` file or an installable web app (`src/editor/exportGame.ts`, `src/player/`). It is built on TypeScript, React 19, Vite 8, three.js r186 and Rapier.

**Who it serves.** People making small-to-medium 3D and 2D browser games, from editing through to publishing, without leaving the browser.

**Maturity: early product.**
- The feature surface is broad, and all 32 commits happened in one burst of development. It covers:
  - PBR materials, instancing, post-processing, particles and LOD
  - Rapier physics with joints and layers
  - scripting with Monaco, timers, events, saves and input mapping
  - pathfinding and an animation state machine
  - prefabs with overrides and variants, a screen UI editor and undo history
  - audio and touch controls
  - terrain, 2D mode, templates and an experimental WebGPU renderer
- The foundations that make it safe to depend on are thin:
  - one project at a time, stored in a single localStorage key
  - project files that leave the assets behind
  - no isolation between the editor and the scripts a project runs
  - a single browser in tests
  - no license and no releases

**Observed constraints**
- **Saving:** one project, autosaved to `localStorage` under `ge-project-v1`, which browsers cap at about 5 MB. A failed save is only logged to the Console tab (`src/editor/editor.ts`, autosave block).
- **Assets:** stored in one global IndexedDB store (`ge-assets`, `src/editor/assetLibrary.ts`) that every project shares. Starting a new project doesn't clear it.
- **Project export:** File → Export project writes the document JSON only, without the models, textures or audio it references (`exportProject` in `src/editor/editor.ts`).
- **Script execution:** project scripts run through `new Function` in the editor's own origin (`src/editor/scripting.ts`, `compileScript`).
- **File format:** at version 2. `parseProject` upgrades v1 and fills new fields with defaults, but doesn't validate structure (`src/editor/document.ts`).
- **Exported game size:** the WebGL player is about 5.3 MB, mostly Rapier's inlined WASM. The WebGPU player is about 6.0 MB (`public/player/`).
- **CI:** typecheck, 166 unit tests, build, and one Chromium smoke test that plays Coin Rush and collects a coin (`.github/workflows/ci.yml`, `e2e/smoke.mjs`). Exports, other browsers and WebGPU aren't covered.
- **Decisions made:** multiplayer and cloud save are out of scope for now. Multiplayer was built and then reverted (commits `9978105` and `0123799`).

**Assumption: what "production-ready" means.** A creator can build a game without losing work, move and share the project with its assets, and publish a game that loads and runs reliably on common browsers and devices. Engine updates must not break existing projects or published games.

## Where to start

### A local Bun file server: projects saved as real folders on disk

**Why this first:** today a project lives in browser storage only:
- the document is in one localStorage key, capped at about 5 MB
- assets are in a global IndexedDB store shared by every project
- clearing site data, or switching browser or machine, loses everything
- File → Export writes JSON without the assets

A small API server on `Bun.serve` that reads and writes project folders fixes all four at once. Projects become ordinary files: easy to back up, version with git, copy between machines and open in other tools. There is no size cap, and several projects can coexist naturally. Bun is installed in this environment (`bun --version` → 1.4.2) and serves files quickly with no extra dependencies.

**Proposed layout**
```
projects/
  coin-rush/
    project.json        # the document (formatted, so git diffs stay readable)
    assets/<id>.<ext>   # models, textures, audio
    assets.json         # asset names, kinds and ids
```

**First actions**
1. Add `server/files.ts` running on `Bun.serve`, bound to `127.0.0.1`, started with `bun run server` (and optionally alongside `npm run dev`). Routes:
   - `GET /api/health`
   - `GET /api/projects` (list)
   - `GET`/`PUT /api/projects/:id` (the document)
   - `GET`/`PUT`/`DELETE /api/projects/:id/assets/:assetId`
2. Give the editor a storage interface with two backends: the local server (used when `/api/health` answers) and the current browser storage as a fallback. The editor must keep working as a static site, for the hosted editor and the exports. Autosave writes through the active backend, and the toolbar shows which one is in use and whether the last save worked.
3. Add server tests with `bun test`: round trip, listing, rejecting paths outside `projects/`, and rejecting requests from foreign origins. Add one e2e test: edit, reload, and confirm the change came back from disk.

**Done when**
- With the server running, a project with imported assets saves to `projects/<name>/` and survives clearing all site data.
- Without the server, the editor behaves exactly as today.
- Server tests cover path traversal and cross-origin rejection, and pass in CI.

## Roadmap

### Phase 1: projects never get lost ✅

**Outcome:** projects are stored durably, several can coexist, failures are visible, and any project can be backed up and moved with its assets.

**Why now:** every later phase assumes users trust the editor with their work. The current storage (one ~5 MB localStorage key, one global asset store, warn-only failures) caps project size and mixes projects' assets.

**Scope**
- [x] The local Bun file server and a storage interface with two backends (the starting milestone above).
- [x] Support several projects: a project list (open, duplicate, delete; rename through the project name) on both backends, with assets owned per project instead of the shared `ge-assets` store.
- [x] Project bundles for sharing and backups: export and import a `.zip` of `project.json` plus `assets/`, using the existing tested writer in `src/editor/zip.ts` (needs an unzip counterpart). The bundle uses the same layout as a project folder on disk.
- [x] Browser-only fallback: move the autosaved document from `localStorage` to IndexedDB, migrating the existing `ge-project-v1` value on first run.
- [x] Show save status in the toolbar (backend, saved/saving/failed) and an explicit banner when a save fails.
- [x] Give the file format explicit versions: bump to v3 for the storage change, write named migration steps, and keep golden fixtures of v1, v2 and v3 files in tests.
- [x] Validate imported projects with readable errors (which scene or entity is broken) instead of a crash later.

**Dependencies**
- None outside the repo. The asset-ownership change touches `src/editor/assetLibrary.ts`, `exportGame.ts` (asset collection) and the thumbnails.

**Exit criteria**
- With the local server, projects live in `projects/<name>/` and reload from disk.
- Without it, a 20 MB project (large terrain plus textures) autosaves to IndexedDB and reloads.
- A bundle exported from one backend imports into the other unchanged.
- A simulated storage failure shows a visible banner.
- Two projects with different assets can be switched between without their assets mixing.
- Fixture tests load a v1, v2 and v3 file and match expected snapshots.

### Phase 2: published games are reliable ✅

**Outcome:** every exported game is tested automatically, loads quickly, survives common runtime failures, and works on the major browsers.

**Why now:** exports are the product's output. Today they are only checked by hand: CI never builds or runs an exported game, only Chromium is tested, and there is no WebGL context-loss handling anywhere in `src/`.

**Scope**
- [x] CI job: export every template (WebGL player, plus WebGPU for one template), open each in a browser, start it and check that it renders and responds to input.
- [x] Run the e2e suite on Firefox and WebKit as well as Chromium.
- [x] Handle WebGL context loss and restore in `src/engine/core/Engine.ts`, with a test that forces it.
- [x] Add an in-game error screen for exported games. Script errors and failed asset loads currently go only to the browser console (`src/player/player.ts`).
- [x] Set a load-time budget and measure it. The player is ~5.3 MB, mostly Rapier WASM: measure time-to-first-frame and decide whether to compile WASM in streaming fashion or load Rapier only when a project uses physics.
- [x] Add a performance budget test: frame time and draw calls for Coin Rush, so instancing (101 → 37 draw calls) can't regress silently.

**Dependencies**
- Phase 1 bundles give the export tests real projects with assets.

**Exit criteria**
- CI exports and plays all templates in three browsers.
- A forced context loss recovers without a reload.
- A deliberately broken script shows the error screen in an exported game.
- Load-time and frame-time budgets are documented and enforced in CI.

### Phase 3: clear trust boundaries ✅

**Outcome:** opening someone else's project can't silently run code with access to your other projects, and the supply chain is checked.

**Why now:** Phase 1 makes sharing projects easy, which makes running untrusted scripts the main security risk. Scripts run via `new Function` in the editor's origin, so they can read every project and asset that origin stores.

**Scope**
- [x] Ask for trust before running scripts from an imported project ("This project contains N scripts. Run them?"), and remember the answer per project.
- [x] Decide on and prototype isolation for play mode: running play in a sandboxed iframe on a separate origin is the robust fix. It is a large change, see Open questions.
- [x] Run `npm audit` in CI and fail on moderate or higher. Today it reports 2 low-severity issues through `monaco-editor`.
- [x] Document what exported games can access, and the security model for scripts.

**Dependencies**
- Phase 1 (per-project storage and import flow).

**Exit criteria**
- An e2e test imports a project with a script and confirms nothing runs until trust is granted.
- The isolation decision is recorded in the README.
- The CI audit step is green.

### Phase 4: maintainable code and stable script API ✅

**Outcome:** contributors can change the editor safely, and the script API can't drift from its documentation.

**Why now:** the riskiest code is the least tested. `src/editor/ui/` has no tests, and the largest files are `Inspector.tsx` (1,285 lines), `document.ts` (1,039) and `editor.ts` (796). The Monaco typings in `scriptTypes.ts` are a hand-written twin of the types in `scripting.ts`.

**Scope**
- [x] Split `Inspector.tsx` into one module per component section and `document.ts` into types, defaults, prefabs and parsing, with no behavior changes.
- [x] Add component tests for the Inspector: single edit, multi-edit, prefab overrides, undo labels.
- [x] Type-check every built-in and template script against `scriptTypes.ts` in CI, so the typings and the runtime can't drift apart.
- [x] Mark the script API stable, and decide which `ctx` members are public and versioned.

**Dependencies**
- Phase 1 changes `document.ts`, so split it after that, not before.

**Exit criteria**
- Inspector tests run in CI.
- A type-test fails when a `ctx` member is renamed in one place only.
- No editor UI file is over roughly 600 lines.

### Phase 5: release it

**Outcome:** a versioned, licensed, documented 1.0 that people can find and use.

**Why now:** this comes last because it packages the guarantees from Phases 1–4. Today there is no `LICENSE`, no `CHANGELOG`, no git tags, the package is `private: true` at `0.1.0`, and the README is the only documentation.

**Scope**
- [x] Choose and add a license (this decision should come early, see Good ideas → Now).
- [x] Adopt semantic versioning, a `CHANGELOG.md` and tagged releases. Promise that a v1 project opens in every later 1.x release (enforced by the Phase 1 fixtures).
- [x] Publish a script API reference generated from `scriptTypes.ts`, plus a short tutorial per template.
- [x] ~~Host the editor publicly~~: not now (see Decisions made). The docs live in `docs/` in the repository instead of a docs site.
- [x] Fix the README's known limits that users hit most: prefab overrides that add or remove components, joints added during play, and moving obstacles for navigation.

**Dependencies**
- Phases 1–4, and a license decision.

**Exit criteria**
- A `v1.0.0` tag with a changelog, a license file and the docs in `docs/` (no public editor URL while the project is local-first).

## Good ideas

### Now
- ✅ **Add a LICENSE:** MIT.
- ✅ **Autosave failure banner:** shipped with Phase 1.
- ✅ **CI artifact of an exported game:** the Chromium browser-test job uploads `coin-rush.html` (and the export load times) with every run.

### Next
- **Asset import pipeline:** compress textures and models on import instead of only on export (`src/editor/compressAssets.ts` already does meshopt and WebP). Projects and autosaves stay smaller. Medium.
- **Mobile performance pass:** touch controls exist, but there is no performance evidence for phones. Profile the templates on a mid-range device and add a quality preset. Medium.
- **Script debugging:** breakpoints or a watch panel. Errors already report line numbers (`src/editor/runtime/playSession.ts`), but stepping through a script isn't possible. Medium to large.

### Later
- **WebGPU as default:** it works and is tested by hand, but it's experimental and its bloom differs slightly from WebGL's. Wait until CI covers it and WebGPU is broadly supported.
- **Engine as an npm package:** `src/engine` has no React dependency and could ship separately, but that needs a stable API first (Phase 4).
- **Multiplayer and cloud save:** deliberately skipped. The reverted multiplayer commit `9978105` is a starting point if that changes.

## Project guidelines

- **The editor edits only the document.** Play mode copies it, and the exported player runs the same `src/editor/runtime/` code. New features must work in both, with no editor-only runtime paths.
- **Every format change gets a migration and a fixture.** Change `parseProject`, add a test file for the old shape, and never break opening older projects.
- **Keep heavy dependencies lazy.** Rapier, post-processing, Monaco, compression and WebGPU load on demand. The WebGL player must not bundle `three/webgpu`; check `public/player/player.js` size when touching shared runtime code.
- **Each feature lands with unit tests and a real-browser check** (screenshots via Playwright, as in the existing work), and the e2e smoke test must stay green.
- **Push finished work to `main`** in small, validated commits: typecheck, `npm test`, `npm run build` and `npm run test:e2e` before each push.
- **Script-facing APIs are documented in `scriptTypes.ts`** at the same time as they are implemented in `scripting.ts`.

## Risks and dependencies

- **A local file server can be reached by any website the user visits:** a page on another site can send requests to `127.0.0.1`, and DNS rebinding can get around naive host checks. Mitigate by binding to `127.0.0.1` only, rejecting requests whose `Origin` or `Host` isn't the editor's, keeping every path inside `projects/` (normalize, then check the prefix), and capping upload sizes. Writing projects to disk makes these checks mandatory, not optional.
- **A second runtime (Bun) next to Node:** CI, Vite and the tests run on Node today. Keep the server a single file with no npm dependencies, and keep the editor fully usable without it, so Bun stays optional.
- **Storage migration could lose existing work:** moving off `ge-project-v1` must keep the old key until the new copy is verified. Mitigate with a migration test and a one-time automatic bundle backup.
- **Sandboxing play mode is a large architectural change:** running play in a separate origin touches the editor ↔ runtime bridge (live inspector, hot reload, collider debug view). Mitigate by shipping the trust prompt first and prototyping isolation separately.
- **Cross-browser CI may surface many issues at once:** Firefox and WebKit have never been tested. Add them as non-blocking jobs first, fix the failures, then make them required.
- **Player size:** Rapier's WASM dominates load time on slow networks. Any fix (lazy physics, streaming compile) must keep the single-file export working offline.
- **Three.js upgrades:** WebGPU needed a browser compatibility shim (`src/engine/render/webgpuCompat.ts`). Pin three.js versions and run the export tests before upgrading.

## Decisions made

- **License:** MIT (`LICENSE`).
- **Local-first, no hosting:** projects are stored locally. Nothing is hosted for now; `npm start` serves a built editor and the file server together on `127.0.0.1`.
- **File server:** `npm run dev` starts it automatically when Bun is installed. Projects live in `projects/` inside the checkout (git-ignored), or wherever `GE_PROJECTS_DIR` points.
- **Run in new tab** stays a blob URL; serving built games from disk adds nothing while everything is local.
- **Multiplayer and cloud save:** out of scope.
- **Play-mode isolation:** no separate origin while the editor is local and single-user; the trust prompt covers opening someone else's project (README, Security model).
- **Script API stability:** everything in `docs/script-api.md` is public and follows semver from 1.0; `ctx.engine` and anything unlisted is internal.
- **Browsers in CI:** Chromium, Firefox (headed under xvfb, since headless Firefox has no WebGL on Linux) and WebKit are all required. Load budgets are 5 s to the start screen and 10 s to the first frames, about three to five times the slowest CI numbers (WebKit: 1.2 s and 1.8 s).
- **Rapier stays inlined:** exported games keep their single-file, offline-capable form. Measured load times (start screen ~0.3 s, first frames under 1 s with software rendering) don't justify lazy-loading physics.
- **Prefab overrides** store added components whole and removed ones as `null`; patches for components the prefab doesn't have are still ignored, so older projects keep their meaning.
- **Joints during play** come from scripts (`ctx.physics.connect` / `disconnect`) instead of a new component mode.
- **Moving obstacles** are any dynamic or kinematic, non-trigger, non-character body. They make grid cells expensive rather than impassable, so an agent still heads for a gap that is only closed for a moment. Agents don't avoid each other.

## Open questions

- Which browsers and devices must be supported beyond desktop Chromium, Firefox and WebKit? For example, Safari on iOS and low-end Android.
- Is the engine meant to be used as an npm library outside the editor? That decides how much of `src/engine` becomes public API.
- If the editor is ever hosted for other people, play mode should move to a sandboxed origin (answered "not now" for the local-first editor).

## Evidence reviewed

- `git status --short --branch`, `git log --oneline`: clean `main` that tracks origin, 32 commits, and the multiplayer add and revert.
- `git ls-files` (122 tracked files): a single app with editor, engine, player and React folders, and no `LICENSE`, `CHANGELOG` or `CONTRIBUTING`.
- `README.md`: features, architecture, performance notes and the "Known limits" list.
- `package.json`: `private: true`, version `0.1.0`, scripts, two player builds.
- `.github/workflows/ci.yml`, `e2e/smoke.mjs`: CI covers typecheck, unit tests, build and one Chromium smoke test (Coin Rush, collect a coin).
- `src/editor/editor.ts`: the localStorage autosave key, warn-only save failures, the 200-step undo limit, and `exportProject` writing JSON only.
- `src/editor/assetLibrary.ts`: a single global IndexedDB store (`ge-assets`).
- `src/editor/document.ts` (`parseProject`, `migrateEntity`): v1 → v2 upgrade, default-filling, no structural validation.
- `src/editor/scripting.ts` (`compileScript`): scripts run via `new Function` in the editor origin.
- `src/editor/zip.ts`, `src/editor/zip.test.ts`: an existing, tested zip writer.
- `grep -rn contextlost src`: no WebGL context-loss handling.
- `ls public/player`: the WebGL player is about 5.3 MB, the WebGPU player about 6.0 MB.
- `wc -l` on sources: `Inspector.tsx` 1,285, `document.ts` 1,039, `editor.ts` 796 lines; nothing under `src/editor/ui/` has tests.
- Test inventory (20 test files, 166 tests passing in the last `npx vitest run`): coverage is concentrated in the runtime, document and editor store.
- `npm audit`: 2 low-severity vulnerabilities through `monaco-editor`.
- `src/engine/render/webgpuCompat.ts`: a browser compatibility shim needed for three.js's WebGPU backend.
- `bun --version`: Bun 1.4.2 is installed, so the local `Bun.serve` file server is feasible here.
