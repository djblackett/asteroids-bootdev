# Gameplay experiment A (local only)

Historical record of the approved A baseline. Experiment B now adds explosions on top of these settings;
see `gameplay-experiment-b.md` for current behavior and the combined ranked reference result.
The historical ranking policy below has since been replaced: ALL TIME now supports labeled V1/V2 scores,
while THIS WEEK uses the current era. See `../../docs/leaderboard-backend.md` for that policy.

Rules `1.1.0`, replay schema still `1`. Initial values:

| Setting | Previous | Experiment |
| --- | --- | --- |
| Ordinary asteroid drop roll (after failed Mega roll) | 8% | 12% |
| Mega Power roll | 1.5% | 1.5%, unchanged |
| Armored unlock | 45 s | 25 s |
| Volatile unlock / relative spawn weight | 120 s / 0 | 60 s / 0.12 |
| Small UFO chance per scheduled spawn | 0% until 120 s | 10% from 60 s |

The existing later small-UFO steps remain 20% at 120 s, 40% at 240 s and 60% at 360 s.
Volatile's normalized share after unlocking is `0.12 / (1 + 0.35 + 0.12)`, about 8.2% of new asteroid
spawn attempts; children inherit the existing archetype rules. Edge spawning/culling is unchanged.
Drop chance including Mega is `0.015 + 0.985 * 0.12 = 13.32%` per eligible asteroid destruction.
Types, durations, UFO cadence/cap/AI, health, visuals, scoring and controls are unchanged. No explosions.

Play on the Vite development server (`http://127.0.0.1:5173/`), selecting **PLAY** / Space on desktop
or **PRACTICE** on mobile for local play without a ranked backend. If the server is stopped, run
`npm run dev -- --host 127.0.0.1 --port 5173`.
Around 25 s armored rocks become eligible; around 60 s volatile rocks and occasional small UFOs become
eligible. Unlocks do not force immediate encounters: the next scheduled spawn and random roll still apply.

## Ranked release implications

Spawn/drop changes alter RNG consumption and simulation outcomes. Both client and Worker import the same
rules constant and core simulation; neither old replays nor old clients should be treated as compatible.
The local client rejects a live `1.0.0` challenge, and the `1.1.0` server rejects runs issued under `1.0.0`.
The verifier supports only the currently deployed rules, with no backward simulation implementation.

If the experiment is approved, the simplest safe approach is a coordinated frontend/Worker release under
`1.1.0`, with a planned ranked maintenance/cutover window that drains active old-rules runs first and
asks players to refresh. A staggered rollout will temporarily reject mismatched clients; outstanding old
run tokens cannot be verified after the Worker upgrade. Decide that release procedure separately.

Scores are not directly comparable across these balance rules even though point formulas are unchanged.
Existing leaderboard queries already filter by current rules version, so old rows remain stored but are
excluded from the new all-time/weekly rankings. No database reset or data migration is needed; historical
board browsing is not implemented by this experiment. No production data or deployment was changed.

The fixed-seed server test's genuine completed run now earns 7884 (previously 9114), illustrating why old
and new results must stay separate. Its replay is generated normally and independently re-simulated by
the existing verifier; no ticks, inputs or claims are padded to force a result.
