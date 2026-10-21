# Music tracks and soundtrack selection (Phase 7)

Players can choose the background music: **Original**, **MegaPop**, **Gatekeeper** or **Random**. This page records how it
works, the loudness measurements behind the per-track gains, and how it is tested. Nothing about the effects mix, gameplay,
controls, fullscreen or the deployment changed.

## Files

| Track | File (in `public/audio/music/`) | Size | Format | Length |
|---|---|---|---|---|
| Original | `retro-bgmusic.ogg` (unchanged) | 1.47 MB | Ogg Vorbis, 48 kHz stereo, ~171 kbps | 68.6 s |
| MegaPop | `megapop.mp3` | 3.88 MB | MP3, 48 kHz stereo, 192 kbps | 161.5 s |
| Gatekeeper | `gatekeeper.mp3` | 2.97 MB | MP3, 48 kHz stereo, 192 kbps | 123.7 s |

The two MP3s were already present (converted from the original `.m4a` recordings with FFmpeg at about 192 kbps) in the repository's
top-level `music/` folder, untracked. They were **copied** into `public/audio/music/`; the sources in `music/` were not touched and no
M4A / WAV source recordings are part of the web build. Chrome, Firefox, Safari and Android WebView all decode MP3; the original
stays Ogg.

**Rename (2026-10-21).** The second track was first shipped as "Mega Man" (`megaman.mp3`, id `megaman`, Phaser key `music-megaman`). It is all original music, so it is now **MegaPop**: label `MegaPop`, file `megapop.mp3`, id `megapop`, key `music-megapop`.
The file was only renamed: its SHA-256 is identical before and after, nothing was re-encoded, trimmed or normalised, and the gain is unchanged (1.65). The old `megaman.mp3` is no longer published, and nothing in `src/` or the build requests it.
A saved `megaman` still works, see Behaviour.

## What the player sees

A **Track** row, in the same retro text style as the Music / SFX rows, on the title screen and the pause screen:

```
  Music ████████░░  80%
  SFX   ████████░░  80%
> Track <  MegaPop  >
```

| Input | Title screen | Pause screen |
|---|---|---|
| Keyboard | Up / Down select the Track row, Left / Right previous / next | the same |
| Mouse | click the left half of the row = previous, right half = next (does not start the game) | the same |
| Gamepad | **X** = next track (D-pad left / right still pick 1 or 2 players) | D-pad up / down select the row, left / right change it |
| Touch | `<`  `MUSIC: NAME`  `>` at the bottom left, under the power-ups (arrows = previous / next, the name = next) | the same control, bottom right under the volume block |

The order is Original, MegaPop, Gatekeeper, Random, and it wraps. The touch selector is built from three `TouchButton`s of the
standard 90 game-px height (at least 44 CSS px on every tested phone) and never starts the game, resumes it or dismisses the pause menu.

## Behaviour

* **Default** (no saved value, or a stale / invalid one): **MegaPop** (since 2026-10-21; before that it was Random). Original is only the fall-back track (when another cannot be loaded) and the choice of anyone who picks it. Every explicit saved choice wins over the default, Random included, which behaves exactly as before. The choice is saved in `localStorage` under
  `asteroids.musicTrack` as `original`, `megapop`, `gatekeeper` or `random` (Random is saved as a mode, never as a file name). Nothing
  else (volumes, mute, steering, input mode) is read or written by the selector.
* **Old saved `megaman`.** Earlier builds saved MegaPop as `megaman`. `loadMusicChoice` reads that as `megapop` (`LEGACY_MUSIC_TRACK_IDS` in `audioConfig.ts`), so a returning player keeps their track and the old file is never requested. The stored value is not rewritten; the next time the player picks a soundtrack the new id is saved. The alias is read-only: `megaman` is not a choice the menus or `MusicController.setChoice` accept. Music OFF (`asteroids.musicMuted`) and the Music / SFX volumes are separate keys and are untouched by the default or the alias.
* **An explicit track** switches at once, from its beginning, if the music is audible; if the game is paused, muted or the window is
  unfocused it starts when the music is next audible. The old sound is faded out over 40 ms (a hard cut mid-wave clicks) and then
  destroyed, so only one music sound ever plays and nothing is orphaned. The track loops (`loop: true`) for the whole run.
* **Random** picks a track in `MusicController.beginRun()`, which `GameScene.create()` calls: the first game, every RETRY and every game
  started from the title screen. It never picks the track that just played (while another exists). The pick made at start-up is kept
  for the first game, so the title screen's music carries on into it. Pause, resume, blur / focus, mute, volume, fullscreen,
  orientation, Main Menu, game over and scene changes never re-roll. Choosing Random while a track is playing leaves that track playing
  until the next new game.
* **Mute and volume** work across tracks (the music pause path is unchanged, volume goes to the playing sound's gain node and never restarts it).
* **Failure** (404, network error, undecodable data): the game logs `[asteroids] music track "MegaPop" could not be loaded; playing
  "Original" instead`, plays Original, keeps the player's saved choice, and does not retry the broken file on every pause / resume. The
  next new game (or choosing the track again) tries it again. If Original itself cannot load the game simply continues without music.

## Loading and memory

* The boot screen loads the effects and **one** music file: the saved track (MegaPop for a new visitor; for Random the track picked for
  the first game: any of the three, so that may be 1.5, 3.0 or 3.9 MB of music). The other two files are not requested until somebody picks them (checked in `scripts/music.mjs` and
  `scripts/pages-check.mjs`).
* A track that is not decoded yet is fetched with a relative URL (`audio/music/megapop.mp3`, which works from the GitHub Pages project
  path and a custom domain alike), decoded with the Web Audio context and put in Phaser's audio cache under `music-megapop` /
  `music-gatekeeper` (Original keeps its old key `music`). A download for a track that was replaced before it arrived is aborted.
* Decoded audio is big (about 0.4 MB per second of stereo at 48 kHz: Original ~26 MB, Gatekeeper ~47 MB, MegaPop ~62 MB), so at most
  **two** decoded tracks (`MAX_DECODED_MUSIC_TRACKS`) stay in memory: the playing one and the previous one. Going back to an older one
  downloads it again (the browser's HTTP cache usually answers) and decodes it, which can take a second or two on a phone.
* Browsers without Web Audio (HTML5 audio fallback) can only play the track the boot screen loaded; picking another falls back to Original.

## Per-track gain (loudness)

Level of the music = Music setting x `MUSIC_MAX_GAIN` (0.7, unchanged) x the track's own `gain` (`MUSIC_TRACKS` in `audioConfig.ts`).
The effects mix (`SFX_GAIN`, explosion ratios, overlap limits, UFO scale) is untouched.

Measured with `ffmpeg -af ebur128=peak=true` (EBU R128 integrated loudness, K-weighted, so not just peak level) and `volumedetect`:

| Track | Integrated | Loudness range | Mean (RMS) | Peak | Gain chosen | Gain needed to match Original |
|---|---|---|---|---|---|---|
| Original | -9.9 LUFS | 5.3 LU | -12.1 dB | 0.0 dBFS | **1.00** | 1.00 |
| MegaPop | -14.3 LUFS | 1.6 LU | -16.6 dB | -2.9 dB | **1.65** | 1.66 (4.4 LU quieter) |
| Gatekeeper | -13.8 LUFS | 1.7 LU | -16.1 dB | -2.2 dB | **1.55** | 1.57 (3.9 LU quieter) |

The multipliers are the measured differences rounded down a little (about -0.1 dB) so neither new track is ever the louder one. At the
default Music setting the gains reaching Web Audio are 0.56 (Original), 0.924 (MegaPop) and 0.868 (Gatekeeper); at Music 100 % the
tracks peak at about -1.7 and -1.5 dBFS, so nothing clips. No compressor, limiter or ducking was added.

The two new tracks are far more constant than the Original (loudness range 1.6 / 1.7 LU against 5.3), so equal integrated loudness is a
starting point only. **The final balance, including against the effects, is a listening job** (see the checklist below): tune the two numbers.

## Code map

| File | Role |
|---|---|
| `src/audio/audioConfig.ts` | `MUSIC_TRACKS` (id, label, file, key, gain), default, storage key, memory and fade constants |
| `src/audio/musicTracks.ts` | pure helpers: validation, cycling, persistence, `pickRandomTrack`, start-up resolution |
| `src/audio/musicController.ts` | the state machine: choice, current track, `beginRun`, fall-back; unchanged pause / mute / rate logic |
| `src/audio/phaserAudio.ts` | `PhaserMusicTrack` (one sound, lazy download + decode, fade, cleanup, memory cap) and `AudioDirector` |
| `src/ui/menu/pages/audio.ts` (`MUSIC TRACK` row, a `MenuStepper`) | the keyboard / mouse / touch control, on the AUDIO page of the title and pause menus ([menus.md](menus.md)); X on a controller still steps it on the title screen |
| `src/scenes/BootScene.ts` | loads the effects and only the needed music file |

## Tests

* `tests/musicTracks.test.ts` (51): definitions and files, per-track gain maths, validation / defaults / persistence / stale values /
  blocked storage, Random (no repeat, coverage, determinism, start-up pick), the controller (switching, paused / muted / unfocused,
  pause-resume-volume never switching, Random per run, fall-back).
* `tests/phaserMusicTrack.test.ts` (24, Phaser mocked): one sound only, fades and cleanup, aborted downloads, shared downloads, 404 /
  network / decode failures, the autoplay lock, the two-track memory cap, controller + player together.
* `scripts/music.mjs` (`npm run test:music`, real headless Chrome): which files are downloaded when, one music sound after every kind of
  switch, keyboard / mouse / gamepad / touch selection, pause-time changes, mute, volume with a boosted track, retry / menu / reload,
  Random across retries, failure fall-back (404, corrupt data, network error), rotation and fullscreen-style resizes, no console errors.
* `scripts/pages-check.mjs` also checks that the extra tracks are not downloaded at start-up, load from under the base path (at
  `/asteroids-bootdev/` and `/`) when chosen, and that a saved choice plays after a reload.

These prove the wiring and the lifecycle. They do not prove how anything sounds.

## Manual listening checklist

Desktop (speakers, then headphones) and the Android phone:

1. Fresh profile (or clear site data): the AUDIO page shows `MegaPop`; press a key: MegaPop plays; reload a few times and it is MegaPop every time. Pick Original and check it is the same loudness as before this change.
2. Pick MegaPop, then Gatekeeper: each starts within a second or two (a little longer on mobile data the first time), **no click or pop** at the switch, no overlap of two songs.
3. Compare the three at the same Music setting against a burst of shooting and an explosion: are they about equally loud? If not, nudge `gain` in `MUSIC_TRACKS`.
4. Check each track at Music 100 % and at 30 %: no distortion, still audible.
5. Let each track loop at least twice: is the loop point seamless (MP3s can leave a tiny gap if the encoder delay is not trimmed)?
6. Pause, change the track on the pause screen, resume: the new track plays from its start; nothing plays while paused.
7. Mute, change the track, unmute: the new track plays. Lower / raise Music: no restart.
8. Random: start several games (RETRY, Main Menu then play): a different track each time, never the same twice in a row; the track holds through pause / resume / app switching / rotating the phone / fullscreen.
9. Reload the page: the choice (including Random) is still selected.
10. Phone: the selector arrows are easy to hit with a thumb on the title and pause screens, and tapping them never starts or resumes the game.
