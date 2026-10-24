import { describe, expect, it } from 'vitest';
import { GameSim } from '../src/core/game';
import { createLaser } from '../src/core/laser';
import { seededRng } from '../src/core/rng';
import { BOSS_ATTACK, BOSS_BONUS, BOSS_TOTAL_HP, BossTrialSim, hullTouches, type BossSection } from '../src/dev/bossTrialSim';
import { SfxPlayer } from '../src/audio/sfxPlayer';
import { FakeBackend } from './audioFakes';
import { FRAME, runFor, shotAt, ufoShotAt } from './helpers';

function arrived(config: ConstructorParameters<typeof BossTrialSim>[0] = {}): BossTrialSim {
  const sim = new BossTrialSim(config);
  runFor(sim, 3.4);
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
    expect(times).toHaveLength(3);
    expect(times[1]! - times[0]!).toBeCloseTo(5);
    expect(times[2]! - times[1]!).toBeCloseTo(5);
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
    runFor(sim, 2);
    expect(sim.boss.phase).toBe('destroyed');
    expect(sim.boss.explosionCount).toBe(8);
    expect(sim.player2!.score).toBe(BOSS_BONUS);
    expect(sim.player.score).toBe(0);
    expect(sim.bossEvents.filter((e) => e.type === 'destroyed')).toHaveLength(1);
    expect(sim.bossEvents.filter((e) => e.type === 'core_destroyed')).toHaveLength(1);
    expect(sim.bossFlashes.some((f) => f.radius === 200)).toBe(true);
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
