# Experiment D, Phase 3 — local mothership presentation

Run from `phaser-asteroids` with `npm run dev`. Open the Vite localhost URL with
`?bosstrial=1`, then start a casual game. `?bosstrial=1&bosscore=1` starts directly
with the reactor exposed. These controls remain development-only. Normal games,
production builds, and ranked replays use the shared encounter scheduled at 60
active seconds; see [Phase 4 integration](boss-integration.md).

## Entrance and audio

The supplied `sound-effects/Robotic Alarm Sound.mp3` is preserved. Its byte-identical
runtime copy is `public/audio/sfx/robotic-alarm.mp3`, registered as `boss_alarm` in
the existing SFX system. Measurements with ffprobe/ffmpeg:

- File duration: **20.013500 seconds**, 48 kHz stereo.
- Whole-file mean level: **−16.5 dBFS**; peak approximately **0 dBFS**.
- Integrated loudness: **−15.4 LUFS**; loudness range **10.2 LU**.
- Alarm mix gain: **0.55 × SFX setting** (0.44 at the default 80%; about 7.1 dB peak headroom).

The regular soundtrack fades over 0.8 seconds. The alarm starts at 0.8 seconds,
once per entrance. The ship begins descending at 1.1 seconds; engines activate at
2 seconds, turrets at 8 seconds, reactor at 13 seconds. The alarm fades over the
**0.4 seconds** before the **11-second** handoff, when combat, Gatekeeper and the
health-bar reveal start together. The original descent curve continues unchanged
to its resting position at 14 seconds; no repositioning or acceleration occurs. The
health bar fills over 0.75 seconds. Playback is trimmed at runtime; the MP3 is unchanged.
After five seconds, click/tap **ENGAGE NOW** or press **Enter** to end the entrance
early. This deliberate shortcut stops the alarm and settles the ship before combat.
The reactor shortcut skips the entrance entirely.

Gatekeeper is prepared at entrance setup through the shared music player's cache.
It becomes a temporary music override at combat, with no preference write and no
Random reroll. An already playing Gatekeeper instance is retained. Volume, music
mute, game pause and focus/visibility remain under the shared audio controller.
The previous track for this run is restored when the victory announcement appears.
Restored tracks resume as a new loop from the beginning; playback position is not
saved. An unavailable track falls back without blocking combat.

The alarm fade multiplies SFX volume, including live changes while it plays or is
paused. Its envelope follows the simulation clock and freezes on pause. Pausing or
losing visibility pauses it; returning to the tab requires the normal explicit
game resume. Reset/scene exit stops it. If SFX is zero or the asset is unavailable
when its cue is issued, it is silent for that entrance; the fixed timeline proceeds.
No loading or completion callback advances gameplay.

## Destruction and return

Times below are relative to the fatal reactor hit:

- **0–0.65 seconds:** movement and attacks stop; reactor and hull lights fail.
- **0.65–2.27 seconds:** ten staggered internal explosions, seam fractures, sparks
  and local panel fragments. Explosion sounds use the existing voice/overlap limiter.
- **2.6 seconds:** main reactor detonation, two expanding shock fronts, one short
  restrained screen bloom, brief shake, and 56 procedural hull/spark fragments.
- **3.3 seconds:** `MOTHERSHIP DESTROYED!` and `+2000 POINTS`. The existing simulation
  awards the bonus once to the player who destroyed the reactor. Music is restored.
- **6.5 seconds:** the victory hold ends, transient boss effects/UI clear, lighting
  returns to normal, and ordinary asteroid/UFO scheduling resumes in the same run.

Lives, score, power-ups and their remaining timers survive the cinematic. Ordinary
rules freeze during arrival and destruction, including friendly fire. The player
stays visible at the prepared approach position during arrival. Boss projectiles,
beam and charges clear on defeat. Reduced-motion mode removes new camera motion,
flash, fast flickering and flying debris, retaining subdued static wreckage/victory.
Effects draw into a fixed number of batched Graphics objects with bounded geometry.

## Focused checks and listening

```
npm run typecheck
npx vitest run tests/bossCinematic.test.ts tests/bossTrial.test.ts tests/audio.test.ts tests/audioMix.test.ts tests/musicTracks.test.ts --maxWorkers=2
node scripts/boss-cinematic.mjs
npm run build
```

The browser script uses a temporary loopback Vite server and real Chromium Web Audio;
screenshots go to ignored `scripts/.smoke-output/boss-*.png`. It exercises normal
arrival, pause, live SFX volume/mute, music restoration, scoring, ordinary gameplay,
resets, visibility, failed Gatekeeper loading, and mobile reduced-motion presentation.
It uses actual weapon collisions to finish the boss quickly after testing combat entry.
The original boss tests retain the approved HP, attacks, cadence and refresh-rate checks.

Original Phase 3 validation: 188 focused unit tests, 14 focused Chromium checks, TypeScript checking,
and both production builds pass. Desktop arrival/combat/destruction/victory and
mobile reduced-motion screenshots were inspected. The production JavaScript has
no trial implementation; the recording's runtime copy matches the source SHA-256.

For manual listening, start with Music/SFX at 80%, play the whole entrance once,
try pausing during the alarm, and compare Gatekeeper's entry against the alarm's
fade as the ship settles. Then try the reactor shortcut and watch through the return to normal play.
Use RESET BOSS TRIAL to repeat; it starts a new run, so Random may choose a new track.
The recording has a wide loudness range and a strong final pulse: its perceived
balance and the layered destruction sounds still need human listening on speakers
and headphones. Automated checks validate playback/gains/lifecycle, not perceived mix.
