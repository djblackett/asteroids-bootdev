# Experiment B: volatile explosions (local only)

Experiment A remains in place. Both experiments belong to the unpublished rules `1.1.0`; replay schema remains `1`.
No Worker deployment, production leaderboard changes, commits or pushes were performed.

## Gameplay

- `VOLATILE_EXPLOSION_RADIUS` in `src/core/constants.ts` starts at **110 world pixels**. The target's collision
  radius counts: a radius-20 rock touching a blast at a centre distance of 130 is hit.
- Every volatile destruction detonates once, including shots, lasers, boost rams, UFO shots and body collisions.
  Only living, non-dying asteroids are eligible. Ships, UFOs, shots and pickups take no blast damage.
- Each blast visits a snapshot of the asteroid list once. Destruction marks a rock dying before it can be
  targeted again. Newly destroyed volatile rocks append a blast to an explicit breadth-first queue, processed
  synchronously in stable asteroid-list order. There is no recursive chain traversal or lingering damage zone.
- Standard rocks die; armor takes one ordinary hit per blast. Two overlapping blasts can finish armored rocks.
- Player credit follows the entire chain. Kills use the existing combo, points and multiplier calculation,
  and the existing power-up drop rules. No explosion bonus multiplier was added.
- UFO-initiated chains pay nobody, retaining the existing uncredited-hit combo/drop rules. A body collision
  still pays nothing and gives no combo/drop for the original rock; subsequent blast kills remain uncredited
  and use the ordinary hit rules. Competing shots cannot steal a rock already marked dying.
- Splitting is unchanged, including volatile children. Children appear after the normal death delay and are
  outside the completed chain's target snapshot. A later, separate blast can hit them normally.
- Volatile unlock (60 seconds), spawn weight (0.12), orange color, bonus points, all Experiment A balancing,
  power-up behavior, enemy AI, player abilities and difficulty progression are preserved.

## Feedback and limits

Each detonation has its own orange/yellow expanding double ring and 12 short spark strokes, fading over
0.32 seconds. Chain links stagger their visuals by 25 ms per depth (maximum 100 ms), with immediate gameplay
damage. At most 32 blast visuals remain active. There is no fullscreen flash, texture or particle emitter.
These new visuals use no random numbers and can be discarded without changing gameplay/RNG state.

Volatile breakups replace the ordinary sound with the existing large explosion sample at a deeper playback
rate (0.8, increasing by 0.06 per chain depth up to 1.04). Existing explosion voice caps and overlap falloff
remain active. Shake requests are 6 pixels, using the existing 100 ms cooldown and global 12-pixel cap;
simultaneous chain links do not stack shake.

## Focused validation

`tests/volatileExplosion.test.ts` covers range boundaries, standard and armored damage, cyclic and dense
chains, player-2 score/combo ownership, uncredited causes, duplicate prevention, player/UFO immunity,
splitting, effect/audio caps, matching seeded outcomes with presentation discarded, and a short genuine
recording accepted by the local ranked verifier. Existing asteroid and audio tests are also relevant.

Validation passed: all 121 tests in the selected explosion/asteroid/audio files, nine targeted ranked
integration cases, and both client and server TypeScript checks. No browser suite or production build was run.

The existing genuine ranked reference replay is accepted by the authoritative local verifier with a score
of **13959** (A alone: 7884). Its longer survival also requires fixture clocks to advance by actual replay
duration instead of a fixed 200 seconds. This is a deterministic fixture result, not a balance estimate.
Both browser and server import the same updated simulation. Rules stay `1.1.0`; A-only development replays
with that version are no longer outcome-compatible. The coordinated-release considerations in
`gameplay-experiment-a.md` still apply. Production was not contacted.

## Trying it

From `phaser-asteroids`, run:

```powershell
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173/`, then **PLAY** / Space on desktop or **PRACTICE** on mobile.
Volatile spawns become eligible at 60 seconds; the unlock does not guarantee an immediate spawn.
Shoot orange rocks near groups, try overlapping blasts on armor, and try laser/boost-triggered chains.

Watch score/combo growth and drop density in clusters, the continuing threat from volatile children,
and whether the boom/rings remain readable and comfortable during larger chains on mobile.
