# Experiment C: Chain Lightning (local, awaiting playtest)

Implemented locally. Do not commit, push, merge or deploy until Dave has playtested and approved it.

## Playtest

From `phaser-asteroids`, run `npm run dev`, then open:

<http://127.0.0.1:5173/?lightningtrial=1>

On desktop choose **PLAY** (Space). On mobile choose **PRACTICE** (then **START PRACTICE** if shown).
The trial is deliberately unavailable in ranked and `?verified` / `?seed` recordings.

The ship starts facing a fixed row of standard, armoured and volatile rocks. A real Lightning pickup
is collected immediately. Hold the normal fire control: the first bullet kills the first rock,
strips one armour hit, then jumps to a volatile rock whose explosion propagates normally.
Tap **RESET LIGHTNING TRIAL** to restore the layout and collect a fresh 7-second pickup.
Select two players on the desktop title screen to get a separate row and pickup for each ship.
Reset clears other power-ups; collect natural drops during regular play to try combined effects.

The reset button and fixture module are dynamically imported only in Vite development, only in
casual play. The production build contains neither the helper import nor its reset UI.
Remove the query parameter and start a new game for ordinary play with random drops.
For a phone, the existing `npm run dev:lan` workflow also accepts `?lightningtrial=1` on its local game URL.

## Rules and presentation

- `CHAIN_LIGHTNING_DURATION = 7`, `CHAIN_LIGHTNING_MAX_TARGETS = 2` additional targets,
  `CHAIN_LIGHTNING_RANGE = 160` in `src/core/constants.ts`.
- The existing ordinary 12% roll now chooses uniformly among five types. Mega retains its separate
  first 1.5% roll: the unconditional ordinary chance remains 0.985 × 12% = 11.82%,
  about 2.364% per ordinary type. Revive keeps its existing co-op replacement policy.
- Collection refreshes the collector's timer. Charge is captured separately on every bullet at firing
  time, including Multi-Shot bullets. Rapid Fire keeps its normal cadence. Mega neither grants Lightning
  nor pauses its timer; independently collected Lightning can coexist with Mega.
- Each jump uses centre-to-centre squared distance, includes the exact 160px boundary, and does not wrap.
  Equal distances keep asteroid-list order. Dead, dying and previously lightning-struck rocks are ineligible.
  A surviving armoured initial hit can start a chain. The consumed bullet can start only one chain.
- Every hit uses the existing asteroid-hit path: one armour HP, or a normal kill with the existing combo,
  scoring and drop roll. All credit goes to the original bullet owner, including volatile blast kills.
  Blasts resolve synchronously before the next target is chosen, so blast-killed rocks cannot be paid again.
  Surviving armour can still take normal damage from distinct volatile blasts, as in Experiment B.
- Lightning never targets ships, UFOs, pickups or lasers. Original bullet collisions, including friendly
  fire and UFO damage, retain their existing rules. No chains originate from blast kills or laser hits.
- Cyan bolt pickup, cyan bullet halo/trail with the owner-coloured core retained in co-op, jagged blue-white
  links, six small procedural sparks per impact, and a 160ms glow/fade. A cyan `LIGHTNING: Ns` countdown
  uses the existing per-player ability HUD, including when Mega is active.
- The original 110ms synthesized zap uses the existing audio asset/mix infrastructure, SFX volume and
  mute controls. At most one electrical voice plays at once, with a 90ms minimum start interval.
  Regenerate its small WAV with `python scripts/generate-lightning-sfx.py`.
- Decoration is capped at 24 simultaneous chains. Neither procedural rendering nor the audio RNG
  consumes simulation RNG. Dropping presentation state cannot change damage, drops or replay outcomes.

## Validation and remaining judgement

518 focused tests passed across 16 files: Lightning, power-ups, armour/volatile interactions, co-op
combat, players, lasers, audio, menu text, replay determinism/validation, ranked clients and server
lifecycle/leaderboards/time limits. Frontend/server TypeScript checks and the production build passed.
The trial page, module and audio asset returned HTTP 200; the production bundle excludes the helper.

The genuine existing seed-54321 reference game naturally collects and discharges Lightning. Its entire
event sequence, including destruction order, is identical when replayed by the authoritative ranked
verifier, with score **34735** under `1.2.0` (Experiment B's reference was 13959 under `1.1.0`).
This one changed trajectory is a regression fixture, not a balance estimate.

No browser was available through this session's UI tools, so the visual, audible and subjective gameplay
playtest remains for Dave. No full browser suites or extended automated playthroughs were run.
Watch the strength of Rapid Fire + Multi-Shot + Lightning, volatile chain density, whether 160px produces
enough visible jumps in early play, and cyan readability beside Shield/on phones.

## Version and release boundary

The local client and authoritative server share rules **1.2.0**; replay schema remains **1**.
The explicit scoring map preserves **1.0.0 → V1**, **1.1.0 → V2**, and adds **1.2.0 → V3**.
ALL TIME includes all supported eras with stored labels, THIS WEEK uses the current era, and historical
personal bests remain available. No migration or rewriting of stored historical scores is required.
Verification remains strict for current rules; historical leaderboard support does not grant replay compatibility.

After approval, coordinate client/server rules cutover and allow active old-rules runs to drain first.
The experimental client will reject a production V2 challenge. Nothing has been deployed by this work.
