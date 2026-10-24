import { describe, expect, it } from 'vitest';
import { GameSim } from '../src/core/game';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLaser } from '../src/core/laser';
import { seededRng } from '../src/core/rng';
import { BOSS_ATTACK, BOSS_BONUS, BOSS_TOTAL_HP, BossTrialSim, bossBeamSegment, hullTouches, type BossSection } from '../src/dev/bossTrialSim';
import { bossAttackCue } from '../src/boss/bossAudio';
import { BOSS_CINEMATIC as C } from '../src/boss/bossCinematic';
import { NO_INPUT } from '../src/core/player';
import { SfxPlayer } from '../src/audio/sfxPlayer';
import { FakeBackend } from './audioFakes';
import { FRAME, runFor, shotAt, ufoShotAt } from './helpers';

function arrived(config: ConstructorParameters<typeof BossTrialSim>[0] = {}): BossTrialSim {
  const sim = new BossTrialSim(config);
  runFor(sim, C.combatStart + 0.1);
  sim.drainBossEvents();
  return sim;
}

function hit(sim: BossTrialSim, section: BossSection, owner = 1, charged = false): void {
  sim.shots.push({ ...shotAt(section.position.x, section.position.y), owner, charged });
  sim.step(FRAME);
}

function stripTurrets(sim: BossTrialSim): void {
  for (const s of [sim.boss.left, sim.boss.right]) for (let i = 0; i < 18; i++) hit(sim, s);
}

function startCharge(sim: BossTrialSim): void {
  for (let i = 0; i < 600 && !sim.boss.charge; i++) sim.step(FRAME);
  expect(sim.boss.charge).not.toBeNull();
}

function beamCharge(sim: BossTrialSim): void {
  sim.boss.nextTurret = 1;
  sim.boss.attackCounts.right = 2;
  sim.boss.attackCooldown = FRAME;
  sim.step(FRAME);
  expect(sim.boss.charge?.kind).toBe('beam');
}

describe('development mothership trial', () => {
  it('warns, enters from above, settles, and sweeps without wrapping; components follow', () => {
    const sim = new BossTrialSim();
    expect(sim.boss.phase).toBe('warning');
    expect(sim.boss.position.y).toBeLessThan(-65);
    expect(sim.boss.hp).toBe(BOSS_TOTAL_HP);
    runFor(sim, 1.5);
    expect(sim.boss.phase).toBe('entering');
    expect(sim.boss.position.y).toBeGreaterThan(-120);
    expect(sim.boss.position.y).toBeLessThan(235);
    sim.player.isRespawning = true;
    sim.player.respawnTimer = 1000;
    let previousX = sim.boss.position.x;
    for (let i = 0; i < 1800; i++) {
      sim.step(FRAME);
      const b = sim.boss;
      expect(Math.abs(b.position.x - previousX)).toBeLessThan(2);
      expect(b.position.x).toBeGreaterThanOrEqual(170);
      expect(b.position.x).toBeLessThanOrEqual(1110);
      expect(b.left.position.x).toBe(b.position.x - 112);
      expect(b.right.position.y).toBe(b.position.y + 43);
      expect(b.core.position.x).toBe(b.position.x);
      previousX = b.position.x;
    }
    expect(sim.boss.phase).toBe('fighting');
    expect(sim.boss.position.y).toBe(235);
    expect(sim.asteroids).toHaveLength(0);
    expect(sim.ufos).toHaveLength(0);
  });

  it('uses exactly 18 HP per turret, consumes one bullet once and leaves broken sections dead', () => {
    const sim = arrived();
    const b = sim.boss;
    const bullet = shotAt(b.left.position.x, b.left.position.y);
    sim.shots.push(bullet, bullet);
    sim.step(FRAME);
    expect(bullet.alive).toBe(false);
    expect(b.left.hp).toBe(17);
    expect(b.left.hitFlash).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) hit(sim, b.left);
    expect(b.left.hp).toBe(0);
    expect(b.left.destroyedAt).not.toBeNull();
    expect(sim.bossEvents.filter((e) => e.type === 'turret_destroyed')).toHaveLength(1);
    expect(b.right.hp).toBe(18);
    expect(b.core.hp).toBe(40);
  });

  it('matches the drawn hull and section boundaries: hull and protected core absorb without damage', () => {
    const sim = arrived();
    const b = sim.boss;
    hit(sim, b.core);
    expect(b.core.hp).toBe(40);
    expect(sim.shots).toHaveLength(0);
    expect(hullTouches(b, { x: b.position.x + 155, y: b.position.y }, 0)).toBe(true);
    expect(hullTouches(b, { x: b.position.x + 180, y: b.position.y }, 3)).toBe(false);
    sim.shots.push(shotAt(b.position.x + 145, b.position.y));
    sim.step(FRAME);
    expect(sim.shots).toHaveLength(0);
    expect(b.hp).toBe(BOSS_TOTAL_HP);
    expect(sim.bossFlashes.length).toBeGreaterThan(0);
    hit(sim, b.left);
    expect(b.hp).toBe(BOSS_TOTAL_HP - 1);
  });

  it('exposes the reactor only after both turrets die; charged bullets do one direct hit and never chain', () => {
    const sim = arrived();
    for (let i = 0; i < 18; i++) hit(sim, sim.boss.left, 1, true);
    expect(sim.boss.exposed).toBe(false);
    hit(sim, sim.boss.core);
    expect(sim.boss.core.hp).toBe(40);
    for (let i = 0; i < 18; i++) hit(sim, sim.boss.right);
    expect(sim.boss.exposed).toBe(true);
    expect(sim.boss.exposedAt).not.toBeNull();
    hit(sim, sim.boss.core, 1, true);
    expect(sim.boss.core.hp).toBe(39);
    expect(sim.lightningFlashes).toHaveLength(0);
  });

  it('lets each laser hit a given section once throughout the beam lifetime', () => {
    const sim = arrived();
    const left = sim.boss.left;
    const beam = createLaser({ x: left.position.x, y: 500 }, 180, 1);
    sim.lasers.push(beam);
    runFor(sim, 0.1);
    expect(left.hp).toBe(17);
    expect(beam.hit.has(left)).toBe(true);
    stripTurrets(sim);
    const core = sim.boss.core;
    sim.lasers.push(createLaser({ x: core.position.x, y: 500 }, 180, 1));
    runFor(sim, 0.1);
    expect(core.hp).toBe(39);
  });

  it('allows ordinary bullets approaching from below to reach every target before the hull', () => {
    const sim = arrived();
    for (const s of [sim.boss.left, sim.boss.right]) {
      const hp = s.hp;
      sim.shots.push(shotAt(s.position.x, s.position.y + 85, 0, -500));
      runFor(sim, 0.2);
      expect(s.hp).toBe(hp - 1);
    }
    stripTurrets(sim);
    const core = sim.boss.core;
    sim.shots.push(shotAt(core.position.x, core.position.y + 85, 0, -500));
    runFor(sim, 0.2);
    expect(core.hp).toBe(39);
  });

  it('does not let a beam that already touched the protected reactor damage it after exposure', () => {
    const sim = arrived();
    const b = sim.boss;
    b.left.hp = b.right.hp = 1;
    const beam = createLaser({ x: b.core.position.x, y: 500 }, 180, 1);
    sim.lasers.push(beam);
    sim.step(FRAME);
    hit(sim, b.left);
    hit(sim, b.right);
    runFor(sim, 0.05);
    expect(b.exposed).toBe(true);
    expect(b.core.hp).toBe(40);
  });

  it('gives four quiet seconds, charges for one second, then alternates single shots every five seconds', () => {
    const sim = arrived();
    const untilCharge = Math.round(sim.boss.attackCooldown / FRAME);
    runFor(sim, (untilCharge - 1) * FRAME);
    expect(sim.boss.charge).toBeNull();
    expect(sim.ufoShots).toHaveLength(0);
    sim.step(FRAME);
    expect(sim.boss.charge?.turret).toBe('left');
    expect(sim.boss.charge?.elapsed).toBe(0);
    expect(sim.boss.fightTime).toBeCloseTo(4 - FRAME);
    runFor(sim, BOSS_ATTACK.chargeSeconds - FRAME);
    expect(sim.ufoShots).toHaveLength(0);
    expect(sim.boss.charge?.turret).toBe('left');
    sim.step(FRAME);
    expect(sim.ufoShots).toHaveLength(1);
    expect(sim.boss.charge).toBeNull();
    const fired: string[] = [];
    const times: number[] = [];
    for (let i = 0; i <= 600; i++) {
      const events = sim.drainBossEvents().filter((e) => e.type === 'fire');
      expect(events.length).toBeLessThanOrEqual(1);
      for (const event of events) {
        fired.push(event.section!);
        times.push(sim.time);
      }
      sim.ufoShots = []; // keep the target alive for the cadence check
      sim.step(FRAME);
    }
    expect(fired).toEqual(['left', 'right', 'left']);
    expect(times[1]! - times[0]!).toBeCloseTo(5);
    expect(times[2]! - times[1]!).toBeCloseTo(5);
  });

  it('cancels a destroyed charging turret and gives its survivor a fresh full cycle', () => {
    const sim = arrived();
    startCharge(sim);
    runFor(sim, 0.5);
    sim.boss.left.hp = 1;
    hit(sim, sim.boss.left);
    expect(sim.boss.charge).toBeNull();
    expect(sim.ufoShots).toHaveLength(0);
    runFor(sim, BOSS_ATTACK.opportunitySeconds - FRAME);
    expect(sim.boss.charge).toBeNull();
    sim.step(FRAME);
    expect(sim.boss.charge?.turret).toBe('right');
    runFor(sim, BOSS_ATTACK.chargeSeconds - FRAME);
    expect(sim.ufoShots).toHaveLength(0);
    sim.step(FRAME);
    expect(sim.ufoShots).toHaveLength(1);
    sim.ufoShots = [];
    const fired = sim.drainBossEvents().filter((e) => e.type === 'fire');
    expect(fired.map((e) => e.section)).toEqual(['right']);
    const times: number[] = [sim.time];
    for (let i = 0; i < 600; i++) {
      sim.step(FRAME);
      for (const e of sim.drainBossEvents().filter((e) => e.type === 'fire')) {
        expect(e.section).toBe('right');
        times.push(sim.time);
      }
      sim.ufoShots = [];
    }
    expect(times).toHaveLength(2);
    expect(times[1]! - times[0]!).toBeCloseTo(10);
  });

  it.each([1, 2] as const)('locks a copied target position at charge start with %i player(s)', (playerCount) => {
    const sim = arrived({ playerCount });
    const target = sim.player2 ?? sim.player;
    sim.player.position = { x: 1200, y: 650 };
    target.position = { x: 500, y: 540 };
    startCharge(sim);
    const locked = { ...target.position };
    expect(sim.boss.charge?.target).toEqual(locked);
    expect(sim.boss.charge?.target).not.toBe(target.position);
    // Evade after the warning. In co-op, the other player also becomes closer during charging.
    target.position.x = 100;
    sim.player.position = { x: 1200, y: 600 };
    if (sim.player2) sim.player.position = { x: sim.boss.left.position.x, y: 340 };
    runFor(sim, BOSS_ATTACK.chargeSeconds);
    expect(sim.ufoShots).toHaveLength(1);
    const shot = sim.ufoShots[0]!;
    const dx = locked.x - shot.position.x;
    const dy = locked.y - shot.position.y;
    const length = Math.hypot(dx, dy);
    expect(shot.velocity.x).toBeCloseTo(dx / length * BOSS_ATTACK.projectileSpeed);
    expect(shot.velocity.y).toBeCloseTo(dy / length * BOSS_ATTACK.projectileSpeed);
  });

  it.each(['respawning', 'eliminated'] as const)('does not target a %s co-op player at charge start', (status) => {
    const sim = arrived({ playerCount: 2 });
    sim.player.position = { x: 800, y: 600 };
    sim.player2!.position = { x: 500, y: 400 };
    if (status === 'respawning') {
      sim.player2!.isRespawning = true;
      sim.player2!.respawnTimer = 100;
    } else sim.player2!.lives = 0;
    startCharge(sim);
    expect(sim.boss.charge?.target).toEqual(sim.player.position);
  });

  it('fires slow aimed hostile projectiles, kept separate from player bullets', () => {
    const sim = arrived({ playerCount: 2 });
    startCharge(sim);
    runFor(sim, BOSS_ATTACK.chargeSeconds);
    const shot = sim.ufoShots[0]!;
    expect(shot).toBeDefined();
    expect(Math.hypot(shot.velocity.x, shot.velocity.y)).toBeCloseTo(BOSS_ATTACK.projectileSpeed);
    expect(shot.velocity.y).toBeGreaterThan(0);
    expect('owner' in shot).toBe(false);
    expect(sim.shots).toHaveLength(0);
    const p2 = sim.player2!;
    shot.position = { ...p2.position };
    shot.velocity = { x: 0, y: 0 };
    const events = sim.step(FRAME);
    expect(p2.lives).toBe(2);
    expect(sim.player.lives).toBe(3);
    expect(events).toContainEqual({ type: 'player_hit', source: 'ufo_shot', livesLeft: 2, player: 2 });
    expect(shot.alive).toBe(false);
  });

  it('uses ordinary shields, respawn protection and shared co-op lives for boss shots', () => {
    const sim = arrived({ playerCount: 2, livesMode: 'shared' });
    const p = sim.player;
    const initialLives = sim.sharedLives!;
    p.shieldActive = true;
    sim.ufoShots.push(ufoShotAt(p.position.x, p.position.y));
    sim.step(FRAME);
    expect(p.shieldActive).toBe(false);
    expect(sim.sharedLives).toBe(initialLives);
    sim.ufoShots.push(ufoShotAt(p.position.x, p.position.y));
    sim.step(FRAME);
    expect(sim.sharedLives).toBe(initialLives - 1);
    expect(sim.player2!.lives).toBe(initialLives - 1);
    sim.ufoShots.push(ufoShotAt(p.position.x, p.position.y));
    sim.step(FRAME);
    expect(p.lives).toBe(initialLives - 1);
    expect(p.isRespawning).toBe(true);
  });

  it('stops attacking at reactor death, explodes, and awards exactly one flat bonus to its killer', () => {
    const sim = arrived({ playerCount: 2 });
    stripTurrets(sim);
    for (let i = 0; i < 40; i++) hit(sim, sim.boss.core, 2);
    expect(sim.boss.phase).toBe('dying');
    expect(sim.boss.core.hp).toBe(0);
    expect(sim.ufoShots).toHaveLength(0);
    expect(sim.totalScore).toBe(0);
    runFor(sim, C.victory + FRAME);
    expect(sim.boss.phase).toBe('destroyed');
    expect(sim.boss.explosionCount).toBe(10);
    expect(sim.player2!.score).toBe(BOSS_BONUS);
    expect(sim.player.score).toBe(0);
    expect(sim.bossEvents.filter((e) => e.type === 'destroyed')).toHaveLength(1);
    expect(sim.bossEvents.filter((e) => e.type === 'core_destroyed')).toHaveLength(1);
    expect(sim.boss.detonated).toBe(true);
    expect(sim.bossEvents.filter((e) => e.type === 'detonation')).toHaveLength(1);
    runFor(sim, 3);
    expect(sim.totalScore).toBe(BOSS_BONUS);
    expect(sim.ufoShots).toHaveLength(0);
    expect(sim.players.map((p) => p.lives)).toEqual([3, 3]); // explosions are decoration
  });

  it('restarts with fresh deterministic state, projectiles, lives, weapons, effects and score', () => {
    const used = arrived();
    hit(used, used.boss.left);
    used.player.score = 900;
    used.player.lives = 1;
    used.ufoShots.push(ufoShotAt(0, 0));
    used.lasers.push(createLaser({ x: 0, y: 0 }, 0, 1));
    // The RESET control restarts GameScene: its guarded installer always constructs a fresh trial.
    const reset = new BossTrialSim(used.config);
    expect(reset.boss.hp).toBe(76);
    expect(reset.boss.phase).toBe('warning');
    expect(reset.time).toBe(0);
    expect(reset.player.lives).toBe(3);
    expect(reset.player.score).toBe(0);
    expect(reset.player.rotation).toBe(180);
    for (const list of [reset.shots, reset.ufoShots, reset.lasers, reset.bossFlashes, reset.bossEvents, reset.asteroids, reset.powerups]) expect(list).toHaveLength(0);
    expect(reset.player.laser.shotsRemaining).toBe(new BossTrialSim().player.laser.shotsRemaining);
  });

  it.each([
    { playerCount: 1 as const },
    { playerCount: 2 as const, livesMode: 'independent' as const },
    { playerCount: 2 as const, livesMode: 'shared' as const },
  ])('repeats identical charges, shots and damage across display rates with $playerCount player(s), $livesMode lives', (config) => {
    const sims = [new BossTrialSim(config), new BossTrialSim(config), new BossTrialSim(config)];
    const traces = sims.map((sim, i) => {
      const fps = [30, 60, 120][i]!;
      const events = [];
      for (let frame = 0; frame < fps * 18; frame++) {
        events.push(...sim.step(1 / fps), ...sim.drainBossEvents());
      }
      return events;
    });
    expect(traces[1]).toEqual(traces[0]);
    expect(traces[2]).toEqual(traces[0]);
    expect(sims[1]!.boss).toEqual(sims[0]!.boss);
    expect(sims[2]!.ufoShots).toEqual(sims[0]!.ufoShots);
    expect(sims[2]!.player).toEqual(sims[0]!.player);
    expect(sims[2]!.player2).toEqual(sims[0]!.player2);
  });

  it('has no boss state in the regular/authoritative GameSim', () => {
    const sim = new GameSim({ rng: seededRng(4) });
    expect('boss' in sim).toBe(false);
    expect('bossEvents' in sim).toBe(false);
  });

  it('alternates two singles then a special per turret, with four clear recovery seconds and no overlapping hazards', () => {
    const sim = arrived();
    sim.player.lives = 100;
    const attacks: string[] = [];
    let lastEnd = -Infinity;
    let wasActive = false;
    let chargeKind = '';
    for (let i = 0; i < 60 * 70; i++) {
      const b = sim.boss;
      // Keep a live target through multiple complete cycles, outside a firing beam's path.
      sim.player.position = b.beam ? { x: 40, y: 40 } : { x: 640, y: 620 };
      sim.player.shieldActive = true;
      sim.step(FRAME);
      expect(Boolean(b.charge && b.beam)).toBe(false);
      const active = Boolean(b.charge || b.beam);
      if (active && !wasActive) {
        expect(sim.time - lastEnd).toBeGreaterThanOrEqual(4 - FRAME - 1e-8);
        expect(sim.ufoShots).toHaveLength(0);
        chargeKind = b.charge!.kind;
        attacks.push(`${b.charge!.turret}:${chargeKind}`);
      }
      if (!active && wasActive) lastEnd = sim.time;
      if (b.beam) expect(sim.ufoShots).toHaveLength(0);
      if (!active && wasActive && chargeKind === 'spread') expect(sim.ufoShots).toHaveLength(3);
      wasActive = active;
    }
    expect(attacks.slice(0, 12)).toEqual([
      'left:single', 'right:single', 'left:single', 'right:single', 'left:spread', 'right:beam',
      'left:single', 'right:single', 'left:single', 'right:single', 'left:spread', 'right:beam',
    ]);
  });

  it('fires exactly three slow shots at the warned centre and +/-18 degrees, without retargeting', () => {
    const sim = arrived();
    sim.boss.attackCounts.left = 2;
    sim.boss.attackCooldown = FRAME;
    sim.step(FRAME);
    const charge = structuredClone(sim.boss.charge!);
    expect(charge.kind).toBe('spread');
    const bossX = sim.boss.position.x;
    sim.player.position = { x: 60, y: 600 };
    runFor(sim, charge.duration);
    expect(sim.boss.position.x).toBe(bossX);
    expect(sim.ufoShots).toHaveLength(3);
    sim.ufoShots.forEach((shot, i) => {
      const angle = charge.angle + (i - 1) * BOSS_ATTACK.spreadRadians;
      expect(shot.position).toEqual(charge.origin);
      expect(shot.velocity.x).toBeCloseTo(Math.cos(angle) * 170);
      expect(shot.velocity.y).toBeCloseTo(Math.sin(angle) * 170);
    });
    expect(sim.drainBossEvents().filter((e) => e.type === 'fire')).toEqual([{ type: 'fire', section: 'left', kind: 'spread' }]);
    // Even shots fired across the long axis expire before the next warning.
    for (const shot of sim.ufoShots) { shot.velocity = { x: 0, y: 0 }; }
    runFor(sim, BOSS_ATTACK.projectileLifetime);
    expect(sim.ufoShots).toHaveLength(0);
    expect(sim.bossProjectiles.size).toBe(0);
    expect(sim.boss.charge).toBeNull();
  });

  it('locks the beam warning, charges for 1.5s, sweeps 30 degrees over 1.25s, then recovers for 4s', () => {
    const sim = arrived({ playerCount: 2 });
    beamCharge(sim);
    const charge = structuredClone(sim.boss.charge!);
    sim.player.position = { x: 40, y: 40 };
    sim.player2!.position = { x: 1200, y: 40 };
    runFor(sim, BOSS_ATTACK.beamChargeSeconds - FRAME);
    expect(sim.boss.beam).toBeNull();
    expect(sim.boss.charge?.angle).toBe(charge.angle);
    sim.step(FRAME);
    expect(sim.boss.charge).toBeNull();
    expect(sim.boss.beam?.angle).toBe(charge.angle);
    expect(sim.boss.beam?.origin).toEqual(charge.origin);
    expect(sim.ufoShots).toHaveLength(0);
    runFor(sim, 0.5);
    expect(sim.boss.beam?.angle).toBeCloseTo(charge.angle + charge.sweep * Math.PI / 6 * 0.5 / 1.25);
    const segment = bossBeamSegment(sim.boss.beam!);
    expect(segment.start).toEqual(charge.origin);
    runFor(sim, 0.75 - FRAME);
    expect(sim.boss.beam).not.toBeNull();
    sim.step(FRAME);
    expect(sim.boss.beam).toBeNull();
    expect(sim.boss.attackCooldown).toBe(4);
    runFor(sim, 4 - FRAME);
    expect(sim.boss.charge).toBeNull();
    sim.step(FRAME);
    expect(sim.boss.charge?.turret).toBe('left');
    const cues = sim.drainBossEvents().map((e) => e.type);
    expect(cues.filter((e) => e === 'beam_charge')).toHaveLength(1);
    expect(cues.filter((e) => e === 'beam_fire')).toHaveLength(1);
  });

  it.each(['none', 'shield', 'respawn', 'boost'] as const)('uses ordinary damage with %s protection, at most once per ship per beam', (protection) => {
    const sim = arrived();
    beamCharge(sim);
    const charge = sim.boss.charge!;
    if (protection === 'shield') sim.player.shieldActive = true;
    if (protection === 'respawn') { sim.player.isRespawning = true; sim.player.respawnTimer = 10; }
    if (protection === 'boost') { sim.player.boost.active = true; sim.player.boost.timer = 10; }
    // Put the ship directly on the warned initial beam, away from the turret hitbox.
    sim.player.position = { x: charge.origin.x + Math.cos(charge.angle) * 180, y: charge.origin.y + Math.sin(charge.angle) * 180 };
    const events = [];
    for (let i = 0; i < 90; i++) events.push(...sim.step(FRAME));
    const damage = protection === 'none' || protection === 'boost';
    expect(sim.player.lives).toBe(damage ? 2 : 3);
    expect(events.filter((e) => e.type === 'player_hit')).toHaveLength(damage ? 1 : 0);
    expect(sim.boss.beam?.hitPlayers.has(1)).toBe(true);
    if (protection === 'shield') expect(sim.player.shieldActive).toBe(false);
    sim.player.isRespawning = false; // removing protection cannot give the same beam another hit
    for (let i = 0; i < 70; i++) {
      const beam = sim.boss.beam!;
      sim.player.position = { x: beam.origin.x + Math.cos(beam.angle) * 180, y: beam.origin.y + Math.sin(beam.angle) * 180 };
      sim.step(FRAME);
    }
    expect(sim.player.lives).toBe(damage ? 2 : 3);
  });

  it.each(['shared', 'independent'] as const)('applies beam damage to the correct co-op ship with %s lives', (livesMode) => {
    const sim = arrived({ playerCount: 2, livesMode });
    beamCharge(sim);
    const charge = sim.boss.charge!;
    sim.player.position = { x: 40, y: 40 };
    const p2 = sim.player2!;
    p2.position = { x: charge.origin.x + Math.cos(charge.angle) * 180, y: charge.origin.y + Math.sin(charge.angle) * 180 };
    const before = p2.lives;
    const events = [];
    for (let i = 0; i < 90; i++) events.push(...sim.step(FRAME));
    expect(p2.lives).toBe(before - 1);
    expect(sim.player.lives).toBe(livesMode === 'shared' ? before - 1 : 3);
    expect(events).toContainEqual({ type: 'player_hit', player: 2, livesLeft: before - 1, source: 'ufo_shot' });
  });

  it('allows keyboard rotation and thrust to evade the complete beam path after its warning', () => {
    const sim = arrived();
    beamCharge(sim);
    // Start where the boss aimed, turn 90 degrees during the warning, then thrust laterally.
    runFor(sim, 0.3, { ...NO_INPUT, rotate: 1 });
    expect(sim.player.rotation).toBeCloseTo(270);
    runFor(sim, 1.2 + BOSS_ATTACK.beamSeconds, { ...NO_INPUT, move: 1 });
    expect(sim.player.lives).toBe(3);
    expect(sim.boss.beam).toBeNull();
  });

  it('damages a ship reached later in the sweep while leaving ships outside the arc safe', () => {
    const sim = arrived({ playerCount: 2 });
    beamCharge(sim);
    const charge = sim.boss.charge!;
    const inArc = charge.angle + charge.sweep * BOSS_ATTACK.beamArcRadians * 0.8;
    const outOfArc = charge.angle - charge.sweep * Math.PI / 3;
    sim.player.position = { x: charge.origin.x + Math.cos(inArc) * 220, y: charge.origin.y + Math.sin(inArc) * 220 };
    sim.player2!.position = { x: charge.origin.x + Math.cos(outOfArc) * 220, y: charge.origin.y + Math.sin(outOfArc) * 220 };
    runFor(sim, 1.5);
    expect(sim.player.lives).toBe(3); // neither ship is on the initial firing line
    runFor(sim, 1);
    expect(sim.player.lives).toBe(2);
    expect(sim.player2!.lives).toBe(3);
    runFor(sim, 0.25);
    expect(sim.boss.beam).toBeNull();
    expect(sim.player2!.lives).toBe(3);
  });

  it('telegraphs the opposite sweep direction on the next beam special', () => {
    const sim = arrived();
    beamCharge(sim);
    const firstSweep = sim.boss.charge!.sweep;
    sim.player.position = { x: 40, y: 40 };
    runFor(sim, 2.75);
    sim.boss.nextTurret = 1;
    sim.boss.attackCounts.right = 5;
    sim.boss.attackCooldown = FRAME;
    sim.step(FRAME);
    expect(sim.boss.charge?.kind).toBe('beam');
    expect(sim.boss.charge?.sweep).toBe(-firstSweep);
  });

  it('returns beam game-over events and stops damage when the last live ship is lost', () => {
    const sim = arrived({ playerCount: 2 });
    sim.player2!.lives = 0;
    sim.player.lives = 1;
    beamCharge(sim);
    const charge = sim.boss.charge!;
    sim.player.position = { x: charge.origin.x + Math.cos(charge.angle) * 180, y: charge.origin.y + Math.sin(charge.angle) * 180 };
    const events = [];
    for (let i = 0; i < 90; i++) events.push(...sim.step(FRAME));
    expect(sim.isGameOver).toBe(true);
    expect(sim.boss.beam).toBeNull();
    expect(events.filter((e) => e.type === 'player_hit')).toHaveLength(1);
    expect(events.some((e) => e.type === 'game_over')).toBe(true);
    runFor(sim, 5);
    expect(sim.player.lives).toBe(0);
  });

  it.each(['charging', 'firing'] as const)('cancels a %s beam permanently when the right turret dies', (state) => {
    const sim = arrived();
    beamCharge(sim);
    if (state === 'firing') runFor(sim, BOSS_ATTACK.beamChargeSeconds);
    sim.boss.right.hp = 1;
    hit(sim, sim.boss.right);
    expect(sim.boss.charge).toBeNull();
    expect(sim.boss.beam).toBeNull();
    sim.player.lives = 100;
    sim.drainBossEvents();
    runFor(sim, 40);
    const events = sim.drainBossEvents();
    expect(events.some((e) => e.type === 'beam_charge' || e.type === 'beam_fire' || (e.type === 'fire' && e.section === 'right'))).toBe(false);
    expect(events.some((e) => e.type === 'fire' && e.section === 'left' && e.kind === 'spread')).toBe(true);
  });

  it('removes cannon shots on left turret destruction without increasing the right turret cadence', () => {
    const sim = arrived();
    startCharge(sim);
    runFor(sim, 1);
    expect(sim.ufoShots).toHaveLength(1);
    sim.boss.left.hp = 1;
    hit(sim, sim.boss.left);
    expect(sim.ufoShots).toHaveLength(0);
    expect(sim.bossProjectiles.size).toBe(0);
    sim.player.lives = 100;
    sim.drainBossEvents();
    runFor(sim, 32);
    const events = sim.drainBossEvents();
    expect(events.some((e) => e.type === 'fire' && e.section === 'left')).toBe(false);
    expect(events.filter((e) => e.type === 'fire' && e.section === 'right')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'beam_fire')).toHaveLength(1);
  });

  it('transitions once, clears hazards, pauses, then pulses six fixed directions every 6.5s with safe gaps', () => {
    const sim = arrived();
    stripTurrets(sim);
    const b = sim.boss;
    expect(sim.drainBossEvents().filter((e) => e.type === 'core_exposed')).toHaveLength(1);
    expect(b.attackCooldown).toBeCloseTo(5.5);
    expect(b.charge).toBeNull();
    expect(b.beam).toBeNull();
    expect(sim.ufoShots).toHaveLength(0);
    runFor(sim, BOSS_ATTACK.exposurePauseSeconds);
    expect(b.charge).toBeNull();
    expect(sim.ufoShots).toHaveLength(0);
    startCharge(sim);
    expect(b.charge?.kind).toBe('pulse');
    const origin = { ...b.charge!.origin };
    sim.player.position = { x: origin.x, y: origin.y + 250 }; // down is midway between two spokes
    runFor(sim, 1 - FRAME);
    expect(sim.ufoShots).toHaveLength(0);
    sim.step(FRAME);
    expect(sim.ufoShots).toHaveLength(6);
    const firstPulseTime = sim.time;
    sim.ufoShots.forEach((shot, i) => {
      expect(shot.position).toEqual(origin);
      const angle = i * Math.PI / 3;
      expect(shot.velocity.x).toBeCloseTo(Math.cos(angle) * 145);
      expect(shot.velocity.y).toBeCloseTo(Math.sin(angle) * 145);
    });
    runFor(sim, 3.5);
    expect(sim.player.lives).toBe(3);
    expect(sim.ufoShots).toHaveLength(0);
    sim.drainBossEvents();
    runFor(sim, 3);
    expect(sim.time - firstPulseTime).toBeCloseTo(6.5);
    expect(sim.drainBossEvents().filter((e) => e.type === 'fire')).toEqual([{ type: 'fire', kind: 'pulse', section: 'core' }]);
    expect(b.core.hp).toBe(40);
  });

  it('starts and resets the exposed-core shortcut with deterministic fresh state', () => {
    const fresh = () => new BossTrialSim({}, { exposedCore: true });
    const sim = fresh();
    expect(sim.boss.exposed).toBe(true);
    expect(sim.boss.phase).toBe('fighting');
    expect(sim.boss.core.hp).toBe(40);
    runFor(sim, 7);
    expect(sim.ufoShots).toHaveLength(6);
    const reset = fresh();
    expect(reset.boss).toEqual(fresh().boss);
    expect(reset.time).toBe(0);
    expect(reset.bossProjectiles.size).toBe(0);
    expect(reset.ufoShots).toHaveLength(0);
    expect(reset.player.lives).toBe(3);
  });

  it.each([false, true])('repeats special attacks and core pulses at 30, 60 and 120Hz (core shortcut: %s)', (exposedCore) => {
    const sims = [30, 60, 120].map((fps) => {
      const sim = new BossTrialSim({}, { exposedCore });
      sim.player.lives = 100;
      const events = [];
      for (let i = 0; i < fps * 75; i++) events.push(...sim.step(1 / fps), ...sim.drainBossEvents());
      return { boss: sim.boss, shots: sim.ufoShots, player: sim.player, events };
    });
    expect(sims[1]).toEqual(sims[0]);
    expect(sims[2]).toEqual(sims[0]);
    expect(sims[0]!.events.some((e) => e.type === (exposedCore ? 'pulse_charge' : 'beam_fire'))).toBe(true);
  });

  it('keeps the trial and core shortcut behind the existing development/casual/unrecorded gate', () => {
    const source = new TextDecoder().decode(readFileSync(resolve(import.meta.dirname, '../src/scenes/GameScene.ts')));
    expect(source).toContain("import.meta.env.DEV && !this.isVerifiedMode && !this.rankedChallenge && new URLSearchParams(window.location.search).get('bosstrial') === '1'");
    const installer = new TextDecoder().decode(readFileSync(resolve(import.meta.dirname, '../src/dev/bossTrial.ts')));
    expect(installer).toContain("get('bosscore') === '1'");
    expect(installer).toContain("reset.on('pointerdown', () => scene.scene.restart())");
  });

  it('gives all five new effects distinct restrained cues through the normal mute control', () => {
    const cues = [
      bossAttackCue({ type: 'fire', kind: 'spread' }), bossAttackCue({ type: 'beam_charge' }),
      bossAttackCue({ type: 'beam_fire' }), bossAttackCue({ type: 'core_exposed' }), bossAttackCue({ type: 'fire', kind: 'pulse' }),
    ];
    expect(new Set(cues.map((cue) => `${cue?.key}:${cue?.rate}`)).size).toBe(5);
    const backend = new FakeBackend();
    const sfx = new SfxPlayer(backend, seededRng(1), { volume: 0 });
    for (const cue of cues) sfx.playCue(cue!);
    expect(sfx.played).toBe(0);
    sfx.setVolume(0.5);
    for (const cue of cues) { expect(cue!.volume).toBeLessThanOrEqual(0.4); sfx.playCue(cue!); }
    expect(sfx.played).toBe(5);
  });

  it('plays trial cues through existing SFX volume, mute and concurrency controls', () => {
    const backend = new FakeBackend();
    const sfx = new SfxPlayer(backend, seededRng(1), { volume: 0 });
    sfx.playCue({ key: 'shoot_low', volume: 1, rate: 0.65 });
    expect(backend.count('shoot_low')).toBe(0);
    sfx.setVolume(0.5);
    sfx.playCue({ key: 'shoot_low', volume: 1, rate: 0.65 });
    expect(backend.count('shoot_low')).toBe(1);
    for (let i = 0; i < 20; i++) sfx.playCue({ key: 'explosion_large', volume: 1 });
    expect(backend.count('explosion_large')).toBeLessThan(20);
  });
});
