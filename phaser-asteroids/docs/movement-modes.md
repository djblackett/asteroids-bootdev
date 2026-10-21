# Touch movement experiment: Classic D-Pad, Point-to-Fly, Assisted Flight

An **experiment**, not a redesign: three ways to fly the ship on a phone, selectable on the CONTROLS page (also from the pause menu),
so they can be compared on a real device and by friends and family. Classic D-Pad stays the default. Nothing here touches the
keyboard, the gamepad, the simulation's difficulty, the desktop game or the deployed site.

## The ship has no inertia (and no screen wrapping)

The first version of this task assumed Asteroids-style momentum, coasting and screen wrapping. The Phaser game has none of them
(`core/player.ts`): holding thrust moves the ship `PLAYER_SPEED` (300 px/s) along its nose, releasing it stops the ship on that
frame, and the only velocity in the whole game is a short wall-bounce impulse. The ship **bounces off the walls**, it does not wrap.
The decision was to keep those physics in all three modes and not add a velocity simulation. So:

- "Preserve momentum" and "coast on release" do not apply. **All three modes stop the moment the thumb lifts**, like Classic.
- Point-to-Fly changes *what turns the ship* and when it thrusts.
- Assisted Flight bends the *direction of travel*: a travel heading that chases the stick, ahead of the nose. That is the one
  new piece of simulation state (`PlayerState.travelHeading`), and it only exists while the stick is engaged in that mode.
- Wall bounces, the speed limit (`PLAYER_SPEED`, x 2.5 under Boost) and every collision are the existing code paths.

## The three modes

| Mode | Control | What the thumb does | What the ship does |
|---|---|---|---|
| **Classic D-Pad** (default) | Fixed D-pad, bottom left | Left / Right rotate, Up thrusts (eight sectors, unchanged) | Exactly as before |
| **Point-to-Fly** | Floating joystick | Names the heading the ship should face (absolute, on screen) | Nose turns toward it by the shortest way at a limited rate; thrusts along its **nose** the whole time the stick is engaged |
| **Assisted Flight** | The same joystick | Names where to travel (same mapping) | Nose turns exactly as in Point-to-Fly, but it **flies along a travel direction that chases the stick faster than the nose can turn** |

Both stick modes share the joystick's look, placement, 15 % radius and dead zone. FIRE, LASER, BOOST and PAUSE are untouched.
The ship still shoots from its nose (no independent aim, no auto-aim).

## How it works

**Heading convention** (from `core/math.ts`, Pygame's): 0 = Down, 90 = Left, 180 = Up, 270 = Right, y down.
`getForwardVector(h) = (-sin h, cos h)`. The thumb offset (dx, dy) from the stick's centre becomes
`heading = atan2(-dx, dy)` in degrees, wrapped to [0, 360) (`directionToHeading`, the exact inverse of `getForwardVector`).

**Stick (`input/touchModel.ts`).** In the two stick modes the command is `{ rotate: 0, move: 1, steer: { heading, mode } }` while the
thumb is engaged and a neutral command otherwise. Only the direction matters, not how far the thumb is pushed. Engagement has
hysteresis: on at 0.25 of the stick radius, off again below 0.18, so a thumb resting on the edge does not flicker. Lifting,
cancelling, losing focus, hiding the page, a rotation, pausing or switching mode all go through the existing `releaseAll`.
The retired relative joystick is still in the model (`StickStyle` `relative`) for compatibility and tests; no menu offers it.

**Point-to-Fly (`updatePlayer`).** Each step: `rotation = turnToward(rotation, heading, TOUCH_STEER_TURN_SPEED * dt)`, where
`turnToward` takes the shortest way (`shortestAngleDelta`, in (-180, 180]; an exact reversal is +180 so the choice is stable), never
overshoots and wraps into [0, 360). Thrust is the normal `PLAYER_SPEED * dt` along the **current nose**, so the path curves while the
ship is still turning. If the stick points opposite to the nose, the ship flies *backwards* until it has turned round (0.6 s at 300 deg/s).

**Assisted Flight (`updatePlayer`).** The nose turns as above. In addition `travelHeading` is kept while the stick is engaged:
it starts at the stick's own heading (there is no momentum to preserve, so a push from rest sets off straight toward the thumb), then
each step `travelHeading = turnToward(travelHeading, heading, ASSIST_TRAVEL_TURN_SPEED * dt)`. The displacement is
`PLAYER_SPEED * dt` (x Boost) along `travelHeading` instead of along the nose. It is cleared on every frame without an engaged assisted
stick (release, mode switch, a key press, respawn, elimination). Speed never exceeds Classic's; only the direction differs, and it
cannot jump (at most `ASSIST_TRAVEL_TURN_SPEED * dt` per step, 10 degrees at 60 fps). All angle integration is per-`dt`, so the
result is frame-rate independent apart from the simulation's own 1/30 s sub-steps.

A keyboard or gamepad rotate command, if one is present on the same ship, beats the stick for the nose and switches assistance off
(`mergeInputs` also drops the stick request while a key or pad is steering). Keyboard, pad and D-pad inputs carry no `steer`, so their
code path is exactly the old one.

## Tuning constants

All in `src/core/constants.ts` (touch movement experiment block) except the dead zones (`src/input/touchModel.ts`).

| Constant | Value | Meaning |
|---|---|---|
| `TOUCH_STEER_TURN_SPEED` | 300 deg/s (= `PLAYER_TURN_SPEED`) | Max nose turn rate toward the stick, both modes. 180 degrees takes 0.6 s. |
| `ASSIST_TRAVEL_TURN_SPEED` | 600 deg/s | Max rate the direction of travel chases the stick, Assisted only. 90 degrees takes 0.15 s, a reversal 0.3 s. Set it to 300 and Assisted Flight becomes Point-to-Fly except for the start from rest. |
| `DIRECTION_DEAD_ZONE` | 0.25 of the stick radius | Thumb must pass this to request a direction (13-18 CSS px). |
| `DIRECTION_DEAD_ZONE_HELD` | 0.18 of the stick radius | Once engaged, only below this does it disengage. |
| Stick radius | 15 % of the shorter screen side, 52-72 CSS px | Unchanged (`stickRadiusFor`). |
| Speed | `PLAYER_SPEED` 300 px/s, Boost x 2.5 | Unchanged. |

Things to try on a phone: raise `ASSIST_TRAVEL_TURN_SPEED` to 900 for a snappier ship; raise `TOUCH_STEER_TURN_SPEED` to 450 if the nose feels
slow behind the thumb (Point-to-Fly especially); widen `DIRECTION_DEAD_ZONE` if a resting thumb nudges the ship.

## Saved choice and legacy preferences

- Key `asteroids.touchMovement` = `classic` | `pointToFly` | `assisted`. Anything else (including empty, `dpad`, `joystick`) is ignored and means Classic.
  Blocked storage still works for the visit. Nothing is written until the player taps a choice.
- Before this experiment the choice was `asteroids.touchSteering` = `dpad` | `joystick`, and `joystick` was a *relative* stick (left / right
  rotates, up thrusts). It is **not** reinterpreted as either new stick mode: a saved `joystick` and a saved `dpad` both start as **Classic D-Pad**.
  The old key is left exactly as it was (not read again once the new key exists, never written, never deleted). `migrateLegacySteering` in
  `src/input/movementMode.ts` is that rule; the unit tests and the browser suite both check it.
- Changing mode from the pause menu changes no gameplay state. The touch layer lets go of every finger (so FIRE / LASER / BOOST cannot be
  held across the switch), the simulation sees a neutral command on the next frame, and resuming re-arms the ability keys as it always did.
  The run is not recreated: position, heading, lives, score, weapons, power-ups and time are untouched (the browser suite compares them).

## Code map

| File | What |
|---|---|
| `src/core/math.ts` | `shortestAngleDelta`, `turnToward`, `directionToHeading` |
| `src/core/player.ts` | `SteerRequest`, `PlayerInput.steer`, `PlayerState.travelHeading`, the two steering branches in `updatePlayer` |
| `src/core/constants.ts` | `TOUCH_STEER_TURN_SPEED`, `ASSIST_TRAVEL_TURN_SPEED` |
| `src/input/touchModel.ts` | `StickStyle`, directional command, dead zone with hysteresis |
| `src/input/touchControls.ts` | `setMovement(mode)` (`MOVEMENT_CONTROLS` maps a mode to a control and a stick style) |
| `src/input/movementMode.ts` | `MovementMode`, labels, `MovementController`, legacy migration (replaces `steeringMode.ts`) |
| `src/input/gamepadMapping.ts` | `mergeInputs` carries the stick request only while no key / pad is steering |
| `src/ui/menu/pages/controls.ts` | the MOVEMENT selector and the line that explains the lit mode |
| `tests/touchMovement.test.ts`, `tests/movementMode.test.ts` | unit tests (headings, shortest path, wrap, rate limits, comparative trajectories, walls, Boost, frame rates, dead zone, release, mode switching, migration) |
| `scripts/touch.mjs` ("Movement modes" section) | pointer-level browser tests, screenshots on three phone sizes |

## Real-device test (Samsung Galaxy S25)

Serve a **local** build over your LAN; do not deploy: `npm run build && npm run preview:lan`, then open `http://<your-PC-IP>:4173/` in
Chrome on the phone (same Wi-Fi). Landscape, and use Fullscreen if you like. (Add `?touch=1` if touch mode is not picked automatically.)

1. **Menus (2 min).** CONTROLS shows MOVEMENT with three large buttons and a one-line explanation of the lit one. Tap each; the line changes. Start a run with each.
2. **Pause switch.** In a run, tap PAUSE, CONTROLS, change mode, BACK, RESUME. Ship, score, lives, boost timer and laser count must be as you left them; the ship must not creep, shoot or boost by itself.
3. **Dead zone.** Rest a thumb on the stick area without pushing: nothing should happen. Wobble gently: still nothing.
4. **Directions.** In Point-to-Fly and Assisted, push up / right / down / left and the diagonals. The nose should swing to face the thumb, smoothly, never snapping or spinning the long way.
5. **Reversal.** Fly right, then flick left. Point-to-Fly arcs round (and briefly flies backwards); Assisted turns its flight round about twice as fast. Do the same in Classic for reference.
6. **Release.** Lift the thumb: the ship stops immediately in all three.
7. **Four fingers.** Stick + FIRE + LASER + BOOST together; lift FIRE only, then the stick only.
8. **Interruptions.** Hold the stick and switch app / pull down the notification shade / rotate to portrait: no stuck thrust afterwards.
9. **Comfort.** Note where your thumb lands, how far you must push, whether the 13-18 px dead zone catches you, and whether FIRE is still reachable while steering.

## Playtest protocol (friends and family)

No analytics, no telemetry, no survey backend: a person with a phone, a stopwatch and a notepad.

- **Task per mode:** play **two minutes**, trying to survive (and score what you can). Warm-up: 30 seconds in the mode first, ignoring the score.
- **Order:** rotate it so learning order washes out. With three modes there are six orders; give each tester the next one (A = Classic, B = Point-to-Fly, C = Assisted): ABC, BCA, CAB, ACB, CBA, BAC.
- **Switching:** pause, CONTROLS, tap the next mode, BACK, RESUME for a continued run; or start a new run each time (preferred, so everyone plays the same two minutes from the start).
- **After the three runs, ask:**
  1. Which mode felt most natural?
  2. Which mode gave you the best control?
  3. Which mode would you choose to play again?
- Write down: tester, order, mode, survived seconds, score, the three answers, any "I could not..." remark. A tally of the three answers decides the public default; scores are only a sanity check, since Assisted may well be easier to survive in.
- Please do not coach: read the one-line description under the mode name, nothing else.
