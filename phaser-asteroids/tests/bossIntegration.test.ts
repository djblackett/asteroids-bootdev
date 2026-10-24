import { describe, expect, it } from 'vitest';
import { FIRST_BOSS_ENCOUNTER_SECONDS, MothershipGameSim } from '../src/boss/bossSim';
import { BOSS_CINEMATIC as C } from '../src/boss/bossCinematic';
import { seededRng } from '../src/core/rng';
import { FRAME, hold, rock, runFor, shotAt, ufoShotAt } from './helpers';

function approaching(playerCount: 1 | 2 = 1, livesMode: 'independent' | 'shared' = 'independent') {
  const sim = new MothershipGameSim({ rng: seededRng(42), config: { playerCount, livesMode } });
  // Protect the setup, then exercise the actual scheduled transition without mutating its clock.
  for (const p of sim.players) { p.isRespawning = true; p.respawnTimer = 1000; }
  runFor(sim, FIRST_BOSS_ENCOUNTER_SECONDS - FRAME);
  return sim;
}

function defeat(sim: MothershipGameSim, owner = 1) {
  for (const s of sim.boss.sections) {
    const hp = s.hp;
    for (let i = 0; i < hp; i++) sim.shots.push({ ...shotAt(s.position.x, s.position.y), owner });
    sim.step(FRAME);
  }
}

describe('scheduled mothership integration', () => {
  it.each([30, 60, 120])('starts exactly once at 60 active seconds and hands off at 71 seconds at %sHz', fps => {
    const sim = new MothershipGameSim({ rng: seededRng(3) });
    sim.player.isRespawning = true; sim.player.respawnTimer = 1000;
    runFor(sim, 60 - 1 / fps, undefined, fps);
    expect(sim.encounterStarted).toBe(false);
    sim.step(1 / fps);
    expect(sim.encounterStarted).toBe(true);
    expect(sim.boss.age).toBe(0);
    runFor(sim, 11 - 1 / fps, undefined, fps);
    expect(sim.boss.phase).toBe('entering');
    sim.step(1 / fps);
    expect(sim.boss.phase).toBe('fighting');
    expect(sim.boss.age).toBeCloseTo(11);
    expect(sim.boss.charge).toBeNull();
    expect(sim.boss.attackCooldown).toBeGreaterThan(3.9);
  });

  it('clears hazards without rewards and freezes abilities, pickups, and lives during the introduction', () => {
    const sim = approaching();
    sim.player.score = 1234;
    sim.player.rapidFire = { active: true, timer: 8 };
    sim.player.chainLightning = { active: true, timer: 7 };
    sim.player.shieldActive = true;
    sim.asteroids.push(rock(640, 540));
    sim.spawnUfo('large', 900, 100);
    sim.ufoShots.push(ufoShotAt(640, 540));
    sim.step(FRAME);
    expect(sim.asteroids).toHaveLength(0);
    expect(sim.ufos).toHaveLength(0);
    expect(sim.ufoShots).toHaveLength(0);
    const saved = structuredClone(sim.player);
    runFor(sim, 11, hold({ shoot: true, move: 1, laser: true, boost: true }));
    expect(sim.player).toEqual(saved);
    expect(sim.totalScore).toBe(1234);
    expect(sim.boss.hp).toBe(76);
    expect(sim.bossProjectiles.size).toBe(0);
    expect(sim.asteroids).toHaveLength(0);
    expect(sim.ufos).toHaveLength(0);
  });

  it.each(['independent', 'shared'] as const)('preserves %s co-op state, awards one team bonus, resumes enemies, and never repeats', livesMode => {
    const sim = approaching(2, livesMode);
    sim.player.score = 123; sim.player2!.score = 456;
    sim.step(FRAME);
    runFor(sim, 11);
    const lives = sim.players.map(p => p.lives);
    defeat(sim, 2);
    expect(sim.boss.phase).toBe('dying');
    const timers = sim.players.map(p => p.respawnTimer);
    runFor(sim, C.aftermath + FRAME);
    expect(sim.totalScore).toBe(2579);
    expect(sim.player.score).toBe(123);
    expect(sim.player2!.score).toBe(2456);
    expect(sim.players.map(p => p.lives)).toEqual(lives);
    expect(sim.players.map(p => p.respawnTimer)).toEqual(timers);
    expect(sim.ordinaryPlay).toBe(true);
    expect(sim.ufoSpawner.enabled).toBe(true);
    expect(sim.bossProjectiles.size).toBe(0);
    expect(sim.bossFlashes).toHaveLength(0);
    runFor(sim, 70);
    expect(sim.boss.phase).toBe('destroyed');
    expect(sim.drainBossEvents().filter(e => e.type === 'destroyed')).toHaveLength(1);
    expect(sim.asteroids.length + sim.ufos.length).toBeGreaterThan(0);
    expect(sim.totalScore).toBe(2579);
  });

  it('keeps an eliminated co-op player eliminated through arrival while their teammate fights', () => {
    const sim = approaching(2);
    sim.player.lives = 0;
    const out = structuredClone(sim.player);
    sim.step(FRAME); runFor(sim, 11);
    expect(sim.player).toEqual(out);
    expect(sim.isGameOver).toBe(false);
    expect(sim.boss.phase).toBe('fighting');
  });

  it('uses normal elimination and game over, clears attacks, and starts a fresh run with no encounter state', () => {
    const sim = approaching(2);
    sim.step(FRAME); runFor(sim, 11.1);
    for (const p of sim.players) { p.isRespawning = false; p.lives = 1; }
    sim.ufoShots.push(ufoShotAt(sim.player.position.x, sim.player.position.y));
    expect(sim.step(FRAME).some(e => e.type === 'player_eliminated')).toBe(true);
    expect(sim.isGameOver).toBe(false);
    sim.ufoShots.push(ufoShotAt(sim.player2!.position.x, sim.player2!.position.y));
    expect(sim.step(FRAME).some(e => e.type === 'game_over')).toBe(true);
    expect(sim.boss.charge).toBeNull();
    expect(sim.boss.beam).toBeNull();
    expect(sim.ufoShots).toHaveLength(0);
    expect(sim.bossProjectiles.size).toBe(0);
    const fresh = new MothershipGameSim();
    expect(fresh.encounterStarted).toBe(false);
    expect(fresh.boss.hp).toBe(76);
    expect(fresh.totalScore).toBe(0);
  });
});
