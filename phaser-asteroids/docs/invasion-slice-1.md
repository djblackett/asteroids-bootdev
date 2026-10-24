# Classic and Invasion (Slice 1)

Choose a mode on the title screen before starting a run. Classic is the default. The selector supports mouse, touch, keyboard Left/Right or Enter, and controller D-pad/A through the shared menu. The selection stays in the scene registry across retries and returns to the menu; a page reload resets it to Classic. A running simulation captures its mode at construction.

Desktop PLAY starts casual play in the selected mode. Mobile PLAY still requests ranked play; PRACTICE starts unranked play. Invasion ranked requests display an unavailable message and offer an explicit practice action. Selecting Classic clears that message. Co-op options continue to apply to casual runs in either mode.

## Try it locally

From `phaser-asteroids`, run `npm run dev` and open the Vite URL. Select Classic and PLAY on desktop (PRACTICE on mobile) for ordinary endless survival. Select Invasion and use the same casual action for the encounter. Survive two active minutes; pauses and focus loss do not advance the encounter clock.

Development shortcuts remain `?bosstrial=1` for immediate entrance and `?bosstrial=1&bosscore=1` for exposed-core combat. Start a casual run to enter the trial. These override the menu mode and are unavailable in production builds and verified/ranked runs. The trial's ENGAGE NOW action is available after five seconds.

## Timing and reward

- Arrival: tick 7,200 at 60 Hz (120 active seconds), independent of score.
- Previous soundtrack fade: encounter age 0–0.8 seconds.
- Original alarm starts at 0.8 seconds; fades from 8.6–9.0 seconds.
- Combat, Gatekeeper music and health-bar reveal start at 9 seconds. The bar fills over 0.75 seconds.
- Descent is unchanged: at nine seconds the center is approximately y=214; it settles at y=235 at fourteen seconds. Desktop and mobile screenshots show a usable handoff without a movement adjustment.
- Final core hit starts the existing destruction sequence. Detonation is at death age 2.6 seconds; victory, score award and previous-music restoration are at 3.3 seconds. Ordinary spawning resumes at death age 6.5 seconds.
- The fixed 20,000 points go directly to the final hit's owner, contributing once to the existing team total. Combo multipliers do not apply. The victory message shows the award. Lives and abilities survive the cinematic; boss projectiles and temporary effects are cleared. There is no second encounter.

## Scope and verification

Classic delegates directly to the original simulation, retaining casual frame stepping, spawning, scoring and difficulty. Verified/ranked simulations default to Classic. The replay format, gameplay rules version and leaderboard schema are unchanged. Server test fixtures now expect Classic outcomes instead of the earlier unconditional boss integration.

Validation commands:

```text
npm run build
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --testTimeout=30000
node scripts/modes.mjs
node scripts/menu.mjs
```

The full suite passed 1,637 tests. The final focused boss suite passed 71 tests, including Classic equivalence beyond two minutes, 30/60/120 Hz timing, flat rewards with an active combo, both co-op lives modes, destruction cleanup, enemy resumption, no repeat encounter, trials and audio lifecycle. Focused Chromium checks cover desktop/mobile entry, ranked Invasion refusal without a challenge request, nine-second combat positioning, restart and selection retention. Browser automation uses emulated devices; physical phone/controller feel and subjective audio listening remain manual checks.

The broader menu audit passed controller mode selection, navigation and input isolation. It exposed a stale five-power-up text expectation and an existing Revive/BACK overlap in the guide. The expectation now includes all six solo power-ups, and the guide rows were tightened to clear BACK. The final focused browser run verified the corrected guide on desktop and a 667×375 phone, including a screenshot inspection. The entire multi-viewport audit was not repeated after those fixes; it can be rerun with `node scripts/menu.mjs` (or `--layout-only` for layouts).

No ranked Invasion, backend implementation or schema changes, commits, pushes or deployments are part of this slice.
