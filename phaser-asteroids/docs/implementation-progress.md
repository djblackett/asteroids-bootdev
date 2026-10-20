# Implementation progress

Phaser **4.2.1** · TypeScript 7.0.2 (strict) · Vite 8.3.4 · Vitest 5.0.5 · playwright-core 1.64.1 (dev only, for the
browser tests). Last updated 2026-10-20 (Phase 8).

## Status

| Phase | Scope | Status |
| ----- | ----- | ------ |
| 1 | Foundation, player movement, shooting, asteroids, lives / respawn / game over / restart, HUD, starfield, pause | Done |
| 2 | Music and sound effects, six-type power-up system (Revive deferred), laser beam, boost, combined-ability testing | Done |
| 3 | Combo scoring, kill-streak banners, large and small UFOs (AI, shots, collisions, drops), integrated combat tests | Done (see "Phase 3") |
| 4 | Two-player local co-op (independent / shared lives, friendly fire, speed handicaps, Revive, co-op HUD and menu), Laser Beam kills UFOs, gradual small UFOs, shield-vs-UFO fix | Done (see "Phase 4") |
| 5 | Gamepad support: Python mapping recovered, keyboard + controller co-op (Player 1 keyboard, Player 2 pad), hot-plug, assignment UI, `?keydebug` pad section | Done and tested with a simulated gamepad; **real-hardware test pending** (see "Phase 5") |
| 6 | Mobile touchscreen prototype: floating joystick + FIRE / LASER / BOOST / PAUSE, landscape-first, portrait prompt, touch menus, input-mode selection | Built on branch `feature/mobile-touch-controls`, **not merged or deployed**; D-pad (default) and Android fullscreen tried on one Android phone; release-readiness pass done (Phase 6c); the keyboard-switch safeguards and iPhone are **not yet tried on a phone** (see "Phase 6") |
| 7 | Selectable soundtrack: Original, Mega Man, Gatekeeper, Random (title and pause screens: keyboard, mouse, gamepad, touch), per-track gain, on-demand loading | Built, tested; **uncommitted, not deployed**; listening test pending (see "Phase 7" and [music-tracks.md](music-tracks.md)) |
| 8 | Mobile haptics: Boost, Laser, damage and death vibrate an Android phone through `navigator.vibrate`; HAPTICS ON / OFF (default OFF) and TEST VIBRATION on the touch title and pause screens | Built, tested with a spy; **uncommitted, not deployed**; feel on a real phone pending (see "Phase 8" and [haptics.md](haptics.md)) |

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
- **Revive — implemented in Phase 4** (see there; the paragraph below is the Phase 2 finding that led to it). Python: a Revive pick-up (radius 15, 15 s life, blinks white in the last 3 s, green cross icon)
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
  **≠ recon: small UFOs never spawn in continuous mode in Python**, because it only ever raises the field's wave number in wave mode (it
  stays 1, small needs 5). The wave selector is still ported (`chooseUfoType(wave)`, for a future wave mode); **Phase 4 replaced the
  `UFO_CONTINUOUS_EFFECTIVE_WAVE` switch with a difficulty-level progression** (small UFOs from 2:00, see "Phase 4").
- **Collisions, in Python's order** (asteroids, shots vs asteroids, laser, **shots vs UFOs, ship vs UFOs, UFO shots vs ship**, pick-ups):
  - A player shot is used up by the first UFO it touches. UFO kill = flat points, burst of 10, shake 6, **one guaranteed ordinary
    power-up** (never Mega or Revive) at its position; `ufo.alive` stops a UFO being paid or dropping twice (a shot and a ram in the
    same frame pay once).
  - **Boost ram** kills the UFO and costs neither life, shield nor respawn protection.
  - **Normal contact** runs `takeDamage`: life lost (respawn at 320,360 with 2 s protection), or a shield / protection absorbs it,
    **but the UFO survives the contact**. Python's shield therefore bought exactly one frame against a UFO *body*; **Phase 4 changed
    this** (a shield absorbs the contact and the same contact is then free for up to 1 s, see "Phase 4"); respawn protection absorbs it for its 2 s.
  - **UFO shots hurt a boosting ship** (the boost only protects against ramming); a shield / protection absorbs one and the shot is used up.
  - **≠ recon: the Laser Beam does not hit UFOs in Python** (`handle_laser_asteroid_collisions` only looks at asteroids). Phase 3 kept
    the pass-through; **Phase 4 turned `LASER_HITS_UFOS` on** (a UFO dies once per beam: flat points, one drop). Set it to false to get Python back.
- **Audio**: Python plays no UFO sound at all except the normal death sound when one hurts you. Spawn / fire stay silent; a destroyed UFO
  reuses the existing explosion samples (large = medium, small = small) through the normal explosion limiter, scaled by
  `UFO_EXPLOSION_GAIN_SCALE` (1.0, its own knob). Music, shots and asteroid explosions are untouched; the unused `enemy-ship*.ogg` stay unused.
- **Rendering**: Python's `UFO.draw`: filled disc (green large, purple small, brighter on a 0.3 s blink), lighter dome arc, white
  outline, 3 / 2 yellow lights that blink.
- **Frame-rate independence**: the velocity easing is `1 - exp(-2 dt)` (Python: `min(1, 2 dt)`, within 4 % at 60 fps); timers count dt;
  the sim already sub-steps at 1/30 s.

## Phase 4: two-player co-op, Revive and three gameplay refinements (2026-10-19)

Everything below was read from the Python source (the reconnaissance document was not used for rules). Baseline at the start: tree clean at
`54e2001`, typecheck clean, **486 unit tests**, smoke 72/72, keyboard 49/49, combat 37/37 (re-measured, not assumed). Nothing outside
`phaser-asteroids/` was touched, nothing is committed.

### Milestone 0: three single-player refinements (done and verified before any co-op work)

| | Python | Phase 4 | Setting |
| --- | --- | --- | --- |
| **0A** Laser vs UFOs | the beam only looks at asteroids, so it passes through UFOs | the beam kills every UFO it touches, **once per beam** (tracked in the beam's hit set, `ufo.alive` guards the rest): flat 200 / 500, no combo, exactly one `ufo_destroyed` and one guaranteed ordinary drop. Piercing is unchanged (it kills the asteroids on the way too). It is resolved before player shots vs UFOs, so a UFO killed by the beam is not paid again by a shot in the same frame and that shot is not wasted. Works while boosting; does not touch the shield, UFO shots or the ship. | `LASER_HITS_UFOS = true` in `constants.ts`; false (or `new GameSim({ laserHitsUfos: false })`) restores the pass-through |
| **0B** Small UFOs in continuous mode | never (it picks the type from the wave number, which only wave mode advances) | the existing **difficulty level** (`GameSim.difficultyLevel`, +1 every 30 s, the thing that speeds the asteroids up) decides the type: large only before level 4; from **2:00 (level 4) 20 %** of UFO spawns are small, from **4:00 (level 8) 40 %** (Python's wave-5 rate), from **6:00 (level 12) 60 %**. No random number is drawn while the chance is 0, so the first two minutes of a seeded game are exactly as before. Timing (first UFO 5 s, then every 15 s) and the cap of 2 are untouched. | `UFO_SMALL_PROGRESSION` in `constants.ts` (`[]` = Python's large-only); `smallUfoChance(level)`, `chooseContinuousUfoType(level, rng)`; tests set `sim.difficultyLevel` instead of waiting minutes |
| **0C** Shield vs UFO body | a shield absorbed the contact for one frame, the next frame of the same contact took a life | a shield (or any absorbed contact) starts a **1 s grace per ship and per UFO** (`ufo.contactGrace[player - 1]`): staying inside that same UFO costs nothing; **separating resets it at once** (a fresh collision is a new hit); after 1 s the normal rules apply again, so a shield is never lasting immunity. A second UFO is a separate collision. Asteroids, enemy shots, boost rams and respawn protection are unchanged. Frame-rate independent (it counts dt). | `UFO_SHIELD_CONTACT_GRACE = 1.0` |

Four older tests that encoded the old quirks were rewritten (one per quirk, not weakened): the continuous-mode "large only" test (now "large only for 2 minutes,
then both"), "laser passes through a UFO" (now kills; pass-through kept as the `laserHitsUfos: false` case), "a shield buys one frame" (now: free for a while, then
costs the life) and the UFO-contact sound test. `tests/refinements.test.ts` (28 tests) covers the three refinements, `combat.mjs` got the same two changes in the browser.

### Milestone 1: what the Python source really does (rule inventory)

| # | Topic | Python (authoritative) | Notes |
| --- | --- | --- | --- |
| 1 | Init / spawns | `reset_game`: two players: P1 at (0.25 W, H/2), P2 at (0.75 W, H/2); one player: P1 at the centre and a placeholder P2 at (-1000, -1000) with `lives = 0`. Respawn points `P1_SPAWN` / `P2_SPAWN` = the same two points. | |
| 2 | Controls | P1 WASD, Space, E (laser), Left Shift (boost). P2 arrows, Enter, Right Shift (laser), **Right Ctrl (boost)**. Gamepads too (out of scope). | |
| 3 | Colours | **Ships have no per-player colour** (white, or the power-up colour). Only the HUD differs: P1 (100, 200, 255), P2 (255, 200, 100). | |
| 4 | Lives | Individual: 3 each. Shared: `SHARED_LIVES_POOL` 6 is put in `player1.lives` and `player2.lives = 0`. | **Shared lives is half-finished in Python**: with `lives == 0` Player 2 is never updated, drawn or collided (every check needs `lives > 0`), so only P1 plays; the `player_num == 2` branches that "restore P2's life and take one from P1's pool" can never run. |
| 5 | Death | `take_damage`: respawn protection first, then shield, then `lives -= 1`. `lives > 0` -> respawn at the player's own spawn, 2 s protection, power-ups and boost cleared. `lives == 0` -> `player{n}_dead`, the ship is not updated, drawn or hit any more. | |
| 6 | Game over | Individual: when both ships have no lives (checked at each death). Shared: when the pool reaches 0. | The surviving player plays on. |
| 7 | Friendly fire | Menu toggle (`FRIENDLY_FIRE_ENABLED = True` is the menu default). When on, a **shot** or a **Laser Beam** of the *other* player hurts a ship (shield / respawn protection apply, a shot that connects is used up, a beam hits a ship once). **No** ship-vs-ship collision, a **boost does not hurt** the other ship, nothing hurts its owner, UFO shots are a separate path. A friendly kill pays nobody. | The friendly-fire code never looks at the shared pool (it lowers the victim's own `lives`), another sign shared lives was never finished. |
| 8 | Speed | One **global** menu setting (50, 75, 100, 125, 150, 200 %) that multiplies forward / backward speed of **both** ships (and applies in one-player mode too); multiplies with Boost; rotation, shots and everything else untouched. | So it is not a per-player handicap in Python. |
| 9 | Scores | Individual `player.score`; **no combined total**; the game-over screen lists both. | |
| 10 | Ownership | Pick-ups apply to the collector (Player 1 is checked first and takes a pick-up both overlap); Slow Motion (and the Slow Motion that comes with Mega Power) is global; laser charges, boost cooldown and every other timer belong to the ship. | |
| 11 | Revive | `PowerUp.REVIVE` exists (green cross, 15 s life, blinks white in the last 3 s). Collected by a living ship while the **other** ship is dead with `lives == 0`: it gets **3 lives**, respawns at its own spawn with 2 s protection (power-ups cleared), `player_dead = False`. With nobody to revive it is just consumed. | **It can never appear**: `REVIVE_SPAWN_CHANCE = 0.3` ("30 % chance to spawn revive when a player dies") and `REVIVE_SYSTEM_ENABLED` are defined and never used. It is also meaningless with shared lives. |
| 12 | Combo / streaks | **Global** (`GameState.combo_count`, `last_streak_milestone`): either player's kills feed the one combo and the one banner; points are paid to the shooter at that multiplier. | |
| 13 | UFO targeting | `min` over the players that are alive (`lives > 0`) and not respawning, by distance; the first (Player 1) wins a tie. | The placeholder P2 of a one-player game is excluded by `lives == 0`. |
| 14 | HUD | P1 score / lives top left, P2 top right; "SHARED LIVES: n" top centre (on top of the clock); the combo upper right; **only Player 1's laser / boost / power-ups are listed**; game over lists both scores. | |

### What was built

**Simulation (`src/core/`).** Still one authoritative `GameSim`; `step(dt, input, input2)` (the second input is optional, so every one-player caller is unchanged).
`GameSim.players` holds one or two ordinary `PlayerState`s (`player` is still Player 1, `player2` is null in a one-player game, `config` is a `GameConfig`:
`playerCount`, `livesMode`, `friendlyFire`, `speed[]`, resolved by `resolveGameConfig`, which strips every co-op option from a one-player game). The collision pass
is the same function list as before, iterating players; no second simulation, no ECS. Events carry the player they belong to (`shot_fired`, `laser_fired`,
`boost_started`, `player_hit`, `powerup_collected`, `ufo_destroyed`, `asteroid_destroyed` when somebody was paid) and there are three new ones: `player_eliminated`,
`player_revived`, and `game_over` now has `scores` and a `reason`. Projectile ownership: `Shot.owner` and `LaserBeam.owner` (player numbers) already existed; UFO shots stay a separate type and list.

**One-player mode is unchanged**: all 486 original tests pass (only exact event shapes gained a `player` field, and the intended Phase 4 changes above), the HUD
text and layout are identical, the RNG draws happen in the same order (the Revive roll consumes nothing unless a Revive is eligible), single-player speed is always 100 %,
and a one-player run never sees a co-op setting (tested at config, sim and browser level, also after choosing co-op options in the menu and coming back).

**Rules as implemented** (see the Python table for the originals):

| Rule | Phaser behaviour |
| --- | --- |
| Spawns | 2P: P1 (320, 360), P2 (960, 360), respawn on the same points; 1P as before |
| Independent lives | 3 each; a ship that loses its last life is **eliminated** (not drawn, not hit, ignores its keys, power-ups cleared, score / laser charges kept); the run ends when **both** are out |
| Shared lives | One pool of 6, kept as every ship's `lives` in lock-step, so any death costs the team one life from the pool, both ships respawn at their own spawn while it lasts, and the run ends the moment it reaches 0 (Python's intent; its code left P2 inert). Two deaths in one frame cost two lives; the pool never goes negative |
| Game over | `reason` is `all_eliminated` or `shared_lives_exhausted`; one `game_over` event per run; the screen shows both scores, a **team total** (an addition) and the reason; R or the button retries, **Enter retries only a one-player game** (it is Player 2's cannon) |
| Friendly fire | As Python, on by default, menu toggle; shots and beams of the other player; shield / protection respected; a connecting shot is used up; a beam hits a ship once; with shared lives a friendly kill costs the team a life; never your own; no boost damage, no ship collision; with it off, shots and beams pass through |
| Speed handicap | Per player (Python's was one global value): menu choices 50 / 75 / 100 / 125 / 150 / 200 %, scales forward / backward speed only, multiplies with Boost (`PlayerState.speedMultiplier`, `PLAYER_SPEED * speed * boost`); two-player games only |
| Revive: when | Only with **independent** lives, while one ship is out and the other is alive, and **never two at once**. Then 30 % (`REVIVE_SPAWN_CHANCE`, Python's unused constant) of **ordinary drops** (an asteroid's 8 % roll, and the guaranteed UFO drop) become a Revive; Mega Power's own roll is untouched. About one Revive per ~35 asteroid kills, or one UFO in three |
| Revive: effect | The collector (who must be alive; ships that are out cannot collect; Player 1 has first claim) brings the other ship back with **3 lives**, at its spawn, 2 s protection, power-ups cleared, **score kept**, same ship object (no duplicate). Collected with nobody to revive it is consumed. Lifetime 15 s, blinks white for the last 3 s. If the collector loses its last life in the same step the run ends first and no Revive happens |
| Revive: feedback | Green expanding ring where it is collected and at the revived spawn, a "PLAYER n IS BACK!" toast, the HUD goes from `OUT` to `Lives: 3`; a "PLAYER n IS OUT!" toast, `OUT` + `NEEDS A REVIVE` (or a green `REVIVE ON FIELD!`) for the downed player. No new sound: Python plays none for pick-ups and the approved mix is untouched |
| Scoring | A kill pays its shooter / beam owner / boosting ship at the **team's** combo (Python); both ships shooting one rock in one frame: one kill, paid to the **earlier shot in the list** (Player 1's before Player 2's within a step); shots resolve before beams, so a shot and a beam on the same rock pay the shot; UFOs pay the killer a flat 200 / 500 and never touch the combo; UFO shots pay nobody; a friendly-fire death pays nobody; scores and laser charges survive elimination and Revive |
| Simultaneous things | A rock touching both ships hits the **nearer** one (Player 1 on a tie) and is destroyed (Python hit both); a UFO shot touching both hits the nearer one and is used up (Python hit both); a pick-up touching both goes to Player 1 (Python); a UFO body is checked per ship, so both can be hit in one frame and each has its own shield grace |
| UFO targeting | Per UFO, the nearest ship that is alive and not under respawn protection, Player 1 on an exact tie (`GameSim.targetFor`); re-evaluated every step so it follows deaths, respawns and Revives; the accuracy model (<=54 deg for small, random for large) is unchanged; with nobody to aim at it shoots at a random point |
| HUD | P1 top left, P2 top right (blue / orange), each with their own laser / boost / power-up list (right-aligned for P2, which Python never drew); `SHARED LIVES: n` bottom centre in a shared game; Slow Motion (a world effect) top centre; the combo moves to the bottom centre (the upper right is Player 2's); ships are blue / orange with a centre dot (so a power-up colour never hides whose ship it is), shots wear their owner's colour and Player 2's laser beam is orange, shields / boost / respawn flash are drawn on the ship they belong to |

**Menu (`StartScene`, `gameSetup.ts`).** Press 1 or 2 (or click the labels). The one-player page is the old screen moved down a few pixels. The two-player page shows both control sets and
`[L]` lives, `[F]` friendly fire, `[K]` Player 2 keys, `[S]` / `[D]` the two speeds, and the Revive in the power-up list. Choices live in the registry (`GameSetup`), survive Esc -> menu -> start and retry, and are gone on reload; the game scene builds a brand-new `GameSim` from them every time.

**Controls** (`keyboardControls.ts`, still `KeyboardEvent.code`, still one game-wide `HeldKeys`, physical keys separate from `PlayerInput` so gamepad / touch can plug in later):

| | Player 1 | Player 2 (default) | Player 2 (press K) |
| --- | --- | --- | --- |
| Move forward / back | W / S | Up / Down | I / K |
| Rotate | A / D | Left / Right | J / L |
| Shoot | Space | Enter (or numpad Enter) | ; |
| Laser Beam | E | Right Shift | U |
| Boost | Left Shift | **. (period)** | O |
| Shared | P pause, M mute, R retry, Esc menu (arrows adjust volume on the pause / title screens only) | | |

**Deviation: Python's Right Ctrl boost is not used.** In a browser Ctrl + W / T / N close the tab or window and no page can cancel them, and Player 1 holds W almost all the time.
The one-player scheme (WASD or arrows, either Shift) is unchanged; in a two-player game Player 1 has WASD only (the arrows and Right Shift are Player 2's).
`?keydebug` shows both players' `PlayerInput` and sim state and checks both mappings (verdict "STAGE 3 PROBLEM - P2 input mapping differs ..." names the player).

**Input safety.** Window blur / hidden tab clear every key of both players and pause (unchanged mechanism). Laser / boost keys held while play (re)starts or resumes are marked "used" for **both** ships, and a ship that is out of lives mirrors its held keys every frame, so a laser or boost key that is held (or tapped) while a player is down does not fire the instant they are revived.

### Keyboard rollover (what software cannot fix)

Automated tests prove the software path loses nothing; they cannot show hardware ghosting. Modifier keys (Shift, Ctrl, Alt) have their own lines on almost every keyboard and are
never ghosted; the risky ones are the letter / arrow / Enter / Space matrix. Combinations to try on a real keyboard (open `?keydebug`, hold them, and watch line 1 "raw browser held"):

1. P1 alone: `W+A+Space`, `W+D+Space`, `S+A+Space`, `S+D+Space`, `W+D+Space+E`, `W+D+Space+Left Shift`.
2. P2 alone: `Up+Left+Enter`, `Up+Right+Enter`, `Down+Left+Enter`, `Down+Right+Enter`, `Up+Left+Enter+Right Shift`, `Up+Enter+.`.
3. Both together (the real test): `W+D+Space+E` **and** `Up+Left+Enter+Right Shift`; then the same with `.` and Left Shift.
4. If one of them drops a key: press **K** on the title screen for the I J K L layout (`I+L+;+U`, `I+J+;+O`) and repeat 2 and 3.
5. Windows: pressing Shift five times opens the Sticky Keys prompt and steals focus: both players use Shift for boost / laser, so turn the shortcut off (Settings -> Accessibility -> Keyboard) before a long session.

### New gameplay configuration values

`constants.ts`: `LASER_HITS_UFOS` (true), `UFO_SMALL_PROGRESSION` ([{4, .2}, {8, .4}, {12, .6}]), `UFO_SHIELD_CONTACT_GRACE` (1.0), `PLAYER_SPAWNS` (P1 / P2), `SHARED_LIVES_POOL` (6),
`FRIENDLY_FIRE_DEFAULT` (true), `REVIVE_LIVES` (3), `REVIVE_SPAWN_CHANCE` (0.3), `SPEED_OPTIONS`. `UFO_CONTINUOUS_EFFECTIVE_WAVE` was removed. `GameSimOptions`: `config`, `laserHitsUfos`. New files:
`core/gameConfig.ts`, `gameSetup.ts`, `scripts/coop.mjs` (`npm run test:coop`), `tests/refinements|coop|coopCombat|coopFuzz|twoPlayerInput.test.ts`.

### Intentional differences from Python (Phase 4)

1. Laser kills UFOs; small UFOs arrive by difficulty level; a shield protects against the UFO body it absorbed for up to 1 s (Milestone 0).
2. **Shared lives works** (Python: Player 2 inert). Friendly fire and Revive follow the pool / are off in it.
3. Ship colours, owner-coloured shots and an orange Player 2 beam in co-op (Python: white).
4. Player 2's boost is `.` instead of Right Ctrl; an optional I J K L layout; Enter does not retry a two-player game.
5. Revive actually appears (30 % of ordinary drops while a player is out; Python never spawned it), one at a time.
6. Speed handicap per player instead of one global value, two-player games only (Python also offered it in one-player mode; a one-player game is always 100 %).
7. A rock or UFO shot that touches both ships hits the nearer one only; Python hit both.
8. Player 2's power-up list is shown, the combo moves to the bottom centre in co-op, `SHARED LIVES` is at the bottom centre (Python drew it over the clock), a team total on the game-over screen, `OUT` / `NEEDS A REVIVE` / toasts.
9. No high-score list (as before).

### Verification, Phase 4

- Typecheck clean; production build OK; **627 unit tests in 24 files** (+141: `refinements` 28, `coop` 41, `coopCombat` 41, `twoPlayerInput` 19, `coopFuzz` 6, `keyDiagnostics` +5; four older tests rewritten for the intended changes and nine event assertions gained `player`; the 486 originals otherwise pass unchanged). The fuzz tests run 3 simulated minutes of random two-player play at 30 / 60 / 144 fps (both life modes, friendly fire on and off, random pick-ups incl. Revive, crashes, friendly shots, restarts from game over) and check on **every step**: lives in range, shared pool equal for both ships, game over exactly when nobody has a life, one `game_over` per run, a ship that is out never moves, no effects on an out ship, each score equals the points announced by events, bounded entities. The whole unit suite takes ~21 s (the fuzz is most of it).
- Browser, **Chromium 155.0.8059.84 headless (Chrome, SwiftShader software WebGL), Windows 11 only**: `test:browser` smoke **72/72** (8 of 9 full runs; the ninth ran while I was editing files and lost two timing-dependent checks, "laser beam still alive 120 ms after the press" and "boost ram without losing a life", under CPU contention; the last 6 runs, with nothing else running, were 6 x 72/72); `test:input` keyboard **49/49** (3 runs); `test:combat` **39/39** (12 runs; 37 + the two new laser-kills-UFO / shield-grace checks); new `test:coop` **65/65** (10 consecutive runs after the last script fix). The earlier one-off smoke failure of "Down + Right x2 raises SFX to 100 %" (sample shot not in the playing list at that instant) did not recur in 15 later smoke runs; it is a timing check on an audio preview that Phase 4 did not touch, but its cause is not proven.
- `coop.mjs` (genuine key events for both players; `?debug` only to place a rock, a Revive or a UFO) covers: menu (1 / 2 / L / F / K / S), a one-player run after choosing co-op options carries none of them, two-player start, both ships rendered in their colours (pixels counted in screenshots), HUD corners, independent movement and turning, simultaneous shots, 6 keys held per both players, Right Shift / `.` / Left Shift / E, the I J K L layout (and the arrows doing nothing then), shield and rapid-fire colours drawn on the right ship and listed under the right player, score attribution at the shared combo, the combo readout position, one player eliminated (HUD `OUT`, toast, keys inert, survivor plays on), a Revive that appears from real kills and revives the right player, friendly fire (shot, beam, shield), UFO targeting, pause / resume with both players (keys held through it, laser keys pressed while paused), blur, game over with both scores / team total / reason, Enter not retrying, R restarting, shared lives (pool, cost, exhaustion), the speed handicap, back to one player through the menu, `?keydebug` for both players, a 9 s two-player stress run (rapid + multi-shot, shields, UFOs, lasers, boost, fast asteroids, a Revive mid-run: avg frame 17-18 ms, shots <= 31, particles <= 98, sound objects <= 22 -- software rendering, **not** a GPU measurement) and three game-over -> restart cycles (no leftover shots / lasers / pick-ups / combo, same listener and display-object counts, one music instance). Along the way eight check-script races were found and fixed (e.g. pressing R before the *simulated* retry delay had run, a leftover boost ramming the test rock, judging a circling ship by net displacement); in each case the dumped state showed the game was right.
- Screenshots looked at: title screen (one and two players), two ships, shield + rapid fire, Player 1 out, revived ship, two-player game over, shared-lives HUD.
- **Not verified**: Firefox, Safari, any real GPU, a real keyboard (rollover), real two-person play, touch, how any of it sounds (nothing audio changed; `audioMix` tests are unchanged and pass), other window sizes beyond the existing scaling check.
- Kill-streak banner flake (Phase 3): did not recur in 12 combat runs; the diagnostics and the assertion are untouched.

### Important edge cases (all tested)

Both ships dying in one frame (independent and shared, including a pool of 1); the collector of a Revive dying in the same step; a Revive for a ship that is out vs one lying around with nobody down; a pick-up touching both ships; one rock / UFO shot / beam touching both ships; a shielded ship staying inside a UFO while the other one does not; a held laser / boost key across death, Revive, pause and blur; a friendly kill on a ship's last life (eliminated, survivor plays on; or run over if it was the last ship); a beam that fires and the owner then dies; a game paused (not stepped) in the middle of a respawn; retries from every terminal state (`all_eliminated`, `shared_lives_exhausted`).

### Remaining issues / not done

- **No physical-keyboard, Firefox, Safari, real-GPU or touch verification** (see the verification section). Rollover has to be tried on real hardware (list above).
- **Sound**: nothing new was added (elimination / Revive are visual only); whether a cue is wanted is a listening decision.
- Death taunts, gamepad, touch, high scores, wave mode, key remapping are out of scope and not started.
- The co-op menu is keyboard / mouse only; the S / D speed keys cycle forward only (wraps after 200 %).
- Two ships can sit on top of each other (as in Python); nothing pushes them apart.
- A one-in-~30 intermittent failure was seen once in the pre-existing smoke check "Down + Right x2 raises SFX to 100 %" (see the verification section).


## Phase 5: gamepad support and keyboard + controller co-op (2026-10-19)

Baseline at the start (re-measured, not assumed): tree clean at `8c3ade1`, typecheck clean, **627 unit tests**, smoke 72, keyboard 49, combat 39,
co-op 65. Nothing outside `phaser-asteroids/` was touched, no Python file was modified, nothing is committed. `src/core/` (the simulation),
the audio, and every scoring / collision / Revive / UFO rule are unchanged: the pad is only another producer of `PlayerInput`.

### The original Pygame controller layout (read from `player.py`, `controlconfig.py`, `events.py`, `main.py`)

Python reads pads through `pygame.joystick` (pygame 2 / SDL, indices as seen on Windows with an Xbox pad). A player's `input_source` is
`keyboard`, `keyboard_2`, `gamepad_0` or `gamepad_1`; each `Player.update` polls only its own device, so any mix of devices works.

| Python (`Player.update`, gamepad branch) | Detail |
| --- | --- |
| Rotate | **Left stick X**, axis 0. `rotate_input = axis` once `abs(axis) > 0.15`: analogue, *not* rescaled past the dead zone |
| Forward / backward | **Left stick Y**, axis 1. `move_input = -axis` once `abs(axis) > 0.15`, analogue: a light push is slower. One stick does both (rotate + thrust together is normal) |
| Shoot | **Right trigger**, axis 5 `> 0.5`, **or the A button** (button 0): either held = continuous fire (the cooldown is in `shoot()`) |
| Laser | **X** (button 2), once per press (`laser_key_pressed` latch) |
| Boost | **B** (button 1), once per press (`boost_key_pressed` latch) |
| Pause | **Start** (`JOYBUTTONDOWN`, button 7 in SDL's numbering). `Esc` / `M` / `Q` while paused are keyboard-only |
| Menus | Title: A starts. Game over: A retries (after the retry delay). Control setup: A confirms, D-pad (buttons 11-14 or the hat) navigates |
| Assignment | **Control-setup screen** (`controlconfig.py`): per player, cycle through "Keyboard" and "Controller N - name" for every pad SDL listed at start-up. Default: 2 pads -> P1 `gamepad_0`, P2 `gamepad_1`; 1 pad -> P1 `gamepad_0` (and P2 keyboard 2); 0 pads -> two keyboards. A warning shows if both players use the same input. `reset_game()` without a config picks keyboard + `gamepad_0` for one pad |
| Keyboard + pad together | Yes, as two players (P1 keyboard, P2 `gamepad_0`): the configuration that worked well. For one player the setup screen picks one device; there is no merge |
| Hot-plug | **None.** Pads are enumerated once (`pygame.joystick.init()` at start-up and in `ControlConfig`); a missing pad is silently neutral (`get_count() > index` guard) |
| D-pad in play | **Not used**; sticks only. Bumpers, Back, stick clicks, Y: unused |

Incomplete / platform-specific parts: axis 5 for the trigger and Start = 7 are SDL-on-Windows numbers (the browser's standard mapping numbers
the same physical controls differently); the A-button fallback is what keeps pads without a trigger axis usable; there is no disconnect handling and
no controller-to-player assignment beyond the start-up count. `test_gamepad.py` is a diagnostic that only prints raw button / axis numbers.

### The Phaser layout (standard-mapping pads: Xbox, and most others in Chrome / Edge / Firefox / Safari)

| Physical control | Python | Phaser |
| --- | --- | --- |
| Left stick X | rotate, dead zone 0.15, analogue | same (rotate = raw axis past 0.15, clamped to [-1, 1]; `stickAxis`) |
| Left stick Y | move = -axis, dead zone 0.15, analogue | same (up = forward) |
| D-pad | menus only | **also** rotate / move in play, *only while the stick is centred* (browser addition, below) |
| RT | axis 5 > 0.5 | **button 7** value >= 0.5 (the standard mapping exposes triggers as analogue buttons) |
| A | shoot | shoot |
| X | laser (once per press) | laser (once per press, by the existing `keyHeld` latch in `player.ts`) |
| B | boost (once per press) | boost (once per press) |
| Start | pause (button 7) | pause / resume (**button 9**, standard numbering) |
| Back | none | main menu, only while paused or on game over (browser addition; Python used the keyboard's Esc) |
| A on game over / title | retry / start | retry (fresh press, after the retry delay) / start (on an assigned pad) |
| LB / RB / Y on the title | none | LB = Player 1, RB = Player 2, Y = show the controller layout (assignment UI, see below) |

**Non-standard devices** (`Gamepad.mapping !== 'standard'`): read with Python's own raw indices and nothing else: axes 0 / 1 for the stick,
the trigger on axis 5 (> 0.5), buttons 0 / 1 / 2 for A / B / X, Start = 7, Back = 6, **no D-pad and no bumpers** (on raw devices they are
hats or arbitrary axes). The title screen flags such a pad "(non-standard layout)". This is a best effort and the most likely place to
need adjusting on odd hardware (`LAYOUTS.generic` in `src/input/gamepadMapping.ts`).

### Deliberate browser adaptations

- **Indices**: RT is a button (7) and Start is 9 in the browser's standard mapping; the same *physical* controls are mapped, not the same numbers.
- **Dead zone / sensitivity are Python's**, unrescaled (`STICK_DEADZONE = 0.15`, `TRIGGER_THRESHOLD = 0.5`, in `gamepadMapping.ts`). A rescaled
  dead zone would be smoother but would change the turn speed at mid-deflection, which Python's feel depends on. Full deflection = exactly the keyboard's
  speed, a half push is half speed; frame-rate independent because `step` already multiplies by `dt` (unit tested at 30 / 60 / 144 fps).
- **D-pad in play, Back = menu, A = retry, D-pad on the title (1 / 2 players) and on the pause screen (volumes)**: small additions so a controller user never
  has to reach for the keyboard for pause / resume / retry / menu. Everything else on the title screen (lives, friendly fire, speed) stays keyboard / mouse.
- **No hot-plug in Python; the browser requires it**, hence the hub below. **Assignment** is explicit and visible ("press A" / LB / RB) instead of Python's
  start-up cycle screen, because browsers only report a pad after a button press and may renumber it.
- All ship physics, rotation speed, boost speed and cooldowns are untouched. `PlayerInput.rotate` / `move` were already analogue in the TypeScript
  simulation, so no simulation change was needed.

### Architecture (where the pad plugs in)

```
navigator.getGamepads() --(browserGamepadReader: copies)--> GamepadHub.poll()  <-- Phaser PRE_STEP, once per frame (gameGamepads.ts)
                                                              |  presses (up->down edges), connection / assignment state, arming
HeldKeys (keys) -> readPlayerInput(scheme) ----+              v
                                               +--> mergeInputs --> PlayerInput per player --> GameSim.step(dt, in1, in2)   (unchanged)
GamepadHub.command(slot, playerCount) --------+
```

- `src/input/gamepadMapping.ts` (pure): snapshot -> named buttons -> `PlayerInput` (`padToInput`), `mergeInputs`, the layout tables and the layout-screen text.
- `src/input/gamepadHub.ts` (pure, injectable `GamepadReader`): every connected pad, player assignment, edge detection, arming, events, diagnostics text.
- `src/input/gameGamepads.ts`: installs the one game-wide hub (BootScene, like `HeldKeys`), polls on `prestep`, wires `blur` / `focus` / `visibilitychange` /
  `gamepadconnected` / `gamepaddisconnected`, undoes all of it on game destroy. Scenes never add window listeners for pads.
- `src/input/playerInputs.ts`: `readPlayerInputs(held, hub, schemes)` = the keyboard of each player merged with that player's pad. **`GameSim` and everything in `src/core` is untouched.**
- `src/ui/controllerPanel.ts` + `StartScene` / `GameScene` changes: status line, layout screen, one-shot pad buttons, disconnect pause.

### How controllers are detected and assigned

- **Detection** is by polling `getGamepads()` every frame (events are only an extra poll trigger). A pad plugged in before the page loaded is listed after its first
  button press (a browser rule). A controller is only ever shown as usable while it is **connected right now**.
- **Title screen** (bottom left, up to two lines and a hint; nothing on the gameplay HUD): `No controller detected - press a button on it` / `Controller 1: <name> ->
  not assigned (press A to join)` / `... -> PLAYER 2` / red `PLAYER 2: <name> DISCONNECTED - reconnect it`. The two-player page also marks the heading
  `PLAYER 2  + CONTROLLER`, and the start prompt gains "or A" once a pad is assigned.
- **Joining**: **A** (or Start) on an unassigned pad takes the first free player: in a two-player game **Player 2 first** (keyboard Player 1 + controller Player 2 is the
  intended setup), then Player 1 for a second pad; in a one-player game Player 1. A pad that joined by this policy follows the player count (joined as P1 in 1P, it moves
  to P2 when you press **2**). **LB** / **RB** assign a pad to Player 1 / 2 on purpose (not moved afterwards); **G** or a click on its line cycles P2 -> P1 -> none. One pad
  per player, one player per pad: assigning moves, never duplicates. An unassigned pad controls nothing (it can still navigate the title screen). With one player, the pad
  assigned to either slot drives the single ship.
- **Combining with the keyboard** (the same player has both): a player's keyboard keys always stay live. Per axis, if the keyboard is pushing it the keyboard wins outright,
  otherwise the pad's analogue value is used (never contradictory steering); shoot / laser / boost are OR-ed. Two players sharing one keyboard is unchanged.
- **Disconnect / reconnect**: a pad that disappears is dropped on the very next poll and its commands are neutral at once. An assigned player keeps a reservation **by device
  name only** (a reservation never makes a pad "available"): the title screen says DISCONNECTED, a game in progress **pauses** with `PLAYER n'S CONTROLLER DISCONNECTED - plug it
  in again` on the pause screen, and a pad with the same name that connects again (browser indices change, so it is matched by name, preferring the same index) takes the player
  back automatically; a different controller does not inherit it. Reconnecting does not resume the game: START / P does.
- **Arming** (no unintended activations): a pad is neutral until every one of its buttons has been seen released, after it connects, after the window loses / regains focus or the
  tab is hidden, and when a run starts or restarts. So the press that woke the pad, the A that pressed RETRY / start, or a trigger held through a focus change cannot fire a weapon.
  Laser / boost held across pause are handled by the existing `ignoreHeldAbilityKeys` (it reads the merged input).
- **One-shot buttons** (START pause, A retry, BACK menu, title-screen buttons) are up -> down edges queued by the hub (bounded queue), accepted only from a pad assigned in this
  game, discarded when a scene starts; holding a button never repeats it. A is deliberately also the cannon: retry needs a *fresh* press after the retry delay.

### Diagnostics (`?keydebug`)

The existing panel gains a "gamepads" section (hub-built and bounded: <= 4 pads, ~5 lines each, at most 12 buttons listed): per pad the browser's mapping string and the layout used, axis /
button counts, raw axes 0-5, raw buttons currently down (with analogue values), the normalised command, whether it is armed, and the player it goes to (or "nobody"). Connect / disconnect /
neutral-reset events go into the timeline (so they are in the freeze / copy report) and a history entry is added only when a pad's command changes. The stage-3 verdict is skipped for a
player a pad also drives (the pad lines explain that input). Nothing runs without `?keydebug`.

### Tests and verification

Unit: **733 passing** (was 627; +106): `gamepadMapping` (32: dead zone boundaries, both rotation directions, forward / backward, thrust + steer, trigger 0.49 / 0.5, A / X / B, all held
at once, non-standard layout, D-pad fallback, merge policy, names), `gamepadHub` (43: connect / detect, arming, press edges, assignment and the join policy, cycle, one vs two players,
disconnect / reconnect by name and index, identical pads, focus, listener cleanup, diagnostics bounds, event-log bound), `gamepadInstall` (4: poll per frame, connect events, blur /
hidden / focus, listener cleanup), `padCoop` (23: keyboard P1 + pad P2 through the real `readPlayerInputs` -> `GameSim.step`: independent movement, opposite turns, simultaneous fire,
laser / boost once per press, identical commands = identical ships, 30 / 60 / 144 fps, power-ups, scoring, elimination, Revive, shared lives, friendly fire, unplug mid-action,
reconnect, focus, restart, one-player pad, mode switching) and `padDiagnostics` (4). Everything is driven by synthetic snapshots through an injected reader (`tests/padFakes.ts`);
no test needs a controller.

Browser (`npm run test:gamepad`, `scripts/gamepad.mjs`, **82 checks**): Chrome 155 headless with an init script replacing `navigator.getGamepads` by a controlled provider, real keyboard
events for the keyboard player. Covers: keyboard-only play unaffected; detection (wake-up press, "not assigned"); A / LB / RB / G assignment and the 1P -> 2P move; the layout screen (C, Esc,
Y, B); Player 1 keyboard + Player 2 pad moving, turning and shooting at the same moment with correct shot ownership; trigger 0.3 vs 0.8, A, drift inside the dead zone, half vs full
deflection, laser and boost once per press; START pause / resume with controls held; disconnect mid-action (auto-pause, note, no stuck input), reconnect with a trigger held (not trusted
until released), disconnect / reconnect while paused; window blur / focus; elimination and Revive of the pad player, scoring; game over -> retry with a held A (no early retry, no shooting
at run start), 4 restarts (one listener), B / X / stick held across a restart; START -> BACK to the menu (no listener left); one-player pad-only play and keyboard + pad on one ship; two
controllers each driving only their own ship and unplugging one; a non-standard device; no Gamepad API at all (plain http); the `?keydebug` pad section; zero console errors. **This is a simulated provider, not hardware.**

Final suite: typecheck clean, production build OK, unit 733, smoke 72/72, keyboard 49/49, combat 39/39, co-op 65/65, gamepad 82/82 (Chromium 155 headless, Windows). **Flake note:** `test:input` (keyboard.mjs) is timing-based and failed ~1 run in 8 on a clean build of the pre-Phase-5 `HEAD` as well as on this one (different checks each time: "arrow keys also work together with Space", "movement + boost ... clearly faster", "after unpausing ... keep moving AND turning"); every failing check is a fixed-length key hold measured against wall-clock sleeps, and all pass on a rerun. Not caused by the pad code, but not fixed either. The browser scripts also share preview ports (keyboard + combat 4398, smoke + coop 4399, gamepad 4400), so do not run those pairs in parallel.

### Not verified (needs a person with a real controller)

No physical controller, Firefox or Safari was available. Still to confirm by hand (checklist below): that real Chrome / Edge reports the pad with `mapping: "standard"` and the
indices assumed here, that RT really reaches 0.5 and the stick returns inside the 0.15 dead zone on the user's pad (drift varies by unit), that the pad's wake-up behaviour matches the "press a
button" wording, wireless / Bluetooth reconnection timing, the feel of analogue turning, and Firefox / Safari (Firefox's pad ids and mapping strings differ; Safari also needs a button
press). Chrome only exposes `navigator.getGamepads()` in a secure context (https, or `localhost` / `127.0.0.1`); a plain-http LAN address shows "Gamepads unavailable".

### Manual test with an Xbox-style controller (Windows 11, Chrome or Edge)

1. `cd phaser-asteroids && npm run dev` (or `npm run build && npm run preview`) and open **http://localhost:5173/?keydebug** (preview: 4173). `localhost` counts as secure, so the Gamepad API works.
2. Connect the pad (USB cable, or Bluetooth / Xbox Wireless Adapter). Windows' "Set up USB game controllers" (`joy.cpl`) should list it. In the page, press any button on the pad: the bottom-left
   line should change from `No controller detected` to `Controller 1: Xbox ... Controller -> not assigned (press A to join)`.
3. Press **2** on the keyboard (two players), then **A** on the pad: the line becomes `... -> PLAYER 2` and the Player 2 heading reads `PLAYER 2  + CONTROLLER`. **C** (or **Y**) shows the layout;
   LB / RB move the pad to Player 1 / 2: put it back on Player 2.
4. Press **Space** (or A on the pad) to start. Player 1 = keyboard (WASD, Space, E, Left Shift), Player 2 = pad. Check **every** control on the pad: left stick left / right rotates (half push =
   slower), up / down moves forward / back, thrust + steer together, hold RT = continuous fire, A also fires, X = laser (one per press, `LASER n/15` drops by one), B = boost (3 s, magenta ship),
   D-pad moves when the stick is centred. Release the stick: the ship must stop turning and drifting (no creep). Then use both players **at the same time** (P1 W + D + Space while P2 stick + RT).
5. **START** pauses (overlay says "P or START to Resume"); START resumes with the stick still held and no laser / boost re-fire. Unplug the pad (or remove its batteries) mid-flight: the game must
   pause with the red `PLAYER 2'S CONTROLLER DISCONNECTED` line and the ship must not keep moving. Plug it in and press a button: the pad should be Player 2 again (the title screen / `?keydebug` log
   say so); START resumes. Alt-Tab away and back: the game is paused and the pad is ignored until you release everything, then works.
6. Let Player 2 die (3 lives) and confirm it cannot move or shoot; let Player 1 pick up a green Revive: Player 2 returns and the pad drives it. Let both die: **A** retries after the 1.5 s delay and the
   ship must not fire from the A you just pressed. **START, then BACK** returns to the title screen with the pad still assigned.
7. If something is off, press **Freeze Capture** in the `?keydebug` panel and **Copy Diagnostic Report**. Collect: the report (it holds the browser's mapping string, raw axes 0-5, raw buttons with
   values, the normalised command, the target player and the connect / disconnect timeline), the exact controller model and how it is connected, the browser and its version, and, for drift problems, the idle
   values of axes 0 / 1.

## Phase 6: mobile touchscreen prototype (2026-10-20)

Full description, layout, mapping, mode policy, limits and the phone test procedure: [mobile-touch.md](mobile-touch.md). Summary:

- **Architecture.** Touch is one more source of `PlayerInput`, merged into Player 1 by `readPlayerInputs` after keyboard and pad. `src/core/` is unchanged.
  `touchModel.ts` (pure: pointer id -> control binding, stick normalisation reusing `stickAxis`), `touchBinding.ts` (Pointer Events wiring against
  structural interfaces, so it is unit tested with fake targets), `touchControls.ts` (game-wide facade: mode, layer, portrait, pause tap),
  `inputMode.ts` (policy), `gameTouch.ts` (registry install, like held keys and the gamepad hub), `ui/touchOverlay.ts` + `touch.css` (DOM controls and the
  portrait prompt), `ui/touchMenus.ts` / `touchStartMenu.ts` / `touchLabels.ts` (Phaser touch menus, ability labels).
- **Changed existing files** (all behaviour-preserving on desktop): `BootScene` (installs the touch layer), `StartScene` (touch title screen branch, CONTROLS switch),
  `GameScene` (touch layer / pause / game-over buttons, portrait pause), `playerInputs.ts` (optional touch source), `hud.ts` (optional scale, default 1),
  `main.ts` (`input.activePointers: 3`), `index.html` (`viewport-fit=cover`, safe-area inset on the canvas container, `overscroll-behavior`).
- **Bugs the browser suite found while building it** (all fixed): Phaser's window-level touch listener processed touches on the DOM overlay as taps on Phaser
  buttons (a tap on the rotate prompt started a game); Phaser's single default touch pointer ignored a RETRY tap while the other thumb rested on the screen.
- **Not changed:** scoring, physics, collisions, difficulty, UFOs, power-ups, audio files and mix, the Python game, the deployment workflow.
- **Verification (Phase 6).** Unit tests: 845 in 34 files (733 before this phase; 112 new across `touchModel`, `touchBinding`, `touchControls`, `inputMode`, `touchInput`).
  Browser: `npm run test:touch` (101 checks; genuine four-finger multi-touch through CDP, phone viewports 844x390, 667x375, 932x430, 740x360, 915x412, 1024x768, portrait,
  pause / retry / menu / mode switch, desktop-unchanged guards). The existing suites were re-run on the final build: smoke, keyboard, combat, co-op, gamepad and Pages
  validation (see the final report for the counts). Flakiness, measured: the timing-sensitive checks in the smoke and keyboard suites fail
  intermittently on this machine **with and without this phase**. Pristine `main` (built in a separate worktree) failed 3 of 17 smoke runs (two different checks, e.g. the SFX
  sample-shot level and "boost moves ~2.5x faster"); this branch failed 3 of ~14 (the same SFX check, and once a keyboard "movement + laser" 200 ms-window check
  while unit tests ran concurrently). Isolated reruns pass. Treat a single red timing check as a rerun, not as a regression, and investigate only if it repeats.
- **Not verified:** anything on a physical phone, iOS Safari, Android Chrome, a real GPU, safe-area insets on a notched device, thumb ergonomics.

## Phase 6b: D-pad and fullscreen (2026-10-20)

Prompted by a first test on a real phone: analogue steering made it easy to lose control (start spinning) while moving and shooting. Full description, layout, test
script for a phone: [mobile-touch.md](mobile-touch.md) (sections "D-pad", "Choosing the steering control", "Fullscreen", "Phone test script"); the possible future installed-web-app
configuration: [standalone-web-app.md](standalone-web-app.md). Summary:

- **Added.** A digital **D-pad** (a single round touch target, eight 45 degree sectors, centre dead zone, a little hysteresis, so one thumb holds Up + Left; output is -1 / 0 / 1 exactly
  like W / A / S / D) as a second steering control next to the unchanged joystick; a **STEERING: JOYSTICK | D-PAD** choice on the title and pause screens, saved in `localStorage`
  (`asteroids.touchSteering`, default D-pad since the follow-up below); a **FULLSCREEN** button (title and pause screens) using the standard Fullscreen API on the root `<html>` element, called synchronously inside
  a real touch `pointerup`, with enter / exit tracking, a visible "blocked" state, and, where fullscreen is impossible (iPhone Safari), no Fullscreen button but a **HIDE ADDRESS BAR** tip about
  Add to Home Screen. Nothing is shown when already running as an installed web app.
- **Where it lives.** `touchModel.ts` (`dpadDirection`, the D-pad state, `SteeringMode`, one live steering control), `touchBinding.ts` (reads the pad's rectangle on press / move / resize; releases on
  `fullscreenchange`), `touchControls.ts` (`setSteering`, new `menu` layer), `steeringMode.ts` (persisted choice), `fullscreen.ts` (pure controller + button wording), `systemOverlay.ts` (DOM Fullscreen
  button and tip), `touchOverlay.ts` / `touch.css` (the pad, mode visibility, system layer), `touchMenus.ts` / `touchStartMenu.ts` (STEERING selector, right column re-packed), `gameTouch.ts` (installs the controllers,
  re-fits the canvas after fullscreen changes), `StartScene` / `GameScene` (layer + selector wiring). **`src/core/`, keyboard, gamepad, audio and the deployment workflow are unchanged.**
- **Layout changes to existing screens.** The touch title's right column is packed tighter (PLAY 480 x 100 at y 105, volume rows 96 apart) to fit the steering row; the pause screen gains the STEERING row under MAIN MENU.
  Existing browser checks still pass unchanged apart from the PLAY tap coordinate.
- **Decisions to confirm on a phone.** (Resolved by the phone test, see the follow-up below: the D-pad is now the default and fullscreen needed no change.) A thumb that slides off the pad keeps its direction
  by angle until it lifts; the Fullscreen button is not offered during play.
- **Follow-up (2026-10-20, after testing on an Android phone): the D-pad is the default.** The phone test found the D-pad much easier to control than the joystick and fullscreen fine. `DEFAULT_STEERING` in
  `src/input/steeringMode.ts` is now `'dpad'`. Saved preferences are untouched: the choice is only ever *read* from storage at start-up and written when a button is tapped, so anyone with `joystick` saved
  keeps it and a first-time visitor writes nothing until they choose. The joystick is unchanged and one tap away on the title and pause screens. Changed: that constant (+ comment), the CSS comment about the initial state,
  `tests/steeringMode.test.ts` (default, saved joystick preserved, saved D-pad preserved, junk / blocked storage fall back to the D-pad), `scripts/touch.mjs` (sections written for the joystick default now seed a saved
  `joystick` choice, and new checks cover first-time visitor = D-pad, saved joystick not overridden, blocked storage), and these docs. No gameplay, audio, other control or deployment change.
- **Unit tests:** 966 in 39 files (845 before; +121: `touchDpad` 47, `touchDpadControls` 32, `fullscreen` 29, `steeringMode` 8, `confirmTap` 5). **Browser:** `npm run test:touch` 208 checks (101 before), incl. real four-finger multi-touch on the pad,
  a scripted Fullscreen API, the iPhone-like and standalone cases, canvas re-fit, pause state kept, six phone sizes with screenshots (`scripts/.smoke-output/touch-dpad-*.png`, `touch-fullscreen-*.png`).
- **Follow-up 2 (2026-10-20): stranded in keyboard mode.** A phone ended up in keyboard mode (saved `asteroids.inputMode = desktop`, probably from a stray tap on the CONTROLS button), where the D-pad and Fullscreen
  are not drawn, and the only way back was 16 px text that touches missed, falling through to "tap anywhere starts the game". Fixed: (1) in keyboard mode a touch-capable device shows a big green **TOUCH CONTROLS: OFF /
  TAP TO TURN ON** button (300 x 90 game px, top right); (2) on a finger-first device a tap on empty space no longer starts a game from the keyboard title screen (Space / controller still do; the prompt says "Press SPACE
  to start"); (3) in touch mode the CONTROLS (keyboard) button needs a second tap ("TAP AGAIN TO SWITCH TO KEYBOARD CONTROLS", lapses after 3 s; `src/ui/confirmTap.ts`, 5 unit tests). Touch title / pause layout otherwise unchanged;
  gameplay, audio, mappings and deployment untouched. Browser suite: +6 checks (one tap only asks, the question lapses, a late tap re-asks, the way back is >= 44 CSS px and labelled, stray taps on the phone's keyboard title do not
  start a game, the confirming tap switches); two timing-sensitive checks (a 60 ms tap's nudge size, which wraps rotation at 360) were made robust; the existing "same run is still there, paused" rotation check failed once in about eight
  runs on this machine and passed in the other seven and in all earlier runs (known timing flakiness, not reproduced since).
- **Regression pass on the final build (all green on the first run):** typecheck clean; unit 959/959 (961 after the default-steering follow-up); production build OK; smoke 72/72; keyboard 49/49; combat 39/39; co-op 65/65; gamepad 82/82;
  Pages validation 17/17 (at `/asteroids-bootdev/` and `/`); touch 196/196 (202/202 after the follow-up, which re-ran unit, build, touch, keyboard 49/49 and Pages 17/17). Known unrelated flakiness is unchanged and did not show this time (timing-sensitive smoke / keyboard checks fail
  intermittently on this machine with and without these changes; rerun before investigating).
- **Not verified:** a real phone (either steering scheme, thumb comfort, the pad's size), real fullscreen on Android, anything on iPhone (the absence of the button, the tip, the Home Screen launch), safe-area insets in fullscreen
  or on a notched device, and everything fullscreen-related over HTTPS (the GitHub Pages build). The test machine's headless Chromium does engage real fullscreen from a real touch, but its window does not grow, so it cannot show the address bar disappearing.
- **Known limitations:** fixed pad position and size (no left-handed mirror), no haptics, no orientation lock, no PWA / manifest / service worker (documented separately), the iPhone Home Screen launch may still open in Safari on older iOS until the standalone configuration exists.

### Phase 6c: mobile release readiness (2026-10-20)

An independent review before the pull request. Baseline was taken first (everything committed at `895e01f`, tree clean): typecheck clean, unit 966/966, build OK, keyboard 49/49,
combat 39/39, co-op 65/65, gamepad 82/82, Pages 17/17; smoke 71/72 (the known SFX sample-shot flake); touch **aborted** by one timeout (see "Known test flakiness" in mobile-touch.md).

- **Confirmed by probes and fixed** (each with a browser check that fails on the old code and passes now; 11 new touch checks, 5 new unit tests):
  1. Two fingers or a palm landing together on CONTROLS (tap for keyboard), or a bounce, counted as the confirming second tap. `ConfirmTap` now ignores a second touch
     within 300 ms of the first.
  2. Two fingers together on the keyboard screen's TOUCH CONTROLS: OFF switched touch on and straight back off. `StartScene.switchInputMode` now runs once per screen.
  3. The touch pause screen's MAIN MENU lies under the D-pad. After an automatic pause, one tap on the pad's Up arm quit the run at 667 x 375 and 740 x 360. It now takes
     two taps (`ConfirmTouchButton` in `touchMenus.ts`, shared with the keyboard switch).
  4. The desktop game had lost its right-click menu (the touch layer prevented `contextmenu` in every mode); now only in touch mode.
- **Verified unchanged / fine:** fresh visitor gets touch + D-pad with nothing stored; saved joystick kept; `?touch=0/1/auto` predictable and never stored; rapid
  landscape / portrait flips with thumbs on the pad and FIRE leave the run paused, neutral and coherent; rotation while paused and on the title screen; desktop D-pad-mode
  frame time 16.7 ms avg under forced heavy spawning (same as desktop). Audio gains, gameplay, layouts and `src/core/` untouched.
- **Final run:** see the Phase 6c results in the pull request description and mobile-touch.md (unit 971/971, touch 219/219, smoke 72/72, keyboard, combat, co-op, gamepad and Pages all green).
- **Left as known limitations:** the pause screen's JOYSTICK button is also under the pad (switches steering, cannot lose the run); repeated deliberate presses can still confirm
  MAIN MENU; the keyboard-mode recovery button's caption is small. Not verified on a phone: everything in this entry, and iPhone.

## Phase 7: selectable soundtrack (2026-10-20)

Full write-up: [music-tracks.md](music-tracks.md) (files, behaviour, loudness measurements, memory, tests, listening checklist).

- **Feature:** a Track row (Original, Mega Man, Gatekeeper, Random) on the title and pause screens, with keyboard, mouse, gamepad and
  touch controls; saved as `asteroids.musicTrack`; **Random by default** (Original is the fall-back track). Random picks per new game (never the previous track) and holds
  through pause, focus, mute, orientation and scene changes.
- **Audio lifecycle:** `MusicController` gained the soundtrack choice (`setChoice`, `beginRun`, `reportUnavailable`) and its player
  interface gained `stop` / `setSource`; `PhaserMusicTrack` downloads and decodes a track on demand, fades the old sound out in 40 ms,
  destroys it, keeps at most two decoded tracks, and falls back to Original (with a console warning) when a track cannot be loaded.
  The pause, mute, volume and Mega Power paths are unchanged.
- **Loading:** the boot screen loads the effects and only the saved track; the other two music files download on first selection.
- **Mix:** `MUSIC_MAX_GAIN` and every `SFX_GAIN` are untouched; the music level is now master x Music setting x a per-track multiplier
  (Original 1.00, Mega Man 1.65, Gatekeeper 1.55, from ffmpeg loudness measurements; a listening test decides the final values).
- **Files touched outside the feature itself:** `StartScene` / `GameScene` (row positions, `beginRun`, X on the title pad), `BootScene`
  (what it loads), `touchStartMenu.ts` (power-up legend moved up ~20 px to make room for the selector), the controller help text, and the
  browser scripts (music instances are counted as `key.startsWith('music')`; `pages-check.mjs` serves `.mp3` and checks the lazy loading).
- **A controller alone cannot unlock browser audio** (a button press is not a user gesture): on the title screen the first key press, click or tap does it, as before.
- **Not changed:** simulation, scoring, power-ups, controls and their mappings, fullscreen, steering settings, effects mix, the Python
  game, the Pages workflow.

## Phase 8: mobile haptics (2026-10-20)

Full write-up: [haptics.md](haptics.md) (effects, rules, menus, browsers, tests, limitations, the Android test script and what to tune).

- **Feature:** four effects from existing sim events, no change to `src/core/`: Boost 30 ms (`boost_started`), Laser 55 ms (`laser_fired`), damage 65 ms (`player_hit`),
  death 110 ms (`player_eliminated` / `game_over`). Only successful events: a refused Boost or Laser, or a hit a Shield absorbs, emits no event and no buzz.
- **Manager:** `src/haptics/` (`HapticManager`, `NavigatorVibrationAdapter`, `HapticSettings`, the pattern table). Priorities (death > damage > boost = laser, a lower one never interrupts a
  running higher one, nothing queued), per-effect cooldowns, an 80 ms gap for the medium effects, an injectable clock. One effect per simulation step: a fatal hit emits damage and death together
  and plays only the death effect, whatever the event order.
- **Cleanup:** `vibrate(0)` on HAPTICS off, pause, blur, hidden tab, `pagehide`, scene shutdown and game destroy; one manager per game (registry), listeners added once.
- **UI:** the title and pause screens' full-width music button became three switches: MUSIC, HAPTICS (OFF by default, saved as `asteroids.haptics`) and TEST VIBRATION.
  Touch UI only: the keyboard / controller screens and runs are untouched, and `GameScene` forwards events to the manager only in touch mode.
- **Files touched outside the feature itself:** `GameScene` / `StartScene` / `BootScene` (wiring), `touchMenus.ts` (`TouchVolumeBlock` signature and layout), `touchStartMenu.ts`, and `touch.mjs`
  (a Haptics section, plus the mute-by-touch check's tap position).
- **Not changed:** simulation, scoring, power-ups, controls, audio mix, fullscreen, steering, the Python game, the Pages workflow. Gamepad rumble, iOS workarounds and the other deferred
  haptics (pick-ups, shields, revive, kill streaks, user-configurable durations) are not implemented.

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
5. One player: start at the screen centre, respawn at (320, 360); arrow keys work as well as WASD (not with two players: see Phase 4).
6. HUD simplified (`P1`, `Lives`, clock, ability lines); no high-score list; browser monospace font.
7. Screen shake offsets the playfield layer (stars and HUD stay put) rather than using the camera.
8. M toggles music mute at any time (Python only while paused); a mute preference is remembered. Music and SFX volumes
   are adjustable and remembered too (Python has fixed levels).
9. Added a brief pick-up flash ring; Python has no pick-up feedback or sound beyond the HUD and ship colour.
10. Shield-absorbed collisions play the explosion but not the death sound (Python plays death only when a life is lost).
11. Armored asteroids rammed by a boost break after 2 *frames* of contact, as in Python; that is faintly frame-rate dependent.

Original quirks deliberately **kept** (Phase 3): UFO kills do not count for the combo; UFO shots kill asteroids for the combo but not for
score; boost does not stop UFO shots; UFOs spawn 60 px outside their own wrap line and jump across first; losing a life keeps the combo.
(Phase 3 also kept "a shield lasts one frame against a UFO body", "the laser ignores UFOs" and "continuous mode never spawns small UFOs";
Phase 4 changed those three on purpose.)

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
- Phaser is bundled in full (1.4 MB, 357 KB gzip); the default music file adds 1.4 MB of audio, and each extra soundtrack (3.9 MB and 3.0 MB) is downloaded only when somebody picks it (Phase 7).
- Only Chrome has been tested; nothing was run on Firefox, Safari, a physical GPU or a touch device. Refresh rates other
  than 60 Hz are covered by unit tests, not a real display.
- The smoke test needs a locally installed Chrome / Edge / Chromium (set `CHROME_PATH` if it is not in a standard place).
- `?debug` exposes `window.__game` (the Phaser game and live sim) for tests and inspection. It grants nothing a
  console user could not do anyway, but it is a development hook; it is off unless the URL asks for it.
- The Multi-Shot pick-up icon is small, matching Python's drawing (arrows only one radius long).

## Not implemented yet (deferred)

Wave mode (and with it the wave-based UFO schedule), death taunts, high-score screen, online leaderboards, more than
two players, key remapping.

## Next steps

1. **Decide on the spawn quirk** (only large asteroids): keep the original difficulty, or spawn at `-radius` so all sizes
   appear (≈3× more asteroids at the same rate). It also determines how often power-ups drop.
2. Listen to the audio and adjust `MUSIC_MAX_GAIN`, `SFX_GAIN` and the overlap values in `src/audio/audioConfig.ts`; decide on the Mega speed-up.
3. ~~Decide on the two Python gaps found in Phase 3~~ (done in Phase 4: the laser kills UFOs; small UFOs arrive gradually).
4. Optional UFO polish: a quiet spawn / fire cue (the unused `enemy-ship*.ogg` are candidates) with its own gain in `audioConfig.ts`.
5. ~~Two players~~ (done in Phase 4). Next candidates: a short audio cue for Revive / elimination (needs a listening session), key remapping UI,
   a two-player-aware `?keydebug` capture per player.
6. High scores in `localStorage`; touch via `PlayerInput` (gamepads are done in Phase 5: the pad hub produces the same `PlayerInput`, and a touch controller can be one more source in `readPlayerInputs`).
