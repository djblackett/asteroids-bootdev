# Focused developer testing

Minor UI edits: make the smallest change, inspect through the existing Vite server, and run a focused
TypeScript check only when useful. Two minutes is a ceiling, not a target. No production builds or
browser/unit sweeps for cosmetic changes. GitHub Actions retains its normal checks when shipping is requested.

For gameplay mechanics, choose the existing tests that exercise the affected behavior:

```sh
npm test -- tests/combat.test.ts     # substitute the relevant existing Vitest file
npm run test:feature -- combat      # existing combat browser suite, fresh production build
npm run test:feature -- combat ranked-input  # both suites, one build
npm run test:feature -- --no-build combat    # reuse dist after test-script-only changes
```

`--no-build` is explicit: rebuild after changing source, public assets, environment variables or build
configuration. The default always runs the existing `npm run build`, including TypeScript and the Node
replay build. Existing named test commands, release/deployment checks and security gates are unchanged.
The feature command accepts explicit suite names only; no default broad sweep, retries or ignored failures.
It stops at the first failed suite. Each child command has a ten-minute limit; exceeding it is a failure.
Longer legacy suites can still use their existing commands. Run from `phaser-asteroids/`.

Available names: `smoke`, `keyboard`, `combat`, `coop`, `gamepad`, `touch`, `music`, `menu`,
`mobile-entry`, `pages`, `replay`, `ranked`, `ranked-ui`, `ranked-input`, `worker`.
For a mobile-entry feature, select `mobile-entry`; this already covers PLAY, PRACTICE, touch readiness,
error paths and desktop entry. It is unnecessary for a cosmetic label edit.

Scoring, replay verification, authentication, persistence and security changes require explicit risk
identification and appropriate focused/integration checks. Production replay checks continue to use real
runs and verification. This change does not replace or recertify the release process.

## Measured comparison (2026-10-23)

Windows, Node, installed Chromium 155, headless SwiftShader. Same source/build and existing assertion
sets; sequential suites without competing test processes. One before/after pair, not a statistical benchmark.
Times include process startup/cleanup and exclude builds unless stated.

| Test | Before | After | Checks |
| --- | ---: | ---: | ---: |
| Combat browser | 58.711 s | 47.906 s | 39/39 both |
| Ranked input, real Worker/D1 | 50.221 s | 28.274 s | 22/22 both |

Initial build stages: TypeScript 0.649 s, frontend 3.604 s, Node replay 0.324 s (4.577 s total,
excluding npm wrapper overhead). Each additional selected suite previously repeated these stages through
its build-first alias. The new batch runs that unchanged build command once.

Combat's measured browser-check body was 56.604 s before and 46.935 s after. Preview and Chromium
startup together were 0.489 s before. Ranked input bootstrap was D1 migration 9.837 s, Worker 1.929 s,
preview 0.344 s and Chromium 0.229 s. After, those were 2.561 s, 1.432 s, 0.331 s and 0.171 s.
The faster D1 migration reflects warm caches/host variation, not a migration optimization. Do not attribute
the entire ranked-input reduction to the code changes or extrapolate these results to unmeasured suites.

Raw phase timings and PASS output are retained locally under ignored `scripts/.smoke-output/narrow-*`.
Set `TEST_TIMINGS=1` for optional phase diagnostics on standalone combat/ranked suites; the batch prints
timings by default. No full suite was run for this work.

A final `npm run test:feature -- combat ranked-input` invocation verified the new command itself:
one build (1.628 s), combat 49.420 s (39/39), ranked input 25.045 s (22/22). This second after sample
confirms the direction of the change, while also showing ordinary host/cache variation. Work stopped
within the announced 20-minute budget; no retries or further browser runs were needed.

## Kept changes and limits

- Wait for real collision consumption, UFO destruction, armor damage, pause/resume and restarted simulation
  readiness in combat instead of arbitrary padding. All 39 assertions remain, including exactly-once events.
- Observe the real menu input lock and animation-frame consumption for focused ranked-input taps and title
  readiness. The production lock, clock and input behavior are never altered.
- Preserve natural UFO spawn timing, projectile/laser observation windows, held-input durations, shield grace,
  combo/banner expiry, retry delay, pause stability and the eight-second performance sample.
- Terminate the owned Wrangler/preview process tree on Windows to avoid orphaned workerd instances.
- Keep per-suite Chromium and empty D1 databases. Subsecond browser startup does not justify pooling;
  different Worker settings/state make sharing more complex. No existing Vite server is stopped or replaced.

Remaining costs: actual simulation/performance observation windows, page/asset initialization in isolated
browser contexts, screenshots and real D1 migrations. Assertions and isolation remain more valuable than
removing these costs. No full-release speedup is claimed. The broader unfinished experiment remains stashed;
its release runner, fingerprinting, worker-count tuning and unrelated fixture fixes were not restored.
