# Asteroids

A browser arcade game built with **Phaser 4 and TypeScript**: asteroid survival, UFO combat, power-ups, local co-op, and online ranked scores verified by replaying your inputs on the server.

It began as a [Boot.dev](https://boot.dev) guided Python/Pygame project. The course baseline was extended with new gameplay and presentation, then ported to the browser with a separate gameplay simulation, cross-device input, and a ranked-play backend. The original Python implementation remains in this repository.

**[Play Asteroids in your browser](https://djblackett.github.io/asteroids-bootdev/)** — no installation required.

On desktop, choose **PLAY** for casual play or **RANKED** for a competitive run. On a phone, turn to landscape: **PLAY** starts an online ranked run; **PRACTICE** plays without submitting a score. The **CONTROLS** menu shows the active input scheme.

## What the game offers

- **Survival and combat:** asteroids split into smaller rocks, with armored and volatile variants adding tougher targets and chain explosions. Large UFOs fire randomly; small UFOs aim at players. Difficulty increases as a run continues.
- **Abilities and scoring:** laser beams, boost ramming, rapid fire, multi-shot, shields, slow motion, Chain Lightning, and Mega Power. Chain kills for combo multipliers and kill-streak banners.
- **Local two-player co-op:** independent or shared lives, optional friendly fire, speed handicaps, and Revive pickups when a teammate is eliminated.
- **Arcade presentation:** procedural visuals, particles, screen shake, a parallax starfield, menus, saved audio settings, and three selectable soundtracks: Original, MegaPop, and Gatekeeper, plus a Random option.

The public game is released from `main`. This branch also contains an **Invasion mode in development**, with a cinematic mothership encounter. It is available for local casual/co-op play, does not support ranked play, and is not part of the public build checked on October 29, 2026. See the [current mode notes](phaser-asteroids/docs/invasion-slice-1.md).

## Controls and devices

- **Keyboard:** solo play uses W/S to move, A/D to turn, Space to fire, E for the laser, and Shift to boost. Two players can share a keyboard, with an alternative Player 2 layout for keyboards that struggle with simultaneous keys.
- **Gamepad:** browser-standard controllers support analogue movement, weapons, and menu navigation. Keyboard/controller combinations and two assigned controllers support local co-op. Press a controller button so the browser can detect it, then join or assign it in the menu.
- **Touchscreen:** landscape, single-player play with on-screen weapons and three movement choices. **Classic D-Pad** rotates and thrusts; **Point-to-Fly** turns toward the stick direction and flies along the ship's nose; **Assisted Flight**, the default for new players, steers travel toward that direction more directly. Touch controls do not provide two-player play.

Fullscreen is offered where the browser supports it; portrait orientation pauses play with a rotation prompt. Optional vibration feedback uses the browser Vibration API on supported Android devices and can be disabled in CONTROLS. It is unavailable on iPhone Safari.

See the [full keyboard and controller mappings](phaser-asteroids/README.md#controls), [touchscreen guide](phaser-asteroids/docs/mobile-touch.md), [movement modes](phaser-asteroids/docs/movement-modes.md), and [haptics notes](phaser-asteroids/docs/haptics.md). Automated mobile checks use Chromium emulation; the device notes also record limited hands-on testing on a Samsung Galaxy S25 with Android Chrome. They do not establish broad physical-device or iPhone compatibility.

## How it is built

The frontend uses **Phaser 4.2.1**, **TypeScript with strict checking**, and **Vite**. The architecture separates the rules of the game from the browser that presents it:

- [`src/core/`](phaser-asteroids/src/core/) holds gameplay state and rules without Phaser imports. The same simulation can run in the browser, in Node tests, and on the verification server.
- [`src/input/`](phaser-asteroids/src/input/) translates keyboard, gamepad, and touch actions into shared player commands. Scenes connect those commands to the simulation; rendering, audio, and UI handle presentation.
- [`src/replay/`](phaser-asteroids/src/replay/) supplies seeded randomness, normalized input recording, and fixed-step execution for verified runs. Replaying the same seed, configuration, and inputs lets the backend reproduce a result independently of rendering frame rate.

This separation makes gameplay rules testable without a canvas or audio device and lets ranked verification reuse the gameplay implementation. Casual play remains independent of the leaderboard service. See the [Phaser developer guide](phaser-asteroids/README.md) and [replay architecture](docs/deterministic-replay.md); the latter also contains historical prototype measurements, rather than current performance guarantees.

## Ranked play and leaderboard

Ranked play is deployed on the public site and is single-player, with a 20-minute simulated-play limit. A **Cloudflare Worker** issues each run's seed, approved configuration, and rules version. The browser records input changes; before accepting a score, the server replays them through the shared simulation and calculates the result itself. **D1** stores accepted scores for all-time and weekly boards. Personal bests remember server-confirmed results in the current browser; they are not an account-based cross-device profile.

This is server-side score verification: it checks that a result follows the issued rules, but does not prove a human played. Scoreboards distinguish scoring eras. The release workflow checks the Worker's replay/rules versions before publishing the frontend; a run spanning an incompatible rules update can still be rejected.

The live backend reported rules `1.2.0` when checked on October 29, 2026; this branch uses `1.3.0`. Local ranked testing therefore needs a matching local backend. See the [verification model and leaderboard design](docs/leaderboard-backend.md), [backend setup](phaser-asteroids/server/README.md), and [coordinated deployment guide](phaser-asteroids/docs/deployment.md).

## Run locally

Use **Node.js 22 (22.12 or newer)** and npm; CI uses Node 22. This satisfies both Vite and the locked Vitest version. From a checkout of this repository:

```bash
cd phaser-asteroids
npm ci
npm run dev
```

Open the Vite URL, normally `http://localhost:5173`. Casual play works without starting the leaderboard backend; on a phone, choose PRACTICE for that path.

```bash
npm test              # Vitest unit and server tests
npm run typecheck     # strict TypeScript checks
npm run build         # frontend in dist/ and headless replay bundle in dist/node/
npm run preview       # preview the build, normally http://localhost:4173
npm run test:browser  # build and run the browser smoke suite
```

Browser automation uses `playwright-core` with an installed Chrome, Edge, or Chromium; set `CHROME_PATH` if needed. Backend development has a separate dependency install and local D1 setup: follow the [server README](phaser-asteroids/server/README.md).

## Testing

Vitest suites cover gameplay, input mapping and lifecycle, co-op, audio state, touch movement, deterministic replays, and ranked server acceptance/rejection rules. Browser scripts exercise keyboard combat, co-op, simulated gamepads, multi-touch, menus, browser-to-Node replay parity, and ranked flows. Additional integration scripts run the Worker against local D1.

The release workflow gates publication on type checks, unit/server tests, a production build, browser checks of the Pages asset paths, and Worker compatibility checks. The larger browser suites run separately; their existence is not a claim that every suite or physical device is checked on every release. See [test commands](phaser-asteroids/README.md#run-it), [focused testing](phaser-asteroids/docs/test-performance.md), and [release checks](phaser-asteroids/docs/deployment.md#the-workflow).

## Project history: Python/Pygame

The Boot.dev baseline covered a rotating/thrusting ship, spawning and splitting asteroids, bullets, and game over on collision. Subsequent development added UFOs, abilities and pickups, co-op, scoring systems, gamepad controls, particles, menus, and audio. The Phaser port became the primary browser implementation, replacing the older pygbag deployment with a native browser game and adding touch input and ranked verification.

The Python source remains at the repository root, starting with [`main.py`](main.py). For desktop play, create and activate a Python virtual environment, then run:

```bash
pip install -r requirements.txt
python main.py
```

The repository's [Python version pin](.python-version) is 3.13; [requirements.txt](requirements.txt) pins pygame 2.6.1. Python tests use `pytest`. Historical pygbag setup is in [BUILD_WEB.md](BUILD_WEB.md); its GitHub Pages deployment instructions are superseded by the [Phaser deployment guide](phaser-asteroids/docs/deployment.md). Pygbag-specific audio and controller limitations belong to that older build.

## Credits and licensing

- **Course foundation:** [Boot.dev](https://boot.dev) guided Asteroids project; the additions above extend that baseline.
- **Sound credit:** “Heavy/Big Sci-Fi Cinematic Explosion (w/ Tail)” by [EvanBoyerman on Freesound](https://freesound.org/s/530885/), listed as Attribution 3.0 in [sound-effects/attributions.txt](sound-effects/attributions.txt).
- **Music:** the [soundtrack notes](phaser-asteroids/docs/music-tracks.md) describe MegaPop as original music, but do not provide complete authorship and reuse terms for all music and effects.

The previous README stated **MIT**, but this repository currently has no accompanying LICENSE file. Code licensing and the provenance/reuse terms of the remaining audio assets need clarification; the earlier MIT label should not be treated as a blanket license for every asset.
