# Asteroids — Phaser 4 / TypeScript port

Browser version of the Python/Pygame game in the repository root. The Python code is the reference for
gameplay; this folder is self-contained and does not touch it.

- Phaser **4.2.1** (pinned, stable), TypeScript (strict), Vite, Vitest.
- 1280×720 logical playfield, scaled to the window with the aspect ratio preserved.
- Everything on screen is drawn procedurally; the only assets are 7 sound effects copied from `../sound-effects`
  and the favicon.

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
```

Append `?debug` to the URL to expose the Phaser game as `window.__game` (e.g.
`__game.scene.getScene('GameScene').sim` is the live game state).

## Controls

| Key | Action |
| --- | --- |
| W / S (or ↑ / ↓) | Move forward / backward |
| A / D (or ← / →) | Rotate left / right |
| Space | Shoot |
| P | Pause / resume (also happens automatically when the tab or window loses focus) |
| R, Enter, or click RETRY | Restart after game over (after a 1.5 s delay) |
| Esc | Back to the title screen (while paused or on the game-over screen) |

## Layout

```
src/
  core/      Pure gameplay rules. No Phaser imports, so it runs (and is tested) in plain Node.
    constants.ts  math.ts  rng.ts       ported constants, Pygame-convention vector maths, injectable RNG
    player.ts  shot.ts  asteroid.ts     entity state + rules
    spawner.ts  particles.ts  starfield.ts
    game.ts                             GameSim: one run of the game; step(dt, input) -> events
  scenes/    Boot (load audio) -> Start (title) -> Game (glue: input, sim.step, draw, overlays)
  render/    Procedural drawing into two reusable Graphics objects (stars, playfield)
  input/     Keyboard -> PlayerInput
  audio/     Sim events -> sound effects
  ui/        HUD and pause / game-over overlays
tests/       Vitest suites for the rules in src/core
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
