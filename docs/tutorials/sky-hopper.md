# Sky Hopper: a 2D platformer

Sky Hopper is a side-on platformer made with sprites, an orthographic camera and physics locked to the XY plane. The editor opens it in the **2D** view.

## Play it

A/D run, Space jumps. Collect coins, avoid the red spikes and reach the goal flag. Falling or touching spikes costs a heart; the checkpoint changes where you respawn.

## How it is built

- **2D Camera** is a Camera set to *Orthographic*, with the built-in `FollowCamera2D` (it looks a little ahead in the direction you run).
- **Player** is a prefab with a **Sprite**, a character Rigid Body with **2D** ticked (it can't drift in depth) and the built-ins `PlayerController2D` and `Health`.
- **Coins** use `Collectible` and `Bob`; **Spikes** use `Hazard`, which knocks the player back and removes health.
- **Lift** uses `MovingPlatform`; **Checkpoint** uses `Checkpoint`.
- **Goal Flag** has a trigger collider and the project script `Goal`, which shows a win message.

## Try this

1. **Use an image.** Import a .png (Project → Assets → Import), select the Player and choose it as the Sprite's texture. Tick *Pixel art* for crisp pixels; set *Sheet columns/rows* and *FPS* for an animated sprite sheet.
2. **Make the jump floatier.** Lower the Player body's gravity scale, or tweak `PlayerController2D`'s parameters.
3. **Add a level section.** Select a platform under *Level*, press Ctrl/Cmd+D to duplicate it and drag it into place with the move tool (W). Turn on snapping (magnet) for tidy positions.
4. **A second kind of coin.** Project → Prefabs → *Coin* → **Variant**, give the variant a different sprite color, and place a few. The coin counter in the HUD counts them too, because they share `Collectible`'s counter.

Next: [Arena](arena.md).
