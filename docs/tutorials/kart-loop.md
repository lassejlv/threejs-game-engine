# Kart Loop: racing

Kart Loop is a small arcade racer: drive three laps around a walled circuit, passing the checkpoint gates in order. Your best lap is saved between sessions.

## Play it

W/S throttle and brake, A/D steer. Lap, time and best lap are shown top left.

## How it is built

- **Kart** has a character Rigid Body and the project script `KartController`: it reads the `MoveY` and `MoveX` input axes (so gamepads and touch work too), and models speed, braking, steering and grip.
- **Camera** runs `ChaseCamera`, which stays behind and above the kart and turns with it.
- **Gates** are trigger colliders with the `Gate` script. Gate 0 is the finish line; the script checks the order, counts laps and stores the best lap with `ctx.save`/`ctx.load`.
- The **Outer** and **Inner Wall** groups are rings of barrier blocks with colliders.

## Try this

1. **Tune the handling.** Select *Kart* and change `maxSpeed`, `turnRate` or `grip` in its `KartController` section.
2. **A longer race.** Change `laps` on the gates.
3. **Boost pads.** Add a trigger collider on the track with a script whose `onCollisionEnter` raises the kart's speed (`other.object` is the kart).
4. **Remap the controls.** Project Settings → Input: record new keys for `MoveX` and `MoveY`. The script reads axes, so no code changes are needed.

Next: [build something from an empty project](empty.md).
