# Mothership local trial — Phase 2

Run `npm run dev` from `phaser-asteroids`, then open the printed local URL with
`?bosstrial=1`. Start an ordinary casual game from the title screen. For the
reactor shortcut, use `?bosstrial=1&bosscore=1`. Click **RESET BOSS TRIAL** to
restart the current trial, including the shortcut if selected. The seed, attack
order, weapons, lives, score and effects all reset. Controls are unchanged.

The existing `DEV && !isVerifiedMode && !rankedChallenge` import guard stays in
place. Neither shortcut activates in ranked/recorded games or production builds.
No rules version, leaderboard era, normal enemy behavior or encounter spawning
has changed. Phase 3 entrance, music and destruction work remains out of scope.

## Patterns and balance

| System | Pattern | Timing / tuning |
| --- | --- | --- |
| Shared scheduler | Left and right alternate; destroyed slots stay quiet | 4 seconds of recovery after each attack finishes; ordinary warning + recovery = 5 seconds |
| Left cannon | Single, single, spread, repeat | 1 second locked warning; spread has 3 shots at −18°, 0°, +18°; speed 170 px/s, radius 8 |
| Right turret | Single, single, sweeping beam, repeat | Ordinary shots use the same cannon speed and warning |
| Beam | Locked initial ray, curved directional arrow and faint final ray; magenta beam sweeps a fixed 30° | 1.5 second charge, 1.25 second active time, 12 px damaging width, then 4 seconds recovery |
| Beam direction | First special sweeps clockwise on screen; next special sweeps the other way | Alternates deterministically; the full direction is shown during charging |
| Reactor | Circular charge with six fixed spokes; six pink projectiles at 60° spacing | First pulse fires 6.5 seconds after exposure; subsequent pulses every 6.5 seconds, including 1 second charge; speed 145 px/s |
| Projectile lifetime | Fade at the end, then disappear before the next warning | 3.5 seconds; no lingering volley during the beam |
| Health / reward | Left 18 HP, right 18 HP, reactor 40 HP | Original 2,000-point defeat bonus unchanged |

The mothership holds position during warnings and active beams so its movement
cannot change a telegraphed path. Aim is copied and converted to a fixed angle
when the warning begins. Moving or changing the nearest co-op player cannot
retarget it. Each beam may touch each ship once, including a contact absorbed by
a shield or respawn protection; it cannot repeatedly spend shields or lives.
Beam hits use the existing hostile damage path, including shared lives, death
events and boost's ordinary lack of projectile protection.

Destroyed turrets retain their damaged appearance. Destruction cancels their
warning or active beam, clears their in-flight projectiles, and permanently
removes their attack slot. The survivor receives no damage or frequency boost:
ordinary shots from it remain at least 10 seconds apart after the first surviving
turn. Beam cycles are longer because recovery starts after the sweep finishes.

Exposure clears remaining hazards and announces **CORE EXPOSED!** for 2.4 seconds.
The reactor glows, hull lighting turns red, and lateral movement runs at 1.2 times
its original phase rate. The first pulse charge waits 5.5 seconds. Six widely
separated, nontracking spokes leave a clear gap directly below the reactor as
well as between all the other spokes. Ordinary player shooting continues.

All motion, scheduling and damage remain in the fixed 60 Hz trial simulation.
Drawing uses the existing batched Graphics objects. Audio uses restrained pitched
variants of existing samples through the normal SFX volume and overlap controls;
neither presentation system consumes gameplay RNG.

## Focused validation

`npm test -- --run tests/bossTrial.test.ts` covers ordinary attacks and specials,
alternation, preserved recovery, fixed targeting, spread directions, beam timing,
sweep hits and safe regions, keyboard rotation/thrust evasion, shields, boost,
respawn protection, co-op lives, turret cancellation, reactor pulses, reset,
production/ranked isolation and identical traces at 30/60/120 Hz.

Run `npm run typecheck` for TypeScript checks. Full browser suites are unnecessary
for this local prototype. Subjective difficulty and the mix on speakers/mobile
still need human playtesting; scripted evasion is evidence of an escape route,
not a substitute for judging how the encounter feels.

Local validation: all 155 tests passed across `bossTrial`, `laser`,
`chainLightning`, `coopCombat` and `audio` (44 boss tests). `npm run build` passed,
including TypeScript and both client/replay builds; the built bundles contain no
boss trial code. A focused headless Chromium check rendered spread warnings,
volleys, beam warnings/sweeps and reactor exposure/charge/pulses, verified both
reset modes and recorded-mode isolation, and reported zero page errors. Captured
frames were visually inspected. This was a narrow development-trial check, not
the full browser suites or a mobile performance benchmark.
