# From an empty project

The Empty template has a camera, a light and the ground. This walkthrough turns it into a tiny game: a player that walks around and collects a coin.

1. **File → New project…** → *Empty*.
2. **A player.** Create → *Capsule*. In the Inspector, **Add component** → *Rigid Body* and set its type to *Character*; add a *Collider* and set its shape to *Capsule*. Under Scripts, add the built-in `PlayerController`. Rename it *Player* (double-click it in the Hierarchy).
3. **A camera that follows.** Select *Main Camera* and add the built-in `FollowCamera`. Its `target` parameter is already `Player`.
4. **A coin.** Create → *Cylinder*, scale it flat (0.8, 0.1, 0.8) and lift it to y = 1. Add a *Collider* with *Is trigger* ticked, and the built-ins `Collectible` and `Rotate`.
5. **Play** (Ctrl/Cmd+P): walk into the coin.
6. **Make it a prefab.** Select the coin and click the prefab button in the Hierarchy toolbar. Project → Prefabs → *Place* adds more; changing the prefab changes them all.
7. **Your own script.** Project → Scripts → **New script**, then follow the [script API reference](../script-api.md). For example, make the coin bob:

   ```js
   /** @type {import('engine').Script} */
   export default {
     params: { height: 0.25 },
     update(ctx) {
       ctx.object.position.y = 1 + Math.sin(ctx.time.elapsed * 3) * ctx.params.height
     },
   }
   ```

8. **Share it.** Build → **Download game (.html)** gives a single file anyone can open. File → **Export project (.zip)** saves the project itself, assets included.
