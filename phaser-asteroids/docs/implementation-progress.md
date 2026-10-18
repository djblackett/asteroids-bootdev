# Implementation progress

Phaser **4.2.1** · TypeScript 7.0.2 (strict) · Vite 8.3.4 · Vitest 5.0.5. Last updated 2026-10-18.

## Milestones

| # | Milestone | Status |
| - | --------- | ------ |
| 1 | Project foundation (Vite + TS + Phaser 4, 1280×720 FIT scaling, scenes, procedural rendering, input) | Done |
| 2 | Player movement (orientation, rotation, non-inertial thrust, wall clamp + bounce, thruster / spark visuals) | Done |
| 3 | Shooting and asteroids (cooldown, despawning shots, edge spawner, splitting, armored archetype, scoring) | Done |
| 4 | Basic loop (lives, damage, respawn + invulnerability, HUD, game over, restart, difficulty ramp, starfield, pause, auto-pause) | Done |

## Verification performed

- `npm run typecheck`, `npm test` (124 tests, 5 files) and `npm run build`: all pass.
- Installed engine confirmed as Phaser 4.2.1 (`node_modules/phaser/package.json`, and the runtime banner
  `Phaser v4.2.1 (WebGL | Web Audio)`). All Phaser calls compile against the 4.2.1 typings.
- Real browser (Chrome 155 headless,
  WebGL via SwiftShader, scripted with playwright-core from outside the repo): production build **and**
  dev server load without console errors; WebGL renderer; start → play → pause/resume → blur / hidden auto-pause →
  lose lives → respawn → game over → R / click RETRY → ESC to menu → start again; 7 consecutive restarts add no
  listeners and do not grow the display list; canvas stays 16:9 and centred at 800×600, 1920×500 and 600×900
  while the logical size stays 1280×720; 45 s of random bot play with the real spawner (≤16 asteroids, ≤5 shots,
  ~60 fps, no errors); all 7 sound files decode.
- Game clock vs wall clock measured in the browser: 1.00 at 60 fps, 0.99 at ~31 fps (CPU-throttled).
- Screenshots were inspected by eye (start screen, thrust, rotation, shooting, wall hit, pause, game over).

Not verified: Firefox / Safari, a physical GPU, 120/144 Hz displays (covered by unit tests only), touch devices,
audible playback (assets decode and the calls raise no errors, but no one listened).

## Intentional differences from the Python game

Fixes requested in the brief:

1. **Shots despawn** once more than 50 px outside the playfield (Python never removes missed shots).
2. **Starfield parallax** is driven by how far the ship actually moved (including wall bounce), at 1.0 camera px per
   ship px; layers move at 0.1 / 0.3 / 0.5 of that. Python fed it `player.velocity`, which is zero in normal flight.

Other deviations:

3. **Exhaust and wall-spark direction.** Python computes the particle heading with `angle_to`, which mirrors it
   horizontally (exhaust shoots out of the nose when flying sideways; wall sparks fly into the wall). The port emits
   along the intended direction. Spark bursts are limited to 60/s so they do not scale with refresh rate.
4. **Time handling.** Variable timestep from raw frame timestamps (not Phaser's smoothed `delta`, which is clamped to
   1/60 s for 120 frames after boot/wake and would slow slow-display play). Frames are clamped to 0.1 s and split
   into ≤1/30 s sub-steps so shots cannot tunnel through small asteroids. Bounce damping is
   `0.85^(dt·60)`; recovery distance matches Python at 60 FPS (16.7 px) and stays within 10 % at 30–240 FPS.
5. **Combo multiplier not implemented** (deferred), so chained kills score less than in Python (which goes up to 3×).
   Base values, archetype multipliers and bonuses match (`int(base × mult + bonus)`).
6. A dying asteroid cannot absorb a shot on the same frame it starts dying (Python can).
7. The 0.2 s "no shooting" grace period also applies after a restart (Python only applies it on first start).
8. Single player only: start at the screen centre (as Python's 1P mode), respawn at (320, 360). Arrow keys work
   as an alternative to WASD.
9. HUD and screens are simplified: `P1: score`, `Lives`, MM:SS clock; game over shows the score and RETRY. No
   high-score list.
10. Screen shake offsets the playfield layer (stars and HUD do not shake), like Python, rather than using the camera.
11. Only shoot / explosion / player-death sounds; no music.
12. Font is the browser monospace instead of Pygame's default font.

Original quirks deliberately **kept**:

- **Only large asteroids ever enter the field.** Edge spawns sit exactly 60 px outside the screen, so radius-20 and
  radius-40 spawns already satisfy the "fully off-screen" despawn test on their first update and vanish
  (confirmed by running the Python code: 0 of ~1000 small/medium spawns survive). The effective spawn rate is
  about a third of the nominal one. Covered by a test; see "Next steps" for the decision it needs.
- The wall clamp / bounce only runs while the ship is being driven.
- Hitting a rock while respawn-invulnerable still destroys the rock (no score, no life lost).
- Volatile asteroids exist in the data but have spawn weight 0.

## Known defects / caveats

- Phaser 4.2.1's `fps.limit` / `TimeStep.setFPSLimit` path over-reports `delta` (1.4–1.6× real time in a 2 s test), so do not
  use `fps.limit` for throttling; the unlimited path is exact.
- Below ~10 fps the game runs in slow motion because frames are clamped at 0.1 s (by design).
- Phaser is bundled in full (1.37 MB, 357 KB gzip). A custom Phaser build could shrink it.
- The canvas is 1280×720 CSS-scaled; on very large or HiDPI windows line art is slightly soft.
- No browser regression tests live in the repo (that would add Playwright as a dependency); the scripted checks
  described above were run ad hoc.

## Not implemented yet (deferred by the brief)

Two-player co-op, UFOs, laser beam, boost / ramming, the six power-ups, combo multipliers, kill-streak banners,
wave mode, full audio system and music, death taunts, elaborate particles, high-score screen, gamepad, touch,
online leaderboards.

## Next steps

1. **Decide on the spawn quirk** (above): keep the original difficulty, or spawn at `-radius` so all three sizes appear
   (≈3× more asteroids at the same spawn rate; tune `ASTEROID_SPAWN_RATE` to taste).
2. Scoring module with combo multiplier + kill streaks (replace the inline `player.score += points` in
   `GameSim.collideShotsWithAsteroids`), then HUD display.
3. Power-ups and UFOs: add entity arrays and events to `GameSim`; the player state already has the cooldown /
   respawn hooks they need.
4. Two players: turn `player` into an array, add a second `KeyScheme` (arrows + Enter), shared-lives mode.
5. High scores in `localStorage`, then an audio manager (music, rate changes) and gamepad / touch via `PlayerInput`.
6. Optionally add Playwright smoke tests to CI.
