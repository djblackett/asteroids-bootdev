# Mothership gameplay integration — local Phase 4

Nothing has been committed, pushed, merged, or deployed. This is the local playtest candidate.

Run `npm run dev` from `phaser-asteroids`, open the printed localhost URL, and start an ordinary casual/practice or cooperative game. No trial URL is needed. For a repeatable single-player ordinary run, use `/?verified=1&seed=54321`; this records locally and does not submit a ranked score. Play normally until 60 active seconds. Pauses do not advance the simulation.

The one trigger constant is `FIRST_BOSS_ENCOUNTER_SECONDS` in `src/boss/bossSim.ts`. The encounter starts after tick 3,600 at 60 Hz. The approved entrance lasts 660 further ticks: combat, Gatekeeper, and the health bar begin at run tick 4,260 (71 active seconds). The alarm fades from entrance age 10.6 to 11 seconds. The original 0.8-second music fade, descent curve, placement, visual activations, HP, attacks, and recovery are retained.

At arrival, the simulation clears asteroids, UFOs, hostile shots, and in-flight player weapons directly, without kill points, drops, or collision events. It suspends both ordinary spawners. Living players take the established cinematic approach positions; eliminated teammates stay eliminated. Score, lives, abilities, respawn protection, and pickups remain intact. Ordinary simulation and power-up timers freeze throughout the entrance and destruction hold. Combat uses the normal shooting, laser, boost, shield, projectile damage, friendly-fire and co-op rules; charged shots retain their established direct hit against boss sections.

The same production simulation runs casual/practice, independent/shared-life co-op, locally recorded play, ranked play, and authoritative replay verification. The development-only `?bosstrial=1` and `?bosstrial=1&bosscore=1` retain immediate testing, reset, and the five-second skip. Those shortcuts are excluded from production and recorded/ranked play; the normal encounter always uses its deterministic 11-second entrance.

Victory runs the existing destruction/detonation and message sequence, awards 2,000 points once to the credited player, restores the run's previous music, clears boss attacks and UI, and resumes the same ordinary game after the 6.5-second aftermath. Ordinary asteroid spawning restarts with a fresh timer; the UFO spawner resumes its prior enabled setting with its normal continuous-spawn delay. The encounter latch stays set, so the boss cannot recur. A restart creates a fresh simulation. Final-life loss applies normal game over and clears boss attacks and presentation; one co-op elimination leaves the teammate playing.

Rules are now **1.3.0 / V4**. V1 (1.0.0), V2 (1.1.0), and V3 (1.2.0) mappings remain. ALL TIME and personal history retain historical eras; THIS WEEK uses V4. The service accepts current-rule recordings only. No database schema change, migration, or score reset is needed. Ranked limits count all replay ticks, including cinematics, so arrival cannot extend a run. Normal play has no repeat/skip hook. Pause produces no simulation ticks.

Focused verification commands:

```powershell
npm run typecheck
npm run typecheck --prefix server
npx vitest run tests/bossIntegration.test.ts tests/bossCinematic.test.ts tests/bossTrial.test.ts tests/replayDeterminism.test.ts tests/replayValidation.test.ts tests/timeLimit.test.ts tests/ranked.test.ts tests/chainLightning.test.ts tests/volatileExplosion.test.ts server/tests/bossReplay.test.ts server/tests/lifecycle.test.ts server/tests/leaderboard.test.ts server/tests/timelimit.test.ts
npm run build
node scripts/boss-integration.mjs
node scripts/boss-cinematic.mjs --timing-only
```

The server regression tests submit genuine recordings generated solely from normal controls through the actual challenge/submission router and SQLite-backed database adapter. Seed 54321 with the boss pilot defeats the boss once, continues ordinary gameplay, and ends at 13,064 points after 11,801 ticks. A second recording allows spreading volleys and the sweeping beam before a natural game over; the victory recording also exercises reactor pulses. A separate issued 65-second limit ends during the entrance at tick 3,900 and rejects even one extra tick. The server independently reproduces scores, rejects V3 and inflated bonus claims, and handles resubmission idempotently. A production Chromium recording independently verifies to the same 13,064 points and 11,801 ticks in the built Node verifier. The browser check also inspects the actual handoff, hazard clearing, pause/focus, music restoration, game over, restart, and production trial exclusion. Long portions of these browser replays are advanced in fixed ticks to keep validation focused.

Validation completed locally: 448 focused tests passed; browser and server TypeScript checks passed; browser and Node production builds passed; the real-time trial timing check passed all five checks. The production browser recording verified successfully with the score and tick count above.

The remaining release decision is human approval after playing the natural 60-second encounter and listening to the mix. Public release requires deploying matching client and authoritative server rules together; no deployment was performed here. Runtime audio gain/lifecycle checks do not replace subjective listening.
