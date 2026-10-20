# Changelog

All notable changes to the engine. The project follows [Semantic Versioning](https://semver.org): from 1.0, a minor or patch release never stops a project from opening (the format fixtures in `src/editor/fixtures/` enforce that), and the public script API (see `docs/script-api.md`) only changes in a major release.

## Unreleased

### Added
- Projects as folders on disk through a local Bun file server (`server/files.ts`, started by `npm run dev`), with IndexedDB in the browser as the fallback. Several projects, each with its own assets; a project list to open, duplicate and delete them.
- Project bundles: export and import a `.zip` with the document and every asset.
- Project file format 3, with named migrations from formats 1 and 2, validation with readable errors, and checks for links to deleted prefabs, scripts and parents.
- Save status in the toolbar, a banner when saving fails, and a refusal to switch projects when that would drop unsaved edits.
- `npm start`: the built editor and the file server on one local port.
- Recovery from lost graphics contexts, with an on-screen notice.
- An error list and a stop screen in exported games.
- Size and draw-call budgets (`budgets.json`) checked in CI, and tests that export and play every template.
- MIT license.
- Trust for imported projects: their scripts are never evaluated (not even to read parameters) until the user allows it in a prompt, which is remembered per project.

- Prefab instances can add components to a part or remove the prefab's components, on that instance only.

### Fixed
- Without WebGL (hardware acceleration off, no driver), the editor showed an empty viewport and exported games a blank page; both now explain what is wrong, and the editor stays usable.
- Dropdown menus near a panel edge (Screen UI, Create) were cut off and inherited their header's styling.

### Removed
- Single-project autosave in `localStorage` (projects are moved into the new storage once, and the old data is left in place).

## 0.1.0 — 2026-10-20

The first feature-complete preview, built in one stretch:

- **Editor:** hierarchy with search, inspector with multi-edit and live play-mode values, gizmos, collider handles, labelled undo history, resizable panels, a Monaco script editor with typed API and hot reload, templates (Coin Rush, Sky Hopper, Arena, Kart Loop, Empty).
- **Rendering:** PBR materials and texture maps, automatic instancing, skies and image-based lighting, shadows, post-processing (bloom, vignette, grading), particles, model LOD, terrain, sprites and 2D cameras, and an experimental WebGPU renderer.
- **Physics:** Rapier with characters, joints, mesh and convex colliders, layers, queries and forces for scripts.
- **Gameplay:** prefabs with overrides and variants, multiple scenes, screen UI editor, animation state machine, pathfinding, timers, tweens, events, saves, input mapping with touch controls, music and volume groups, built-in scripts.
- **Shipping:** single-file HTML export, installable web app export with offline support, asset compression, loading screen.
