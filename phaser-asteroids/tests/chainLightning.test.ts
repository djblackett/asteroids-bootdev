import { describe, expect, it, vi } from 'vitest';
import { SfxPlayer } from '../src/audio/sfxPlayer';
import { CHAIN_LIGHTNING_DURATION, RAPID_FIRE_COOLDOWN } from '../src/core/constants';
import { GameSim, LIGHTNING_FLASH_LIMIT } from '../src/core/game';
import { activateChainLightning, activateMegaPower, activateMultiShot, activateRapidFire, createPlayer, eliminatePlayer, NO_INPUT, respawnPlayer, updatePlayer } from '../src/core/player';
import { seededRng } from '../src/core/rng';
import { createShot } from '../src/core/shot';
import { captureSimSnapshot, FIXED_DT, GAMEPLAY_RULES_VERSION } from '../src/replay';
import * as engine from '../src/replay';
import { loadSettings, RANKED_CONFIG } from '../server/src/config';
import { verifyRankedReplay } from '../server/src/verify';
import { generateBotReplay } from '../server/testing/bot.mjs';
import { FakeBackend } from './audioFakes';
import { eventsOfType, FRAME, hold, parkedUfoFor, pickupAt, pickupAtShip, quietCoop, quietSim, rock, runFor, shotBy } from './helpers';

const chargedAt = (x: number, y: number, owner = 1) => ({ ...shotBy(owner, x, y), charged: true });

describe('Chain Lightning power-up', () => {
  it('collects for the collector only, refreshes to 7 seconds, expires on real time', () => {
    const sim = quietCoop();
    const p = sim.player2!;
    pickupAt(sim, 'chain_lightning', p.position.x, p.position.y);
    expect(eventsOfType(sim.step(FRAME), 'powerup_collected')).toContainEqual({ type: 'powerup_collected', powerType: 'chain_lightning', player: 2 });
    expect(p.chainLightning).toEqual({ active: true, timer: CHAIN_LIGHTNING_DURATION });
    expect(sim.player.chainLightning.active).toBe(false);
    runFor(sim, 2);
    pickupAt(sim, 'chain_lightning', p.position.x, p.position.y);
    sim.step(FRAME);
    expect(p.chainLightning.timer).toBe(CHAIN_LIGHTNING_DURATION);
    sim.slowMotion = { active: true, timer: 20 };
    runFor(sim, 7.1);
    expect(p.chainLightning).toEqual({ active: false, timer: 0 });
  });

  it('freezes charge at firing time and coexists with Rapid Fire, Multi-Shot and Mega Power', () => {
    const p = createPlayer(200, 200);
    const ordinary = updatePlayer(p, hold({ shoot: true }), FRAME).shots[0]!;
    activateChainLightning(p);
    activateRapidFire(p);
    activateMultiShot(p);
    p.shootTimer = 0;
    const charged = updatePlayer(p, hold({ shoot: true }), FRAME).shots;
    expect(charged).toHaveLength(3);
    expect(charged.every((s) => s.charged && s.owner === 1)).toBe(true);
    expect(p.shootTimer).toBe(RAPID_FIRE_COOLDOWN);
    expect(ordinary.charged).toBe(false);
    activateMegaPower(p);
    p.chainLightning.timer = FRAME / 2;
    p.shootTimer = 0;
    const expired = updatePlayer(p, hold({ shoot: true }), FRAME).shots;
    expect(expired.every((s) => !s.charged)).toBe(true);
    expect(charged.every((s) => s.charged)).toBe(true);
    const megaOnly = createPlayer(0, 0);
    activateMegaPower(megaOnly);
    expect(megaOnly.chainLightning.active).toBe(false);
  });

  it('clears on respawn and elimination', () => {
    const p = createPlayer(100, 100);
    activateChainLightning(p);
    respawnPlayer(p, 100, 100);
    expect(p.chainLightning).toEqual({ active: false, timer: 0 });
    activateChainLightning(p);
    p.lives = 0;
    eliminatePlayer(p);
    expect(p.chainLightning).toEqual({ active: false, timer: 0 });
  });

  it('selects nearest from each previous hit, breaks ties by list order, caps at two extra', () => {
    const sim = quietSim();
    const source = rock(200, 150, 20);
    const farther = rock(200, 300, 20);
    const first = rock(300, 150, 20);
    const tie = rock(200, 250, 20);
    const next = rock(440, 150, 20); // in range only from first, closer than the other tied candidate
    sim.asteroids.push(source, farther, first, tie, next, rock(550, 150, 20));
    sim.shots.push(chargedAt(200, 150));
    const events = sim.step(FRAME);
    expect(sim.lightningFlashes[0]!.points).toEqual([source.position, first.position, next.position]);
    expect(eventsOfType(events, 'asteroid_destroyed')).toHaveLength(3);
    expect(eventsOfType(events, 'lightning_discharged')).toHaveLength(1);
    expect(tie.dying).toBe(false);
    expect(sim.shots).toHaveLength(0);
  });

  it('includes exact 160px boundary, excludes radii and targets beyond it, stops when empty', () => {
    const sim = quietSim();
    const edge = rock(360, 150, 20);
    const outside = rock(520.01, 150, 60);
    sim.asteroids.push(rock(200, 150, 20), edge, outside);
    sim.shots.push(chargedAt(200, 150));
    sim.step(FRAME);
    expect(edge.dying).toBe(true);
    expect(outside.dying).toBe(false);
    expect(sim.lightningFlashes[0]!.points).toHaveLength(2);
  });

  it('chains from a surviving armored initial hit and never revisits it or other armor', () => {
    const sim = quietSim();
    const source = rock(200, 150, 20, 'armored');
    const armor = rock(300, 150, 20, 'armored');
    const last = rock(440, 150, 20);
    sim.asteroids.push(source, armor, last);
    sim.shots.push(chargedAt(200, 150));
    const events = sim.step(FRAME);
    expect(source.hitPoints).toBe(1);
    expect(armor.hitPoints).toBe(1);
    expect(last.dying).toBe(true);
    expect(eventsOfType(events, 'asteroid_hit')).toHaveLength(2);
    expect(eventsOfType(events, 'asteroid_destroyed')).toHaveLength(1);
    expect(sim.lightningFlashes[0]!.points).toHaveLength(3);
  });

  it('credits normal combo scores to player 2, once per kill and drop roll', () => {
    // All drops guaranteed; presentation particle RNG also returns zero, but cannot create extra drops.
    const sim = quietCoop({}, 1, () => 0);
    sim.asteroids.push(rock(200, 150, 20), rock(350, 150, 20), rock(500, 150, 20));
    sim.shots.push(chargedAt(200, 150, 2), chargedAt(200, 150, 1));
    const kills = eventsOfType(sim.step(FRAME), 'asteroid_destroyed');
    expect(kills.map((e) => [e.player, e.combo, e.multiplier, e.points])).toEqual([[2, 1, 1, 50], [2, 2, 1.5, 75], [2, 3, 2, 100]]);
    expect(sim.player.score).toBe(0);
    expect(sim.player2!.score).toBe(225);
    expect(sim.powerups).toHaveLength(3);
    expect(eventsOfType(sim.step(FRAME), 'asteroid_destroyed')).toHaveLength(0);
    expect(sim.powerups).toHaveLength(3);
  });

  it('detonates volatile chains, skips blast kills and keeps their normal ownership without extra chains', () => {
    const sim = quietCoop();
    const source = rock(200, 150, 20);
    const volatile = rock(350, 150, 20, 'volatile');
    const blastKill = rock(450, 150, 20, 'volatile');
    const armor = rock(500, 210, 20, 'armored');
    const last = rock(350, 300, 20);
    sim.asteroids.push(source, volatile, blastKill, armor, last);
    sim.shots.push(chargedAt(200, 150, 2));
    const events = sim.step(FRAME);
    expect(eventsOfType(events, 'volatile_exploded')).toHaveLength(2);
    expect(armor.hitPoints).toBe(1); // normal blast damage
    expect(sim.lightningFlashes[0]!.points).toEqual([source.position, volatile.position, last.position]);
    expect(eventsOfType(events, 'lightning_discharged')).toHaveLength(1);
    const kills = eventsOfType(events, 'asteroid_destroyed');
    expect(kills).toHaveLength(4);
    expect(kills.every((e) => e.player === 2)).toBe(true);
    expect(sim.player2!.score).toBe(kills.reduce((sum, e) => sum + e.points, 0));
  });

  it('handles a volatile initial hit and does not jump to asteroids its blast already killed', () => {
    const sim = quietSim();
    sim.asteroids.push(rock(200, 150, 20, 'volatile'), rock(300, 150, 20), rock(200, 305, 20));
    sim.shots.push(chargedAt(200, 150));
    sim.step(FRAME);
    expect(sim.lightningFlashes[0]!.points).toEqual([{ x: 200, y: 150 }, { x: 200, y: 305 }]);
    expect(sim.combo.count).toBe(3);
  });

  it('does not chain from ordinary bullets, lasers, UFO hits or friendly hits', () => {
    const sim = quietCoop({ friendlyFire: true });
    activateChainLightning(sim.player2!);
    sim.asteroids.push(rock(200, 150, 20), rock(350, 150, 20));
    sim.shots.push(shotBy(2, 200, 150)); // already in flight before pickup
    const ufo = parkedUfoFor(sim, 'large', 900, 200);
    sim.shots.push(chargedAt(900, 200, 2));
    const p = sim.player;
    sim.shots.push(chargedAt(p.position.x, p.position.y, 2));
    sim.step(FRAME);
    expect(sim.asteroids[1]!.dying).toBe(false);
    expect(ufo.alive).toBe(false); // original bullet still behaves normally
    expect(p.lives).toBe(2); // existing friendly fire remains normal
    expect(sim.lightningFlashes).toHaveLength(0);
    sim.player2!.position = { x: 100, y: 150 };
    sim.player2!.rotation = 270;
    expect(eventsOfType(sim.step(FRAME, NO_INPUT, hold({ laser: true })), 'lightning_discharged')).toHaveLength(0);
  });

  it('spares nearby players, UFOs and powerups, ignores dead/dying rocks', () => {
    const sim = quietCoop();
    sim.player.position = { x: 200, y: 235 };
    const ufo = parkedUfoFor(sim, 'large', 200, 65);
    const pickup = pickupAt(sim, 'shield', 200, 285);
    const dead = rock(210, 150, 20);
    dead.alive = false;
    const dying = rock(220, 150, 20);
    dying.dying = true;
    dying.deathTimer = 1;
    sim.asteroids.push(rock(200, 150, 20), dead, dying);
    sim.shots.push(chargedAt(200, 150, 2));
    sim.step(FRAME);
    expect(sim.player.lives).toBe(3);
    expect(ufo.alive).toBe(true);
    expect(pickup.alive).toBe(true);
    expect(sim.lightningFlashes[0]!.points).toHaveLength(1);
  });

  it('caps and expires decoration, rate-limits zap voices and consumes no additional gameplay RNG', () => {
    const a = quietSim(42);
    const b = quietSim(42);
    for (const sim of [a, b]) {
      pickupAtShip(sim, 'chain_lightning');
      sim.step(FRAME);
      sim.asteroids.push(rock(200, 150, 20), rock(350, 150, 20, 'volatile'), rock(450, 150, 20));
      sim.shots.push(chargedAt(200, 150));
    }
    const backend = new FakeBackend();
    const sfx = new SfxPlayer(backend, seededRng(999));
    for (let tick = 0; tick < 30; tick++) {
      const events = a.step(FRAME);
      sfx.handle(events);
      expect(b.step(FRAME)).toEqual(events);
      b.lightningFlashes = [];
    }
    expect(captureSimSnapshot(a)).toEqual(captureSimSnapshot(b));
    expect(a.rng()).toBe(b.rng());
    expect(a.lightningFlashes).toHaveLength(0);
    sfx.handle(Array.from({ length: 30 }, () => ({ type: 'lightning_discharged' as const, player: 1 })));
    expect(backend.count('lightning')).toBe(1);
    const dense = quietSim();
    for (let i = 0; i < 90; i++) {
      dense.asteroids.push(rock(200, 150, 20));
      dense.shots.push(chargedAt(200, 150));
    }
    dense.step(FRAME);
    expect(dense.lightningFlashes).toHaveLength(LIGHTNING_FLASH_LIMIT);
  });

  it('retains charge through expiration and starts no more than one chain per projectile', () => {
    const sim = quietSim();
    const p = sim.player;
    activateChainLightning(p);
    p.rotation = 270;
    const shot = createShot({ x: 200, y: 150 }, 270, 1, p.chainLightning.active);
    shot.velocity = { x: 0, y: 0 };
    p.chainLightning = { active: false, timer: 0 };
    sim.asteroids.push(rock(200, 150, 20, 'armored'), rock(300, 150, 20), rock(400, 150, 20));
    sim.shots.push(shot);
    expect(eventsOfType(sim.step(FRAME), 'lightning_discharged')).toHaveLength(1);
    expect(shot.alive).toBe(false);
    expect(eventsOfType(sim.step(FRAME), 'lightning_discharged')).toHaveLength(0);
  });

  it('reproduces genuine lightning pickups and destruction order in the authoritative current-rules verifier', () => {
    const seed = 54321;
    const events: ReturnType<GameSim['step']> = [];
    const original = GameSim.prototype.step;
    const spy = vi.spyOn(GameSim.prototype, 'step').mockImplementation(function (this: GameSim, ...args) {
      const result = original.apply(this, args);
      events.push(...result);
      return result;
    });
    try {
      const run = generateBotReplay(engine, { seed });
      const trace = events.splice(0);
      const verdict = verifyRankedReplay(run.replay, {
        seed, rulesVersion: GAMEPLAY_RULES_VERSION, config: RANKED_CONFIG, createdAt: 0,
      }, run.ticks * FIXED_DT * 1000, loadSettings());
      expect(verdict.ok).toBe(true);
      if (verdict.ok) expect(verdict.result.calculatedScore).toBe(run.score);
      expect(events).toEqual(trace);
      expect(eventsOfType(events, 'powerup_collected').some((e) => e.powerType === 'chain_lightning')).toBe(true);
      expect(eventsOfType(events, 'lightning_discharged').length).toBeGreaterThan(0);
      const oldReplay = structuredClone(run.replay);
      oldReplay.header.rulesVersion = '1.1.0';
      expect(verifyRankedReplay(oldReplay, { seed, rulesVersion: GAMEPLAY_RULES_VERSION, config: RANKED_CONFIG, createdAt: 0 }, 1e9, loadSettings()).ok).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
