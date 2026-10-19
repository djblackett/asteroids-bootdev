# Asteroids — Phaser 4 / TypeScript port

Browser version of the Python/Pygame game in the repository root. The Python code is the reference for
gameplay; this folder is self-contained and does not touch it.

- Phaser **4.2.1** (pinned, stable), TypeScript (strict), Vite, Vitest.
- 1280×720 logical playfield, scaled to the window with the aspect ratio preserved.
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
npm run test:browser  # build, then drive it in headless Chrome (needs Chrome/Edge installed; see below)
npm run test:input    # build, then real-browser keyboard tests: simultaneous keys, pause / retry / blur with keys held
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
and resumes. Nothing is cleared by releasing keys or blurring the window.

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

## Layout

```
src/
  core/      Pure gameplay rules. No Phaser imports, so it runs (and is tested) in plain Node.
    constants.ts  math.ts  rng.ts       ported constants, Pygame-convention vector maths, injectable RNG
    player.ts  shot.ts  asteroid.ts     entity state + rules (power-up timers, boost and laser live on the player)
    powerup.ts  laser.ts                pick-ups and drop odds; the laser ray and its hit test
    spawner.ts  particles.ts  starfield.ts
    game.ts                             GameSim: one run of the game; step(dt, input) -> events
  scenes/    Boot (load audio) -> Start (title) -> Game (glue: input, sim.step, draw, overlays)
  render/    Procedural drawing into two reusable Graphics objects (stars, playfield)
  input/     Held keys (by KeyboardEvent.code) -> PlayerInput; one-shot key dispatcher; ?keydebug diagnostics
  audio/     Pure logic (event -> sound, music state machine, volume settings, mix config) + one Phaser adapter (`AudioDirector`)
  ui/        HUD, pause / game-over overlays, the Music / SFX volume panel
tests/       Vitest suites for src/core and src/audio (no browser, no audio device)
scripts/     smoke.mjs: browser smoke test; keyboard.mjs: real-browser keyboard tests
docs/        implementation-progress.md
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
