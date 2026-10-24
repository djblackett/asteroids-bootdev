# Experiment D, Phase 1: local mothership trial

Run `npm run dev` from `phaser-asteroids`, then open
`http://127.0.0.1:5173/?bosstrial=1`. Choose **PLAY** on desktop or **PRACTICE**
on mobile. The usual keyboard, controller, touch, and co-op settings apply.
**RESET BOSS TRIAL** at the bottom centre restarts the entire scene, including
after defeat or game over. Regular RETRY also starts a fresh trial.

The Dreadnaught is a 340-pixel angular capital ship drawn with procedural graphics:
dark layered armor, cyan hull edges, purple shoulder plates, red vents, animated
running lights, small aft engines, two turret mounts, and a central reactor.
A warning precedes its eased arrival from above. It settles at y=235 and sweeps
260 pixels either side of centre on a roughly 20-second cycle without wrapping.

Each turret takes 18 hits. The core takes 40 and remains protected until both
turrets are destroyed. All targets extend forward of the hull so bullets approaching
from below can reach their visible damage circles. Hull hits make sparks without
damage. Destroyed turrets leave broken mounts and brief flying debris. The exposed
reactor glows magenta, with an announcement and brighter damage reactions.
The combined 76 HP drives the top-centre health bar below the ordinary clock.

Turrets share one cycle: 4 seconds of attack opportunity, then a 1-second charge
with a pulsing amber glow on the charging turret, followed by one projectile.
The left and right turrets take turns; a lone survivor keeps the same 5-second
cycle. Destroying a charging turret cancels its shot and starts a fresh opportunity.
At charge start, the turret snapshots the nearest eligible player's position.
It fires from its current muzzle toward that fixed world position without
retargeting when either co-op player moves. Projectiles travel at 170 pixels/second,
down from 210, with the existing muzzle flash. Adjust `BOSS_ATTACK` in
`src/boss/bossSim.ts` to tune the opportunity, charge duration, and shot speed.
Shots use the existing hostile projectile list and the normal player damage rules,
including shields, invulnerability, elimination, and shared lives.

Player bullets deal one direct hit, including charged bullets. Chain Lightning
still works normally elsewhere and never jumps between boss sections. Lasers keep
their normal piercing behaviour, with one hit per section per beam, including
remembering contact with a protected reactor.

Reactor death stops firing and clears remaining enemy shots. Lights flicker,
eight small explosions run across the hull, and a final blast removes it after
1.8 seconds. **MOTHERSHIP DESTROYED! +2000 POINTS** accompanies one flat payout
to the player who finished the reactor. Explosions cause no gameplay damage.

Existing samples provide low-pitched turret fire, a light damage tick, turret
explosions, and deeper reactor/final explosions through the existing SFX volume
and voice limits. The selected soundtrack continues throughout. Dedicated boss
music and transitions are deferred; no music assets were created or preferences
changed.

## Isolation and validation

Only an explicit `bosstrial=1` in a development, casual, unrecorded GameScene
dynamically imports the helper. It takes priority if both trial flags are present;
the existing `lightningtrial` helper otherwise remains unchanged. Production
browser and Node replay outputs contain no boss modules, labels, or trial flag.
No gameplay rules version, replay schema, scoring era, or historical leaderboard
mapping changes were made.

The trial subclasses the existing simulation in `src/dev/bossTrialSim.ts`, running
it and the boss at fixed 60 Hz with a repeatable seed. The production `GameSim`
is unchanged. Graphics, HUD and sound dispatch live in separate development files.
Normal asteroid and UFO spawning are disabled for the encounter. Reset constructs
a new simulation, clearing RNG, clocks, players, weapons, score, effects, and shots.

Balancing follow-up validation: all 22 focused boss tests and TypeScript checking
pass. Tests cover the quiet window, full charge duration, locked target position,
sequential surviving-turret cadence, charge cancellation, co-op target eligibility,
and deterministic solo/shared/independent co-op behaviour at 30/60/120 Hz.
A short local Chromium check confirms both charge glows, one 170-pixel/second shot
per cycle, the existing trial entry and reset, and no browser runtime errors.
Charge screenshots are `scripts/.smoke-output/boss-charge-left.png` and
`scripts/.smoke-output/boss-charge-right.png`. No full suite was run for balancing.

Initial Phase 1 validation: TypeScript and local production/browser/replay builds pass. The
focused Vitest selection passes 192 tests across boss, Lightning, laser/UFO,
co-op combat, audio, ranked and replay suites; 15 cover this prototype directly.
A short local Chromium check confirms genuine bullet damage on turrets and the
exposed reactor, exposure/defeat/bonus, desktop reset, mobile Practice/touch reset,
ordinary-play isolation, and verified-replay isolation, without runtime errors.
A separate short check starts the ranked GameScene using an intercepted mock
challenge: `bosstrial=1` adds neither boss state nor reset controls. No score
submission is sent.
Screenshots are in the ignored `scripts/.smoke-output/boss-*.png` files.

## Playtest focus and deferred work

Watch whether keyboard players have enough time to turn, position, aim and attack
between defensive manoeuvres, whether the charge glow is clear, and whether the
170-pixel/second shots still feel threatening. Health remains 18/18/40; small
targets and leading the sweep also need mobile playtesting.
Once both turrets are gone, the core has no remaining attack;
that quiet finish is intentional for this first pattern. Hull contact causes no
damage in this prototype.

Additional attack patterns, beams, drones, missiles, phase changes, full cinematic
destruction, dedicated music, normal-play scheduling, and ranked/release versioning
are deferred. All changes are local; nothing was committed, pushed or deployed.

## Phase 4 integration

The shared mechanics now live in `src/boss/`; the development trial is an immediate-start adapter.
Normal and ranked gameplay use the same scheduled simulation. See [integration and local playtesting](boss-integration.md).
