# Implementation progress

Phaser **4.2.1** · TypeScript 7.0.2 (strict) · Vite 8.3.4 · Vitest 5.0.5 · playwright-core 1.64.1 (dev only, for the
browser smoke test). Last updated 2026-10-18.

## Status

| Phase | Scope | Status |
| ----- | ----- | ------ |
| 1 | Foundation, player movement, shooting, asteroids, lives / respawn / game over / restart, HUD, starfield, pause | Done |
| 2 | Music and sound effects, six-type power-up system (Revive deferred), laser beam, boost, combined-ability testing | Done |

## Phase 2: what was added

### Audio (`src/audio/`)

- **Music**: `retro-bgmusic.ogg`, looped, volume 0.5, started on the first key press / click (the browser keeps audio
  locked until then) and shared by every scene, so it is never restarted or duplicated. Paused with the game
  (P, blur, hidden tab, menu overlays) and by the new M mute toggle (remembered in `localStorage`).
- **Effects**: shot (random of 3 variants, vol 0.4), explosions by asteroid size (small / medium / large), player
  death, laser (0.7), boost. At most 3 copies of the same explosion play at once, as in Python. One shot sound
  per trigger pull (Multi-Shot's three bullets share one). Sound objects are created per cue and destroyed on completion.
- The decision logic is pure and unit tested (`cueForEvent`, `SfxPlayer`, `MusicController`); only
  `phaserAudio.ts` touches Phaser. Phaser's own pause-on-blur is switched off and replaced by the controller.
- **Python facts**: the only files used are the music file, shoot_low/mid/high, explosion_small/medium/large,
  laser, boost-woosh and player-death. `enemy-ship*.ogg`, `laser2.ogg`, `boost-woosh2.ogg`, `shoot_01.ogg` and
  `big-explosion.ogg` are unused or source material. Python plays **no** sound for wall hits, armored-asteroid
  hits, pick-ups, power-up expiry or game over; the port is silent there too.
- **Mega Power music**: Python can speed the music up by 1.26 (re-initialising the mixer, which changes speed and
  pitch together) but ships it **disabled** (`MEGA_POWER_MUSIC_SPEEDUP_ENABLED = False`) and skips it on the web.
  The port implements it with the track's playback rate (same speed + pitch change, same track, no restart) and
  keeps it **off by default**; set `MEGA_POWER_MUSIC_SPEEDUP_ENABLED` in `src/audio/audioConfig.ts` to turn it on.

### Power-ups (`src/core/powerup.ts`, `player.ts`, `game.ts`)

- **Drops**: only when a shot, laser or boost ram *kills* an asteroid (not a non-lethal armored hit, not an asteroid
  that crashed into the ship): 1.5 % Mega Power, else 8 % one of Rapid Fire / Shield / Multi-Shot / Slow Motion
  (≈9.4 % overall). Pick-ups: radius 15, drift 30 px/s in a random direction, wrap at screen edges, vanish after 12 s.
- **Rapid Fire** 5 s, cooldown 0.3 → 0.1 s. **Multi-Shot** 8 s, three shots at −15 / 0 / +15°, normal cooldown.
  **Shield** until hit (respawn invulnerability is checked first and does not use it up; a shield-absorbed hit still
  destroys the rock but scores nothing and plays no death sound). **Slow Motion** 6 s, asteroids move at 40 %
  and **nothing else** does (spawner, shots, pick-ups, ship, cooldowns and timers use real time). Re-collecting
  restarts a timer; it never stacks.
- **Mega Power** 6 s: sets Rapid Fire + Multi-Shot (their own timers pause), a Shield, and Slow Motion = 6 s. When it
  ends it switches **Rapid Fire and Multi-Shot off unconditionally, even ones collected separately**, and leaves the
  shield. This is how Python behaves and is reproduced (and tested), not "fixed".
- Losing a life clears Rapid Fire / Multi-Shot / Mega / shield / boost (Slow Motion is global and stays).
- **Revive — deferred.** Python: a Revive pick-up (radius 15, 15 s life, blinks white in the last 3 s, green cross icon)
  respawns a dead teammate with 3 lives when the *other* player collects it; collected with nobody to revive it is
  just consumed. Its spawn constant (`REVIVE_SPAWN_CHANCE = 0.3`) is **never used by Python**, so Revive pick-ups
  never appear in the original either. The port only has the type, its lifetime, icon, and the "consumed with no
  effect" path; real revive logic belongs with two-player mode. There is no fake single-player version.
- Visuals: the five icons are ported from `PowerUp.draw`; ship colour by state (rainbow Mega, magenta boost, yellow
  Rapid Fire, orange Multi-Shot; respawn flash wins); pulsing cyan shield ring; HUD lines under the lives counter
  (`LASER n/15`, boost state, then a rainbow Mega line *or* individual power-up countdowns); the title screen lists
  the controls and power-ups. Added (not in Python): a short expanding ring where a pick-up was collected.

### Laser beam and boost

- **Laser**: key E, once per press (a press refused during cooldown is still used up — release and press again),
  15 charges per game (not refilled on respawn), 1 s cooldown, 0.3 s beam from the ship's nose to the screen edge.
  Distance test is point-to-segment with the projection clamped (so asteroids just past the beam end count), hits
  every asteroid it touches **once** per beam; an armored asteroid takes one hit per beam. Children spawned into a
  still-live beam are new objects and get hit too (Python does this). Also usable while boosting. Glow / beam /
  core fade to black over the beam's life.
- **Boost**: key Shift, once per press, 3 s at ×2.5 speed, cooldown 8 s that **starts at activation**, no cannon while
  boosting, three trailing rings, pulsing yellow warning ring for the last second. Ramming is resolved before any
  damage logic: asteroids are hit as if shot (full points, drops possible) and the ship takes no damage, uses up no
  shield and wastes no respawn protection. An armored asteroid absorbs the first contact frame and breaks on the next.
  As in Python, boost activates after movement in the same frame, so the first frame is still normal speed.

## Verification performed (2026-10-18)

- Baseline at the start of the pass: 124 tests, typecheck and build passed; tree clean at commit `8b4395d`.
- Now: `npm run typecheck` clean, **318 unit tests in 13 files** (up from 124), `npm run build` OK,
  `npm run test:browser` **50/50 checks** and `npm run test:input` **49/49 checks** (see below). The original Python project is unmodified.
- Unit tests added: drop probabilities (controlled RNG and 200k-roll statistics), each power-up's duration, expiry,
  re-collection and frame-rate independence, Multi-Shot geometry at 0/90/180/270/33°, shield rules, Slow Motion scope,
  Mega Power overlap cases, laser geometry / charges / cooldown / piercing / armored / children, boost activation /
  cooldown / ramming / priority, event→sound mapping, explosion limiter, sound frequency against real gameplay,
  the music state machine (pause, blur, mute, restart, Mega speed-up on and off), the one-shot key dispatcher, and an 8-simulated-minute fuzz at
  30, 60 and 144 fps with random input, random pick-ups and restarts checking invariants on every step.
- **Browser smoke test** (`scripts/smoke.mjs`, Chrome 155 headless, software WebGL, production build, default
  autoplay policy): WebGL start-up; audio starts locked and the first key press unlocks it and starts exactly one music
  instance; movement; shot kills and a forced power-up drop; all five power-ups collected and shown in the HUD;
  Mega Power expiry rules; laser (charge spent, piercing, cooldown, fade); boost (speed, ramming, cooldown HUD);
  pause / blur / focus / unpause music behaviour; M mute + persistence; 6 s of heavy fire under Mega Power (avg frame
  16.8 ms, sound objects ≤ 6, entities bounded); three game-over → restart cycles with effects active (clean state,
  still one music instance, no listener build-up); 12 rapid P-then-Escape presses and a held (auto-repeating) P; menu round trip; scaling; no `window.__game` without `?debug`.
- Screenshots inspected by eye: title screen with power-up legend, pick-ups on the field, laser, boost trail and warning ring, Mega Power.

## Keyboard input regression pass (2026-10-18)

Report: playtesting felt like keys were sometimes lost (backward + turn moving without turning, forward + turn
blocking the cannon), which the Python game did not do.

### Diagnosis

1. **Held keys were forgotten at scene boundaries and on pause (application bug, reproduced).** Gameplay polled
   Phaser's per-scene `Key` objects. They are rebuilt whenever a scene starts, and `togglePause()` / blur called
   `resetKeys()`. A browser never re-announces a key that is still down (OS auto-repeat only repeats the *most recently
   pressed* key), so after **unpause, retry, or starting from the title screen with a key held, the held keys were
   invisible until released and pressed again**. Reproduced on the original code in a real browser: hold W + D, pause and
   unpause -> `W=false D=false` while both were still down; same after Retry. Re-introducing the old behaviour makes 7
   browser checks fail with `moved=0`.
2. **The one-shot dispatcher was not the cause.** `createKeyPressDispatcher` only listens to Phaser's `ANY_KEY_DOWN` for
   P / M / Esc / R / Enter / Space; gameplay never went through it. Measured in Chrome: Phaser's key queue is cleared
   every frame (it does not grow), and a 600-operation random key fuzz (7 keys, 0-25 ms gaps, compared against the true
   held set) found **0 mismatches** in Phaser's `Key` state. Every WASD / Space / E / Shift combination from the report
   reached `GameSim.step()` correctly.
3. **The simulation has no mutually exclusive input logic.** `updatePlayer` mirrors Python: rotate, move, shoot, laser and
   boost are independent. Python's one real restriction is kept: **no cannon while boosting** (`Player.shoot`), plus a
   short no-fire window at the start of a run. An accidental Shift press therefore looks exactly like "forward + turn
   blocks shooting" for the 3 s of a boost.
4. **What software cannot fix.** A physical keyboard that cannot report a combination (rollover / ghosting) never delivers
   the key to the browser. Space plus two direction keys is a classic ghosting triple on cheap membrane keyboards, and
   Windows Sticky / Filter Keys can swallow quick presses. The new `?keydebug` panel shows whether each key arrives.

The exact two-key symptom ("S + turn moves but does not turn") could **not** be reproduced in software. The confirmed software
defect is #1, which gives the same "the ship ignores keys I am holding" feel after a pause, retry or blur.

### Changes

- `src/input/heldKeys.ts` (new): `HeldKeys`, one game-wide set of held `KeyboardEvent.code`s fed by window `keydown` / `keyup`.
  Never reset by pause, retry or scene changes; cleared only when the browser stops reporting releases (window blur, hidden
  tab, macOS Cmd release). Auto-repeat is harmless. Using `code` also keeps keys working under an IME.
- `src/input/keyboardControls.ts`: now a pure `readPlayerInput(held, scheme)`; every control is checked independently and only
  opposing keys share a result (later check wins, as in Python). `SOLO_KEYS` uses `code` names, so non-QWERTY layouts use
  the same physical positions.
- `src/input/gameKeys.ts` (new): installs `HeldKeys` once from `BootScene`; removes its listeners when the game is destroyed.
- `GameScene`: reads `HeldKeys`; no longer calls `resetKeys()` on pause / blur; still captures Space and the arrows so the
  page does not scroll; a laser / boost key already down when a run starts or play resumes is marked "used", so a held E /
  Shift does not fire a surprise laser or boost (they fire once per *press*, as in Python).
- `src/input/keyDiagnostics.ts` (new) behind `?keydebug`: a panel with (1) raw browser events (`code`, `repeat`, held set, peak
  simultaneous keys), (2) the game's held set and Phaser's own key state, (3) the `PlayerInput` passed to `GameSim.step()`,
  (4) boost lock-out and cannon cooldown, and a verdict naming the first stage that goes wrong; also logs `[keydebug]` to the
  console. Off unless the URL contains `keydebug`; the panel and its listeners are removed when the game scene shuts down.
- The one-shot dispatcher (`keyPress.ts`) is unchanged.

### Diagnostics: history, freeze and copy (follow-up)

The live panel changed as soon as keys were released or a screenshot shortcut was pressed, erasing the evidence. It now has:

- **Rolling history** (`HISTORY_WINDOW_MS` = 10 s, hard cap `HISTORY_MAX_ENTRIES` = 1500, oldest dropped first): every raw
  keydown / keyup (`KeyboardEvent.code`, `repeat`, raw held set after it, `performance.now()` timestamp), window blur / focus
  notes, and an `INPUT` entry whenever the held keys or the `PlayerInput` handed to `GameSim.step()` change (not one per
  frame, so it stays small).
- **Freeze Capture**: stops recording and preserves the history and the four-stage state/verdict exactly as at the click.
  Releasing keys, a screenshot shortcut, blur or Esc afterwards cannot change the frozen text (it is also scrollable /
  selectable). The raw held set keeps following the real keyboard underneath, so it is correct as soon as you clear.
- **Copy Diagnostic Report**: copies the frozen report (or a fresh one when live) with capture time, page URL and user agent;
  falls back to `execCommand` where the async Clipboard API is unavailable, and says "Copied!" or "Copy failed".
- **Clear Capture**: the only thing that discards a capture and resumes recording.
- Lightweight: text refreshed at 10 Hz (not per frame), frozen text written once, no allocation beyond small history entries.
  Measured 16.6 ms average frame with and without the panel (3 keys held, software WebGL). Buttons are not focusable and
  ignore mouse-down focus, so Space can never "press" them mid-game. Gameplay code is untouched; still off unless `?keydebug`.
- Tests: 8 more unit tests (history, change-only state entries, 10 s window, entry cap, freeze immutability, explicit clear,
  report format) and 13 more browser checks in `npm run test:input` (now 49): buttons present, no focus theft, freeze
  survives release + Win/Shift+S-style keys + blur, clipboard content equals the frozen report, clear resumes, 10.6 s-old
  event dropped, bounded entries, frame time.

### Tests

- `tests/simultaneousInput.test.ts` (new): every W/S x A/D combination with and without Space, arrow keys, movement + laser,
  movement + boost, the boost cannon lock-out, release-one-key-keep-the-rest, laser / boost once per press, auto-repeat,
  pause, a key released during pause, blur and recovery, hidden tab, Cmd release, listener add / remove, replayed events.
- `tests/keyDiagnostics.test.ts` (new): the opt-in gate and the stage-by-stage verdicts.
- `scripts/keyboard.mjs` / `npm run test:input` (new, 36 checks at first, 49 with the follow-up, real Chrome, production build): the same combinations with
  genuine browser key events, 2.5 s of held forward + turn + Space, pause / unpause with keys held, release during pause, E held
  across resume, blur and tab hiding, 3 retries with keys held, title screen -> game with a key held, no listener build-up (net
  `keydown` / `keyup` / `blur` listeners on `window` identical before and after), P then Esc with W held, and diagnostics
  absent normally but correct and removed with `?keydebug`.
- `test:browser` (smoke) is still 50/50 and the original 259 unit tests still pass.
- **Limitation:** Playwright delivers every key it is asked to. These tests prove the software path loses nothing; they cannot
  show physical-keyboard rollover limits.

### Manual checks on a real keyboard

Open the game with `?keydebug` and hold, watching line 1 ("raw browser held"): `W+A+Space`, `W+D+Space`, `S+A+Space`,
`S+D+Space`, `W+A+Space+E`, `W+D+Shift`, and the same with the arrow keys. A key that never appears on line 1 is not being
delivered by the keyboard / OS. If Space is the one that disappears, a different shoot key is the practical hardware
workaround (e.g. `J` / `K` / Enter; a small change to `SOLO_KEYS`). Also check: pause with movement keys held and resume;
retry with keys held; alt-tab away and back (keys must not stick).

## Needs a human listener

Playback succeeds in tests, but whether it *sounds right* is unverified:

1. Overall balance of shots (0.4) / explosions (1.0) / laser (0.7) / boost (1.0) / death (1.0) against the music (0.5). These are the
   Python desktop values; the Python web build leaves shots at 1.0, so shots may want adjusting.
2. Whether the three shot variants and three explosion sizes sound as varied as the desktop version's pitch-shifted
   samples (the port uses the pre-processed web files).
3. Overlap behaviour with the 3-explosion limit during laser sweeps, and that music pause / resume has no audible click.
4. The Mega Power speed-up (1.26×), only if you enable it.
5. Audio unlock on browsers other than Chrome (Safari in particular).

## Intentional differences from the Python game

Phase 1 fixes: shots despawn 50 px outside the playfield; starfield parallax follows the ship's real movement.

Other deviations:

1. Exhaust / wall-spark directions follow the intended heading (Python mirrors them horizontally via `angle_to`);
   sparks are limited to 60 bursts/s.
2. Variable timestep from raw frame timestamps (Phaser's smoothed `delta` is clamped for 120 frames after boot/wake);
   frames are clamped to 0.1 s and split into ≤1/30 s sub-steps. Bounce damping is `0.85^(dt·60)`.
3. **Combo multiplier and kill streaks still deferred**, so chained kills score less than in Python (up to 3×).
4. A dying asteroid cannot absorb a shot on the frame it starts dying; the 0.2 s no-shooting grace applies after restarts too.
5. Single player only: start at the screen centre, respawn at (320, 360); arrow keys work as well as WASD.
6. HUD simplified (`P1`, `Lives`, clock, ability lines); no high-score list; browser monospace font.
7. Screen shake offsets the playfield layer (stars and HUD stay put) rather than using the camera.
8. M toggles music mute at any time (Python only while paused); a mute preference is remembered.
9. Added a brief pick-up flash ring; Python has no pick-up feedback or sound beyond the HUD and ship colour.
10. Shield-absorbed collisions play the explosion but not the death sound (Python plays death only when a life is lost).
11. Armored asteroids rammed by a boost break after 2 *frames* of contact, as in Python; that is faintly frame-rate dependent.

Original quirks deliberately **kept**: only large asteroids ever enter the field (edge spawns sit 60 px off-screen, so
small / medium ones despawn on their first update; effective spawn rate ≈ ⅓ of nominal); wall clamp only runs while the
ship is driven; touching a rock while respawn-protected still destroys it; volatile asteroids have weight 0; Mega
Power's blanket switch-off of Rapid Fire / Multi-Shot.

## Known defects / caveats

- **Phaser 4.2.1 key-event replay (worked around).** The keyboard plugin re-processes its not-yet-cleared event queue every
  time another key event arrives in the same frame, so a `keydown-P` listener could fire twice (pause then immediately
  unpause, or P + Escape cancelling each other), and holding a key fired the string events repeatedly. The smoke
  test caught it (~25 % failures on P-then-Escape). One-shot keys (pause, menu, retry, mute, start) now go through
  `createKeyPressDispatcher` (`src/input/keyPress.ts`), which handles each physical press once and ignores auto-repeat.
  Continuous controls no longer use Phaser's keys at all (see "Keyboard input regression pass"). Any future one-shot key must use the dispatcher.
- Phaser 4.2.1's `fps.limit` / `TimeStep.setFPSLimit` over-reports `delta` (1.4–1.6× real time), so it is not used.
- Below ~10 fps the game runs in slow motion (frames are clamped at 0.1 s, by design).
- Phaser is bundled in full (1.4 MB, 357 KB gzip); the music file adds 1.4 MB of audio.
- Only Chrome has been tested; nothing was run on Firefox, Safari, a physical GPU or a touch device. Refresh rates other
  than 60 Hz are covered by unit tests, not a real display.
- The smoke test needs a locally installed Chrome / Edge / Chromium (set `CHROME_PATH` if it is not in a standard place).
- `?debug` exposes `window.__game` (the Phaser game and live sim) for tests and inspection. It grants nothing a
  console user could not do anyway, but it is a development hook; it is off unless the URL asks for it.
- The Multi-Shot pick-up icon is small, matching Python's drawing (arrows only one radius long).

## Not implemented yet (deferred)

Two-player co-op (and with it Revive), UFOs, combo multipliers, kill-streak banners, wave mode, death taunts, elaborate
particles, high-score screen, gamepad, touch, online leaderboards.

## Next steps

1. **Decide on the spawn quirk** (only large asteroids): keep the original difficulty, or spawn at `-radius` so all sizes
   appear (≈3× more asteroids at the same rate). It also determines how often power-ups drop.
2. Listen to the audio and adjust `SFX_VOLUME` / `MUSIC_VOLUME` in `src/audio/audioConfig.ts`; decide on the Mega speed-up.
3. Scoring module with combo multiplier and kill streaks (replace the inline score updates in `GameSim.hitAsteroid`).
4. UFOs: enemy shots and collisions slot into `GameSim` next to asteroids; boost ramming and the laser already have
   the hooks (Python also lets both kill UFOs).
5. Two players: turn `player` into an array, add a second `KeyScheme` (arrows + Enter / RShift / RCtrl), shared lives,
   friendly fire, then Revive.
6. High scores in `localStorage`; gamepad / touch via `PlayerInput`.
