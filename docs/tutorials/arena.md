# Arena: top-down waves

Arena is a top-down survival game: enemies arrive in waves from the edge of the arena, path-find around pillars towards you, and you shoot them for points.

## Play it

WASD moves, E shoots in the direction you face. You have five hearts; the score is at the top right.

## How it is built

- **Camera** runs the project script `TopDownCamera`, which follows the player from above at a fixed angle.
- **Player** uses the built-ins `PlayerController` and `Health`, plus the project script `Shooter`, which spawns the `Bullet` prefab with `ctx.spawn` and gives it velocity.
- **Bullet** (prefab) runs `Bullet`: it damages anything with `Health` that it hits and removes itself after its lifetime.
- **Enemy** (prefab) uses `Chase` (pathfinding with `ctx.nav`), `Hazard` and `Health`.
- **Waves** runs the `Waves` script: it spawns enemies faster over time and keeps `globals.score`, which the *Score* UI text shows as `Score {score}`.

## Try this

1. **Harder waves.** Select *Waves* and lower its `interval` parameter.
2. **A shotgun.** Open the `Shooter` script and spawn three bullets with slightly different directions.
3. **More cover.** Duplicate a *Pillar*. Navigation is re-baked from static colliders when play starts, so enemies walk around it.
4. **Sound.** Call `ctx.sound.tone(660, 0.08)` in `Bullet` when it hits something.

Next: [Kart Loop](kart-loop.md).
