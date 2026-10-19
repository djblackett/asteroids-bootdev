# Implementation progress

Phaser **4.2.1** · TypeScript 7.0.2 (strict) · Vite 8.3.4 · Vitest 5.0.5 · playwright-core 1.64.1 (dev only, for the
browser tests). Last updated 2026-10-19.

## Status

| Phase | Scope | Status |
| ----- | ----- | ------ |
| 1 | Foundation, player movement, shooting, asteroids, lives / respawn / game over / restart, HUD, starfield, pause | Done |
| 2 | Music and sound effects, six-type power-up system (Revive deferred), laser beam, boost, combined-ability testing | Done |
| 3 | Combo scoring, kill-streak banners, large and small UFOs (AI, shots, collisions, drops), integrated combat tests | Done (see "Phase 3") |

## Phase 2: what was added

### Audio (`src/audio/`)

- **Music**: `retro-bgmusic.ogg`, looped, started on the first key press / click (the browser keeps audio
  locked until then) and shared by every scene, so it is never restarted or duplicated. Paused with the game
  (P, blur, hidden tab, menu overlays) and by the new M mute toggle (remembered in `localStorage`).
- **Effects**: shot (random of 3 variants), explosions by asteroid size (small / medium / large), player
  death, laser, boost. At most 3 copies of the same explosion play at once, as in Python (plus a limit of 4 explosions
  of any size, see "Mix and volume controls"). One shot sound per trigger pull (Multi-Shot's three bullets share
  one). Sound objects are created per cue and destroyed on completion.
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

### Mix and volume controls (`audioConfig.ts`, `audioSettings.ts`, `audioSetup.ts`, `ui/volumePanel.ts`)

Level of every sound = **user setting (0..1) x mix gain**. The settings are the Music and SFX volumes, adjusted in 10 %
steps with the arrow keys on the pause screen (and the title screen), saved in `localStorage`
(`asteroids.musicVolume`, `asteroids.sfxVolume`, next to the existing `asteroids.musicMuted`). The gains are the mix,
in `audioConfig.ts`.

- **Why the old mix was wrong** (measured with ffmpeg on the shipped files): the music is hot (-12 dB RMS, peaks 0 dBFS),
  and the shots are the densest sounds (-9 dB RMS, peaks -0.3 dBFS), so the Python desktop values (music 0.5, shots 0.4)
  put gunfire at about the same loudness as the music, 6 dB above it in Rapid Fire, and explosions at 1.0 clipped.
- **Defaults**: Music 80 % x `MUSIC_MAX_GAIN` 0.7 = gain 0.56; SFX 80 %; per-effect gains `SFX_GAIN` (shots 0.28, explosions
  0.6 / 0.7 / 0.8 by size = `EXPLOSION_GAIN` 0.8 x `EXPLOSION_SIZE_RATIO` 0.75 / 0.875 / 1, laser 0.5, boost 0.6, death 0.7,
  all at an SFX setting of 100 %). Both settings default to
  80 % so either can be raised.
- **Overlap rules** (no ducking, no compressor): each sound is quieter by `OVERLAP_FALLOFF` for every sound of its group that
  is still playing, capped at 3 steps. Shots only count the ones started in the last 0.25 s (`OVERLAP_WINDOW_SECONDS`), so
  normal fire (every 0.3 s) is always at full level while Rapid Fire settles near 1.3x one shot instead of 3x. Explosions are
  limited to 3 of one size (Python's rule) and 4 in total, but, like the falloff, only explosions that started in the last
  1.5 s count: the files are 2.2 / 4.9 / 12.3 s long but audible (above -40 dB) for only about 0.8 / 1.3 / 3.5 s, and counting
  the silent tails had made most explosions in busy play 3-11 dB quieter or dropped.
- Music volume goes to the playing track's gain node at once, also while paused or muted; mute and volume are independent
  (muting never changes the saved volume, M still only mutes the music). SFX changes apply to the next effects and play
  a sample shot (always at the nominal level) so the setting can be judged by ear; at 0 no effect is started at all.

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

## Phase 3: combos, kill streaks and UFOs (2026-10-19)

New pure modules `src/core/scoring.ts` and `src/core/ufo.ts`, wired into `GameSim` (still driven only by
`step(dt, input)`); presentation in `ui/hud.ts` (`ComboHud`, `KillStreakBanner`) and `render/worldRenderer.ts` (UFOs,
enemy shots). Everything below was read from the Python source, not from the reconnaissance document, and several
details differ from that document (marked **≠ recon**).

### Combo and kill streaks (`collisions.py`, `killstreak.py`, `gameloop.py`, `hud.py`)

- **What counts as a kill**: an asteroid that is actually *destroyed* by a player shot, a laser hit or a boost ram, **or by a UFO
  shot** (that last one pays nobody but still advances the combo and can drop a power-up: kept). Each kill: combo + 1, 3 s
  window restarted, score = `int(points x multiplier)` at the *new* count (x1, 1.5, 2, 2.5, x3 from the 5th). Not kills: a
  non-lethal armored hit, an asteroid that crashes into the ship (shield or not), and **UFOs (≠ recon: they pay a flat 200 / 500,
  never multiplied, and do not touch the combo or the streak)**.
- **Reset**: only the 3 s timer (real time, so Slow Motion does not stretch it; it is not stepped while paused) or a new game.
  Losing a life does **not** reset it. On expiry the announced milestone is forgotten too, so 15 can be announced again.
- **Milestones** 15 KILLING SPREE! / 30 RAMPAGE! / 50 DOMINATING! / 75 UNSTOPPABLE! / 100 GODLIKE! / 150 LEGENDARY! /
  200 BEYOND LEGENDARY!, same names and colours. One banner at a time, a newer one replaces the old, 2.5 s. The curves are Python's:
  slides in from 100 px above over the first 20 %, fades over the first / last 15 %, pulses to 1.075x twice a second, with a dimmer
  glow (a Phaser text stroke). It is two reused Text objects that never take input. Hidden at game over, as in Python.
- **HUD**: from the 2nd kill "Nx COMBO" and "m.mx Points!" at the upper right (yellow, orange from 3, purple from 5), as in Python.
  Fonts are the browser monospace, a little smaller than Python's so the widest banner and the 3-digit combo never overlap
  (checked in a real browser).
- **Event contract**: `asteroid_destroyed` now carries `combo` / `multiplier` (absent for crash kills); `kill_streak` follows the
  kill that reached the milestone (so it can never be skipped, doubled or reordered: the count only ever moves by 1).

### UFOs (`ufo.py`, `asteroidfield.py`, `collisions.py`, `gameloop.py`)

- **Stats** as in Python: large r30, 100 px/s, a shot every 2 s, accuracy 0, 200 pts; small r20, 180 px/s, every 1.5 s, accuracy
  0.7, 500 pts. Shots: r6, 350 px/s, reddish ring, in their own list (`sim.ufoShots`) and type, so they are never confused with
  the ship's and cannot hurt UFOs. A new UFO starts at rest, draws its first heading (small: 40 % a straight left / right run)
  and a first-shot delay of 0.5-1.5 s; every 2-4 s it picks a new heading; velocity eases towards it; it wraps once a full radius off-screen.
- **"70 % accuracy"** is not a hit chance: the shot's direction is the line to the nearest living, non-respawning ship, plus a
  uniform deviation of up to `180 x (1 - accuracy)` degrees, so a small UFO is at most 54 degrees off (about 19 % land within
  10 degrees) and a large one (0) fires in a uniformly random direction. With no target both aim at a random screen point.
- **Spawning (continuous mode)**: first attempt after 5 s of play, then one every 15 s counted from the previous attempt; an attempt
  with 2 UFOs alive is skipped, not queued. Position is the asteroid edge table (60 px outside, 20-80 % along), so a UFO spawns past
  its own wrap line and first jumps to the opposite side: a Python quirk, kept. Difficulty scaling and Slow Motion do not touch UFOs.
  **≠ recon: small UFOs never spawn in continuous mode**, because Python only ever raises the field's wave number in wave mode (it
  stays 1, small needs 5). The selector is ported (`chooseUfoType(wave)`); `UFO_CONTINUOUS_EFFECTIVE_WAVE` (1) in `constants.ts`
  is the one switch (set it to 5 or more to see 40 % small UFOs). Small UFOs are fully implemented and tested (reachable with `?debug`
  and `sim.spawnUfo('small', x, y)`).
- **Collisions, in Python's order** (asteroids, shots vs asteroids, laser, **shots vs UFOs, ship vs UFOs, UFO shots vs ship**, pick-ups):
  - A player shot is used up by the first UFO it touches. UFO kill = flat points, burst of 10, shake 6, **one guaranteed ordinary
    power-up** (never Mega or Revive) at its position; `ufo.alive` stops a UFO being paid or dropping twice (a shot and a ram in the
    same frame pay once).
  - **Boost ram** kills the UFO and costs neither life, shield nor respawn protection.
  - **Normal contact** runs `takeDamage`: life lost (respawn at 320,360 with 2 s protection), or a shield / protection absorbs it,
    **but the UFO survives the contact**. As in Python a shield therefore buys exactly one frame against a UFO *body* (the next frame
    of contact takes the life); respawn protection absorbs it for its 2 s.
  - **UFO shots hurt a boosting ship** (the boost only protects against ramming); a shield / protection absorbs one and the shot is used up.
  - **≠ recon: the Laser Beam does not hit UFOs in Python** (`handle_laser_asteroid_collisions` only looks at asteroids). Kept: the beam
    passes through. `LASER_HITS_UFOS` in `constants.ts` flips it (a UFO dies once per beam: flat points, one drop; tested with the switch on).
- **Audio**: Python plays no UFO sound at all except the normal death sound when one hurts you. Spawn / fire stay silent; a destroyed UFO
  reuses the existing explosion samples (large = medium, small = small) through the normal explosion limiter, scaled by
  `UFO_EXPLOSION_GAIN_SCALE` (1.0, its own knob). Music, shots and asteroid explosions are untouched; the unused `enemy-ship*.ogg` stay unused.
- **Rendering**: Python's `UFO.draw`: filled disc (green large, purple small, brighter on a 0.3 s blink), lighter dome arc, white
  outline, 3 / 2 yellow lights that blink.
- **Frame-rate independence**: the velocity easing is `1 - exp(-2 dt)` (Python: `min(1, 2 dt)`, within 4 % at 60 fps); timers count dt;
  the sim already sub-steps at 1/30 s.

## Verification, Phase 3 (2026-10-19)

- Baseline before the pass: typecheck clean, **367 unit tests**, smoke **72/72**, keyboard **49/49** (the 2026-10-18 figures below are older).
- Now: typecheck clean; **486 unit tests in 19 files** (+119: `scoring` 40, `ufo` 56, `combat` 15, `laserUfo` 2, `ufoAudio` 6); production build OK;
  `npm run test:browser` **72/72**, `npm run test:input` **49/49**, new `npm run test:combat` **37/37** (run 12 times in a row after the last change, 37/37 each).
- Four older tests were changed, not weakened: they asserted the pre-combo scores (e.g. 3 laser kills = 80, now 140 with x1 / 1.5 / 2) or the exact `player_hit` event (now has `source`).
- `quietSim` (the test helper that switches the asteroid spawner off) now also switches the UFO schedule off; the 8-minute fuzz tests and the new 5-minute combat fuzz
  (30 / 60 / 144 fps, UFOs and combos on, restarts) run with UFOs enabled. A conservation test checks that the score always equals the points announced by events.
- Browser (`combat.mjs`, real key events, `?debug` only to place things): first UFO measured at 5.0 s game time and large; both UFO types render and fire; UFO shot costs a life /
  is absorbed by shield / is absorbed by respawn protection; shot kill = 500, one `ufo_destroyed` and one drop event; drop collected; boost ram = +200, no damage, shield kept;
  contact costs a life; laser passes through; combo of 4-5 from real gunfire with HUD, expiry 3 s later; UFO during a combo leaves it at 3; 22-rock chain shows KILLING SPREE! / "15 KILLS",
  does not block input, ends after 2.5 s; BEYOND LEGENDARY! and "200x COMBO" do not overlap (measured text bounds); armored first hit is no kill; pause freezes UFOs, shots and clock;
  8 s of intense combat with 2 UFOs, Rapid + Multi-Shot, fast asteroid spawns: avg frame 16.6 ms, UFO shots <= 9, sound objects <= 19, particles <= 66; three game-over -> restart rounds with
  UFOs, an enemy shot, a banner and a combo on screen: clean state, one music instance, no listener or display-object build-up.
- **Engines tested: Chromium 155 headless (Chrome, SwiftShader software WebGL) on Windows only.** No Firefox, Safari, real GPU or touch device.
- Screenshots looked at: UFOs + enemy shots, UFO kill + drop, combo HUD, kill-streak banner, BEYOND LEGENDARY!, intense combat, game over with UFOs.
- **One unexplained flake**: once in ~30 runs the widest-banner check saw the combo HUD but no banner text (state was not captured that time; extra diagnostics were added
  afterwards and it has not recurred in 25+ runs, nor in a 12-iteration isolated reproduction). Logic review of `KillStreakBanner` found no path to it; treat it as open.
  A second flake (a UFO "at 4 s") was a test timing assumption and was replaced by a per-frame measurement of the spawn time.
- Not verified: how the UFO-kill explosion sounds in a real listening session; banner look at other window sizes beyond the scaling checks.

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

1. Overall balance: music 0.56 against shots 0.22 / explosions 0.48-0.64 / laser 0.4 / boost 0.48 / death 0.56 (effective gains at the
   default 80 % settings). These come from measuring the files and an offline render of busy scenes, not from listening;
   the values to try first are in "Mix and volume controls" and in `src/audio/audioConfig.ts`.
2. Whether the three shot variants and three explosion sizes sound as varied as the desktop version's pitch-shifted
   samples (the port uses the pre-processed web files).
3. Overlap behaviour with the explosion limits during laser sweeps, whether the loudest moments (a crash: death sound
   plus an explosion, or a laser sweep) crackle, and that music pause / resume and volume steps have no audible click.
4. The Mega Power speed-up (1.26×), only if you enable it.
5. Audio unlock on browsers other than Chrome (Safari in particular).

## Intentional differences from the Python game

Phase 1 fixes: shots despawn 50 px outside the playfield; starfield parallax follows the ship's real movement.

Other deviations:

1. Exhaust / wall-spark directions follow the intended heading (Python mirrors them horizontally via `angle_to`);
   sparks are limited to 60 bursts/s.
2. Variable timestep from raw frame timestamps (Phaser's smoothed `delta` is clamped for 120 frames after boot/wake);
   frames are clamped to 0.1 s and split into ≤1/30 s sub-steps. Bounce damping is `0.85^(dt·60)`.
3. Shots (the ship's and the UFOs') despawn 50 px outside the playfield; Python never removes them. A destroyed UFO is not silent (Python plays no sound): it reuses an explosion sample.
4. A dying asteroid cannot absorb a shot on the frame it starts dying; the 0.2 s no-shooting grace applies after restarts too.
5. Single player only: start at the screen centre, respawn at (320, 360); arrow keys work as well as WASD.
6. HUD simplified (`P1`, `Lives`, clock, ability lines); no high-score list; browser monospace font.
7. Screen shake offsets the playfield layer (stars and HUD stay put) rather than using the camera.
8. M toggles music mute at any time (Python only while paused); a mute preference is remembered. Music and SFX volumes
   are adjustable and remembered too (Python has fixed levels).
9. Added a brief pick-up flash ring; Python has no pick-up feedback or sound beyond the HUD and ship colour.
10. Shield-absorbed collisions play the explosion but not the death sound (Python plays death only when a life is lost).
11. Armored asteroids rammed by a boost break after 2 *frames* of contact, as in Python; that is faintly frame-rate dependent.

Original quirks deliberately **kept** (Phase 3): UFO kills do not count for the combo; UFO shots kill asteroids for the combo but not for
score; a shield lasts one frame against a UFO body; boost does not stop UFO shots; the laser ignores UFOs; continuous mode never spawns
small UFOs; UFOs spawn 60 px outside their own wrap line and jump across first; losing a life keeps the combo.

Original quirks deliberately **kept** (earlier): only large asteroids ever enter the field (edge spawns sit 60 px off-screen, so
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

Two-player co-op (and with it Revive, friendly fire, shared lives), wave mode (and with it the wave-based UFO schedule and small
UFOs), death taunts, high-score screen, gamepad, touch, online leaderboards.

## Next steps

1. **Decide on the spawn quirk** (only large asteroids): keep the original difficulty, or spawn at `-radius` so all sizes
   appear (≈3× more asteroids at the same rate). It also determines how often power-ups drop.
2. Listen to the audio and adjust `MUSIC_MAX_GAIN`, `SFX_GAIN` and the overlap values in `src/audio/audioConfig.ts`; decide on the Mega speed-up.
3. Decide on the two Python gaps found in Phase 3 (the laser ignores UFOs; small UFOs never appear in continuous mode): each is one constant.
4. Optional UFO polish: a quiet spawn / fire cue (the unused `enemy-ship*.ogg` are candidates) with its own gain in `audioConfig.ts`.
5. Two players: turn `player` into an array, add a second `KeyScheme` (arrows + Enter / RShift / RCtrl), shared lives,
   friendly fire, then Revive.
6. High scores in `localStorage`; gamepad / touch via `PlayerInput`.
