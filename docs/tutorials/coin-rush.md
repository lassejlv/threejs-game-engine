# Coin Rush: a 3D platformer

Coin Rush is the sample every new install opens. It shows most of the engine at once: prefabs and a prefab variant, two scenes joined by a portal, physics with joints, particles, a patrolling hazard, a checkpoint, an elevator, a pathfinding ghost and screen UI.

## Play it

Press **▶** (Ctrl/Cmd+P). WASD moves, Space jumps, Shift sprints, E throws a ball, drag to look around. Collect the coins; the portal leads to the Bonus Room.

## How it is built

- **Player** is a prefab (see Project → Prefabs) with a character Rigid Body, a capsule Collider and three scripts: the built-in `PlayerController` (movement), `Health` (lives and respawning at checkpoints) and the project script `BallLauncher` (spawns the `Ball` prefab on Fire).
- **Player Camera** uses the built-in `FollowCamera`.
- **Coins** are instances of the `Coin` prefab with `Collectible`, `Rotate` and `Bob`. **Purple Coin** is a *variant* of Coin: it follows Coin and only overrides its colors.
- **Game Manager** runs the `GameManager` script: the timer, the progress bar and the name tag over the player.
- **Portal to Bonus Room** has a trigger collider and the `Portal` script, which calls `ctx.loadScene('Bonus Room')` when the player walks in.
- **Spike Roller**, **Elevator** and **Checkpoint** use the built-ins `Hazard`, `MovingPlatform` and `Checkpoint`; the Bonus Room's ghost uses `Chase` with pathfinding.

## Try this

1. **Change a prefab once, everywhere.** Project → Prefabs → *Coin* → make it bigger. Every coin grows, and so does every Purple Coin: a variant follows its base except for what it overrides (its colors).
2. **Tune the player.** Select *Player* → in its `PlayerController` script section, raise `jumpSpeed`, then play.
3. **Override one instance.** Select a single coin instance, pick a part under *Override part* and change its scale. Only that coin changes; *Revert this part* undoes it.
4. **Write a script.** Project → Scripts → **New script**, then add it to the Elevator to make it spin with `ctx.object.rotation.y += dt`. Saving while playing hot-reloads it.

Next: [Sky Hopper](sky-hopper.md) for 2D, or the [script API](../script-api.md).
