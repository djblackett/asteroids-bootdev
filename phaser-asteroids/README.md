# Asteroids — Phaser 4 / TypeScript port

Browser version of the Python/Pygame game in the repository root. The Python code is the reference for
gameplay; this folder is self-contained and does not touch it.

- Phaser **4.2.1** (pinned, stable), TypeScript (strict), Vite, Vitest.
- 1280×720 logical playfield, scaled to the window with the aspect ratio preserved.
- Keyboard, gamepad **and touchscreen** (landscape phone prototype, one player): see [docs/mobile-touch.md](docs/mobile-touch.md).
- Everything on screen is drawn procedurally; the only assets are the music and 9 sound effects copied from
  `../music` and `../sound-effects`, and the favicon.

## Run it

Requires Node.js 20.19+ or 22.12+ (Vite 8's requirement; developed on Node 22.14).

```bash
cd phaser-asteroids
npm install

npm run dev        # dev server with hot reload, http://localhost:5173
npm test           # unit tests (Vitest, no browser needed)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ at http://localhost:4173
npm run preview:lan   # same, listening on the network so a phone on your Wi-Fi can open it (see docs/mobile-touch.md)
npm run test:browser  # build, then drive it in headless Chrome (needs Chrome/Edge installed; see below)
npm run test:input    # build, then real-browser keyboard tests: simultaneous keys, pause / retry / blur with keys held
npm run test:combat   # build, then real-browser tests of combos, kill-streak banners and UFOs (same Chrome requirement)
npm run test:coop     # build, then real-browser two-player tests: both players on one keyboard, lives, friendly fire, Revive, HUD
npm run test:gamepad  # build, then real-browser tests with a SIMULATED gamepad (keyboard + controller co-op, hot-plug, focus, pause, restart)
npm run test:touch    # build, then real-browser touch tests: genuine multi-touch (4 fingers), joystick and D-pad, fullscreen (scripted API + real), mobile viewports, portrait prompt, pause / retry, input-mode switch
npm run test:pages    # build, then check the production build at the Pages URL path and at / (the deployment gate)
```

`npm run test:browser` uses `playwright-core` (dev dependency, no browser download) with a locally installed Chrome,
Edge or Chromium; set `CHROME_PATH` if it is not in a standard location. It starts its own preview server and
writes screenshots to `scripts/.smoke-output/`.

Append `?debug` to the URL to expose the Phaser game as `window.__game` (e.g.
`__game.scene.getScene('GameScene').sim` is the live game state).

Append `?keydebug` to show a keyboard diagnostic panel (raw browser key events, the keys the game thinks are held,
the exact `PlayerInput` handed to the simulation, and a verdict). Use it to check whether a key combination that
"doesn't work" ever reaches the browser; it is off unless the URL asks for it.

The panel keeps a rolling ~10 s history (timestamped raw keydown / keyup events, held keys, and the input handed to
`GameSim.step()`). **Freeze Capture** preserves the history and current state so you can release the keys and take
screenshots; **Copy Diagnostic Report** copies a text report (the frozen one if frozen); **Clear Capture** discards it
and resumes. Nothing is cleared by releasing keys or blurring the window. With a controller connected the same panel also lists each
controller's mapping, raw axes / buttons, the normalised command and which player receives it (bounded: 4 pads, a few lines each).

## Deployment

Pushes to `main` publish the game to GitHub Pages at <https://djblackett.github.io/asteroids-bootdev/> via
GitHub Actions. `npm run test:pages` builds and checks the production build at the Pages URL path and at `/`. Setup,
what blocks a deploy, troubleshooting, rollback, gamepad checks and the custom-domain steps are in
[docs/deployment.md](docs/deployment.md).

## Controls

| Key | Action |
| --- | --- |
| W / S (or ↑ / ↓) | Move forward / backward |
| A / D (or ← / →) | Rotate left / right |
| Space | Shoot |
| E | Laser beam (15 charges, 1 s cooldown) |
| Shift | Boost (3 s, 8 s cooldown; rams asteroids, no shooting) |
| M | Mute / unmute music |
| ↑ / ↓, ← / → (while paused, or on the title screen) | Select Music or SFX, lower / raise it in 10 % steps. Saved in the browser. |
| P | Pause / resume (also happens automatically when the tab or window loses focus) |
| R, Enter, or click RETRY | Restart after game over (after a 1.5 s delay) |
| Esc | Back to the title screen (while paused or on the game-over screen) |

### Two players, one keyboard

Press **2** on the title screen (**1** goes back to the classic game). With two players the title screen also offers
**L** (independent / shared lives), **F** (friendly fire on / off), **K** (Player 2's keys) and **S** / **D**
(Player 1 / Player 2 speed handicap). Controls, as in the Python game, except Player 2's boost (see below):

| | Player 1 | Player 2 (arrows) | Player 2 (alternative, press K) |
| --- | --- | --- | --- |
| Forward / back | W / S | ↑ / ↓ | I / K |
| Rotate left / right | A / D | ← / → | J / L |
| Shoot | Space | Enter | ; |
| Laser Beam | E | Right Shift | U |
| Boost | Left Shift | . (period) | O |

P pauses, M mutes, R retries after game over (Enter does too, but only in a one-player game, since Enter is Player 2's
cannon). Python uses Right Ctrl for Player 2's boost; in a browser Ctrl + W closes the tab (Player 1 holds W all the time)
and a page cannot stop that, so it is `.` here. If the arrow cluster ghosts on your keyboard, press **K** for the I J K L layout.

### Gamepad (Xbox-style; any browser "standard" mapping)

The usual setup is **Player 1 on the keyboard, Player 2 on a controller**, as in the Python game. Plug the controller in, press a
button on it (browsers only reveal a controller after a press), choose **2** players, and press **A** on the controller: it joins
as Player 2 (the status line at the bottom left of the title screen says so). **LB** gives it to Player 1, **RB** to Player 2
(also **G**, or a click on its line, to cycle). **C** (or **Y** on the pad) shows the controller layout. A player with a controller
keeps their keyboard keys too; where both push the same axis the keyboard wins, buttons are OR-ed.

| Control | Action |
| --- | --- |
| Left stick left / right | Rotate (analogue: a light push turns slower; dead zone 0.15, as in Python) |
| Left stick up / down | Forward / backward (analogue) |
| D-pad | Same as the stick, only while the stick is centred (browser addition) |
| RT (hold) or A | Shoot (continuous) |
| X | Laser Beam (once per press) |
| B | Boost (once per press) |
| START | Pause / resume |
| BACK | Main menu (while paused or on the game-over screen) |
| A | Retry after game over; join / start on the title screen |
| D-pad on the title screen | Left / right = 1 or 2 players; on the pause screen it adjusts the volumes |

A controller that is unplugged during play pauses the game and names the player; plugging it back in returns the ship to the pad.
Buttons held when a controller connects, the window regains focus, or a run (re)starts are ignored until released. Details and the
recovered Python mapping are in `docs/implementation-progress.md` (Phase 5).

### Touchscreen (phone / tablet prototype, one player, landscape)

On a device whose primary pointer is a finger the game starts in touch mode (`?touch=1` / `?touch=0` forces it; the CONTROLS button on the
title screen switches and remembers). Left side: your choice of a floating joystick (drag anywhere; left / right rotates, up / down flies, proportional
with the controller's dead zone) or a digital **D-pad** (up = forward, down = back, left / right turn, corners do both with one thumb); pick it with the
**STEERING: JOYSTICK | D-PAD** buttons on the title and pause screens (remembered). A **FULLSCREEN** button (title and pause screens) hides the browser's
address bar where the browser allows it; on iPhone Safari, which does not, it offers a short Add-to-Home-Screen tip instead. Right side: **FIRE** (hold; works while steering), **LASER** (tap) and **BOOST** (tap); **PAUSE** top right.
Menus, pause, volume and game over all work by touch. In portrait a "Rotate your phone to play." prompt covers the game and pauses it.
Desktop keyboard, controller and two-player play are unchanged. It has been tested in Chromium's touch emulation only: layout, input
mapping, lifecycle rules, browser tests, what to check by hand on Android Chrome and iPhone Safari, and the known issues are in
[docs/mobile-touch.md](docs/mobile-touch.md); a possible future installed-web-app configuration is sketched in [docs/standalone-web-app.md](docs/standalone-web-app.md).

## Layout

```
src/
  core/      Pure gameplay rules. No Phaser imports, so it runs (and is tested) in plain Node.
    constants.ts  math.ts  rng.ts       ported constants, Pygame-convention vector maths, injectable RNG
    player.ts  shot.ts  asteroid.ts     entity state + rules (power-up timers, boost and laser live on the player)
    powerup.ts  laser.ts                pick-ups and drop odds; the laser ray and its hit test
    scoring.ts                          combo multiplier / 3 s window, kill-streak milestones and banner animation curves
    ufo.ts                              large and small UFOs: wandering, aiming, shots, spawn schedule
    spawner.ts  particles.ts  starfield.ts
    game.ts                             GameSim: one run of the game (1 or 2 players); step(dt, input, input2) -> events
    gameConfig.ts                       players / lives mode / friendly fire / speed handicaps chosen on the title screen
  scenes/    Boot (load audio) -> Start (title) -> Game (glue: input, sim.step, draw, overlays)
  render/    Procedural drawing into two reusable Graphics objects (stars, playfield)
  input/     Held keys (by KeyboardEvent.code), gamepads (GamepadHub, gamepadMapping) and touch (touchModel, touchBinding, touchControls, inputMode, steeringMode, fullscreen) -> the same PlayerInput; one-shot key dispatcher; ?keydebug diagnostics
  audio/     Pure logic (event -> sound, music state machine, volume settings, mix config) + one Phaser adapter (`AudioDirector`)
  ui/        HUD, pause / game-over overlays, the Music / SFX volume panel, the title screen's controller status; touch: DOM overlay (touchOverlay.ts, systemOverlay.ts, touch.css) and touch menus
tests/       Vitest suites for src/core and src/audio (no browser, no audio device)
  gameSetup.ts  The title screen's choices (kept in the Phaser registry); the game scene builds a fresh GameSim from them
scripts/     smoke.mjs: browser smoke test; keyboard.mjs: real-browser keyboard tests; combat.mjs: combo / banner / UFO tests;
             coop.mjs: two-player tests; gamepad.mjs: keyboard + simulated-gamepad co-op tests; touch.mjs: multi-touch / mobile-viewport tests
docs/        implementation-progress.md, deployment.md, mobile-touch.md, standalone-web-app.md
```

Design rule: gameplay lives in `src/core` and is driven only by `GameSim.step(dt, input)`; Phaser is used for
rendering, input, audio, scenes and scaling. Adding a feature means extending the sim (with tests) and then
drawing it.

## Conventions worth knowing

- **Rotation** follows Pygame's `Vector2(0, 1).rotate(angle)`: 0° = Down, 90° = Left, 180° = Up, 270° = Right.
  All thrust, shots and ship geometry go through `getForwardVector` in `src/core/math.ts`.
- **Time**: movement and timers use seconds; per-frame constants from the Python code (the `0.85` bounce damping)
  are converted with `timeNormalizedDamping`. Frames longer than 0.1 s are clamped and anything over 1/30 s is
  split into sub-steps.
