import { describe, expect, it } from 'vitest';
import { PLAYER_LIVES, SHARED_LIVES_POOL } from '../src/core/constants';
import { GameSim, type SimEvent } from '../src/core/game';
import type { LivesMode } from '../src/core/gameConfig';
import type { PlayerInput } from '../src/core/player';
import { createPowerUp, type PowerUpType } from '../src/core/powerup';
import { seededRng, type Rng } from '../src/core/rng';
import { rock } from './helpers';

/**
 * Long randomised two-player runs (random keys for both ships, random pick-ups including Revive, random crashes and
 * friendly shots, restarts from the game-over state, three frame rates) with the rules that must hold on every step.
 */

const TYPES: readonly PowerUpType[] = ['rapid_fire', 'shield', 'multi_shot', 'slow_motion', 'mega_power', 'revive'];

function randomInput(rng: Rng): PlayerInput {
  const pick3 = (): number => Math.floor(rng() * 3) - 1;
  return { rotate: pick3(), move: pick3(), shoot: rng() < 0.6, laser: rng() < 0.08, boost: rng() < 0.06 };
}

interface Tally {
  gameOvers: number;
  revives: number;
  eliminations: number;
  steps: number;
}

function runFuzz(seed: number, fps: number, livesMode: LivesMode, friendlyFire: boolean, minutes: number): Tally {
  const rng = seededRng(seed);
  const maxLives = livesMode === 'shared' ? SHARED_LIVES_POOL : PLAYER_LIVES;
  const tally: Tally = { gameOvers: 0, revives: 0, eliminations: 0, steps: 0 };
  let runSeed = seed;
  const freshSim = (): GameSim => new GameSim({ rng: seededRng(++runSeed), config: { playerCount: 2, livesMode, friendlyFire, speed: [1, 0.75] } });

  let sim = freshSim();
  let points: [number, number] = [0, 0];
  let gameOverEvents = 0;
  let timeOver = 0;

  for (let i = 0, n = Math.round(minutes * 60 * fps); i < n; i++) {
    const [p1, p2] = sim.players;
    if (!p1 || !p2) throw new Error('two players expected');

    // Random trouble: crash a rock into a random ship, drop a random pickup, fire a stray friendly shot.
    if (!sim.isGameOver) {
      if (rng() < 0.01) {
        const target = rng() < 0.5 ? p1 : p2;
        sim.asteroids.push(rock(target.position.x, target.position.y, 20 + 20 * Math.floor(rng() * 3)));
      }
      if (rng() < 0.01) {
        const at = rng() < 0.5 ? p1 : p2;
        const drop = createPowerUp(at.position.x, at.position.y, TYPES[Math.floor(rng() * TYPES.length)] ?? 'shield', rng);
        drop.velocity = { x: 0, y: 0 };
        sim.powerups.push(drop);
      }
      if (rng() < 0.01) sim.shots.push({ position: { ...p2.position }, velocity: { x: 0, y: 0 }, radius: 5, owner: 1, alive: true });
    }

    const lifeBefore = [p1.lives, p2.lives];
    const posBefore = [{ ...p1.position }, { ...p2.position }];
    const events: SimEvent[] = sim.step(1 / fps, randomInput(rng), randomInput(rng));
    tally.steps++;

    for (const e of events) {
      if ((e.type === 'asteroid_destroyed' || e.type === 'ufo_destroyed') && e.player) points[e.player - 1] = (points[e.player - 1] ?? 0) + e.points;
      if (e.type === 'game_over') {
        gameOverEvents++;
        tally.gameOvers++;
      }
      if (e.type === 'player_revived') {
        tally.revives++;
        expect(lifeBefore[e.player - 1]).toBe(0); // only a ship that was out can come back
        expect(sim.players[e.player - 1]?.lives).toBe(3);
        expect(e.by).not.toBe(e.player);
      }
      if (e.type === 'player_eliminated') tally.eliminations++;
      if (e.type === 'player_hit') expect(e.player === 1 || e.player === 2).toBe(true);
    }

    // --- invariants, every step ---
    expect(sim.players).toHaveLength(2);
    for (const p of sim.players) {
      expect(Number.isFinite(p.position.x + p.position.y + p.rotation + p.score)).toBe(true);
      expect(p.lives).toBeGreaterThanOrEqual(0);
      expect(p.lives).toBeLessThanOrEqual(maxLives);
      expect(p.laser.shotsRemaining).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeGreaterThanOrEqual(0);
      if (p.lives <= 0) expect(p.shieldActive || p.boost.active || p.rapidFire.active || p.megaPower.active).toBe(false);
      if (p.megaPower.active) expect(p.rapidFire.active && p.multiShot.active).toBe(true);
    }
    if (livesMode === 'shared') expect(p1.lives).toBe(p2.lives);
    // The run is over exactly when nobody has a life left.
    expect(sim.isGameOver).toBe(p1.lives <= 0 && p2.lives <= 0);
    // A ship that stays out does not move.
    sim.players.forEach((p, k) => {
      if (lifeBefore[k] === 0 && p.lives === 0) expect(p.position).toEqual(posBefore[k]);
    });
    // Points are never invented or lost: each score is exactly what the events announced for that player.
    expect(p1.score).toBe(points[0]);
    expect(p2.score).toBe(points[1]);
    expect(sim.shots.length).toBeLessThan(300);
    expect(sim.lasers.length).toBeLessThan(20);
    expect(sim.particles.activeCount).toBeLessThanOrEqual(sim.particles.capacity);
    expect(sim.powerups.length).toBeLessThan(120);

    if (sim.isGameOver) {
      expect(gameOverEvents).toBe(1); // one game_over per run, however long it sits there
      expect(sim.gameOverReason).toBe(livesMode === 'shared' ? 'shared_lives_exhausted' : 'all_eliminated');
      timeOver += 1 / fps;
      // Restart from the terminal state after a moment, as the scene's retry does: a completely fresh simulation.
      if (timeOver > 2) {
        sim = freshSim();
        const lives = livesMode === 'shared' ? SHARED_LIVES_POOL : PLAYER_LIVES;
        expect(sim.isGameOver).toBe(false);
        expect(sim.players.every((p) => p.lives === lives && p.score === 0)).toBe(true);
        expect(sim.shots).toHaveLength(0);
        points = [0, 0];
        gameOverEvents = 0;
        timeOver = 0;
      }
    }
  }
  return tally;
}

describe('two-player fuzz', () => {
  it.each([
    [1, 60, 'independent', true],
    [2, 30, 'independent', true],
    [3, 144, 'independent', false],
    [4, 60, 'shared', true],
    [5, 30, 'shared', false],
  ] as const)('seed %i at %i fps, %s lives, friendly fire %s: every invariant holds for 3 simulated minutes', (seed, fps, lives, friendlyFire) => {
    const tally = runFuzz(seed, fps, lives, friendlyFire, 3);
    expect(tally.steps).toBe(Math.round(3 * 60 * fps));
  }, 120_000);

  it('the random runs really exercise elimination, Revive and game over (independent lives)', () => {
    const total: Tally = { gameOvers: 0, revives: 0, eliminations: 0, steps: 0 };
    for (const seed of [11, 12, 13, 14]) {
      const t = runFuzz(seed, 60, "independent", true, 3);
      total.gameOvers += t.gameOvers;
      total.revives += t.revives;
      total.eliminations += t.eliminations;
    }
    expect(total.eliminations).toBeGreaterThan(0);
    expect(total.revives).toBeGreaterThan(0);
    expect(total.gameOvers).toBeGreaterThan(0);
  }, 120_000);
});
