import { describe, expect, it } from 'vitest';
import { cueForEvent, SfxPlayer } from '../src/audio/sfxPlayer';
import { VOLATILE_EXPLOSION_RADIUS, VOLATILE_EXPLOSION_SHAKE } from '../src/core/constants';
import { GameSim, VOLATILE_FLASH_LIMIT } from '../src/core/game';
import { NO_INPUT } from '../src/core/player';
import { seededRng } from '../src/core/rng';
import { FIXED_DT, GAMEPLAY_RULES_VERSION } from '../src/replay/constants';
import { ReplayRecorder } from '../src/replay/recorder';
import { captureSimSnapshot } from '../src/replay/snapshot';
import { loadSettings, RANKED_CONFIG } from '../server/src/config';
import { verifyRankedReplay } from '../server/src/verify';
import { FakeBackend } from './audioFakes';
import { eventsOfType, FRAME, parkedUfoFor, quietCoop, quietSim, rock, runFor, shotAt, shotBy, ufoShotAt } from './helpers';

describe('volatile blasts', () => {
  it('detonates once, touches collision radii, applies one armor hit, and spares ships/UFOs', () => {
    const sim = quietSim();
    sim.player.position = { x: 300, y: 330 }; // within the blast, outside body contact
    sim.player.isRespawning = false;
    const ufo = parkedUfoFor(sim, 'large', 300, 190);
    const source = rock(300, 250, 20, 'volatile');
    const edge = rock(300 + VOLATILE_EXPLOSION_RADIUS + 20, 250, 20);
    const outside = rock(edge.position.x + 1, 250, 20);
    const armor = rock(330, 280, 20, 'armored');
    const worn = rock(270, 280, 20, 'armored');
    worn.hitPoints = 1;
    sim.asteroids.push(source, edge, outside, armor, worn);
    sim.shots.push(shotAt(300, 250), shotAt(300, 250));

    const events = sim.step(FRAME);
    expect(source.dying).toBe(true);
    expect(edge.dying).toBe(true);
    expect(outside.dying).toBe(false);
    expect(armor.hitPoints).toBe(1);
    expect(armor.dying).toBe(false);
    expect(worn.dying).toBe(true);
    expect(eventsOfType(events, 'asteroid_hit')).toHaveLength(1);
    expect(eventsOfType(events, 'asteroid_destroyed')).toHaveLength(3);
    const blasts = eventsOfType(events, 'volatile_exploded');
    expect(blasts).toEqual([{ type: 'volatile_exploded', position: { x: 300, y: 250 }, radius: 110, depth: 0 }]);
    expect(sim.player.lives).toBe(3);
    expect(sim.player.isRespawning).toBe(false);
    expect(ufo.alive).toBe(true);
    expect(sim.screenShake).toBe(VOLATILE_EXPLOSION_SHAKE);
    expect(cueForEvent(blasts[0]!, seededRng(1))).toMatchObject({ key: 'explosion_large', rate: 0.8 });
    expect(cueForEvent(eventsOfType(events, 'asteroid_destroyed')[0]!, seededRng(1))).toBeNull();
    expect(eventsOfType(sim.step(FRAME), 'volatile_exploded')).toHaveLength(0);
    expect(armor.hitPoints).toBe(1); // the lingering ring does no damage
  });

  it('resolves a cyclic chain in stable breadth-first order, paying player 2 at existing combo multipliers', () => {
    const sim = quietCoop();
    sim.asteroids.push(rock(300, 200, 20, 'volatile'), rock(420, 200, 20, 'volatile'),
      rock(420, 320, 20, 'volatile'), rock(300, 320, 20, 'volatile'));
    sim.shots.push(shotBy(2, 300, 200), shotBy(1, 420, 200));
    const events = sim.step(FRAME);
    expect(eventsOfType(events, 'volatile_exploded').map((e) => [e.position.x, e.position.y, e.depth]))
      .toEqual([[300, 200, 0], [420, 200, 1], [300, 320, 1], [420, 320, 2]]);
    expect(eventsOfType(events, 'asteroid_destroyed').map((e) => [e.player, e.combo, e.multiplier, e.points]))
      .toEqual([[2, 1, 1, 107], [2, 2, 1.5, 160], [2, 3, 2, 214], [2, 4, 2.5, 267]]);
    expect(sim.player.score).toBe(0);
    expect(sim.player2!.score).toBe(748);
    expect(sim.combo.count).toBe(4);
    expect(sim.shots).toHaveLength(1); // the competing shot never steals a dying target
    expect(eventsOfType(sim.step(FRAME), 'asteroid_destroyed')).toHaveLength(0);
  });

  it('allows two distinct blasts to destroy armor, with no duplicate kills in a dense chain', () => {
    const sim = quietSim();
    const armor = rock(160, 120, 20, 'armored');
    sim.asteroids.push(armor);
    for (let i = 0; i < 64; i++) sim.asteroids.push(rock(100 + i % 16 * 10, 100 + Math.floor(i / 16) * 10, 20, 'volatile'));
    sim.shots.push(shotAt(100, 100));
    const events = sim.step(FRAME);
    expect(eventsOfType(events, 'asteroid_hit')).toHaveLength(1);
    expect(armor.hitPoints).toBe(0);
    expect(eventsOfType(events, 'volatile_exploded')).toHaveLength(64);
    expect(eventsOfType(events, 'asteroid_destroyed')).toHaveLength(65);
    expect(sim.combo.count).toBe(65);
    expect(sim.volatileFlashes).toHaveLength(VOLATILE_FLASH_LIMIT);
    expect(sim.screenShake).toBeLessThanOrEqual(VOLATILE_EXPLOSION_SHAKE);
    const backend = new FakeBackend();
    new SfxPlayer(backend, seededRng(1)).handle(events);
    expect(backend.requests.length).toBeLessThanOrEqual(4);
    expect(eventsOfType(sim.step(FRAME), 'volatile_exploded')).toHaveLength(0);
  });

  it('preserves delayed splitting without hitting newly spawned children with an old blast', () => {
    const sim = quietSim();
    sim.asteroids.push(rock(250, 200, 40, 'volatile'), rock(300, 200, 40));
    sim.shots.push(shotAt(250, 200));
    sim.step(FRAME);
    expect(sim.combo.count).toBe(2);
    runFor(sim, 0.2);
    expect(sim.asteroids).toHaveLength(4);
    expect(sim.asteroids.every((a) => a.radius === 20 && !a.dying && a.hitPoints === 1)).toBe(true);
    expect(sim.asteroids.filter((a) => a.archetype === 'volatile')).toHaveLength(2);
    expect(sim.combo.count).toBe(2);
    runFor(sim, 0.3);
    expect(sim.volatileFlashes).toHaveLength(0);
  });

  it.each(['ufo', 'collision'] as const)('keeps %s destruction uncredited through the chain', (cause) => {
    const sim = quietSim();
    sim.asteroids.push(rock(300, 200, 20, 'volatile'), rock(420, 200, 20, 'volatile'), rock(540, 200, 20));
    if (cause === 'ufo') sim.ufoShots.push(ufoShotAt(300, 200));
    else sim.player.position = { x: 300, y: 200 };
    const kills = eventsOfType(sim.step(FRAME), 'asteroid_destroyed');
    expect(kills).toHaveLength(3);
    expect(kills.every((e) => e.points === 0 && e.player === undefined)).toBe(true);
    expect(sim.totalScore).toBe(0);
    expect(sim.combo.count).toBe(cause === 'ufo' ? 3 : 2); // body contact itself retains its no-combo rule
  });

  it('reproduces chain events, splits and RNG state with presentation enabled or discarded', () => {
    const a = quietSim(42);
    const b = quietSim(42);
    for (const sim of [a, b]) {
      sim.asteroids.push(rock(200, 200, 40, 'volatile'), rock(320, 200, 20, 'volatile'), rock(440, 200, 20, 'armored'));
      sim.shots.push(shotAt(200, 200));
    }
    const sfx = new SfxPlayer(new FakeBackend(), seededRng(998));
    for (let tick = 0; tick < 30; tick++) {
      const events = a.step(FRAME);
      sfx.handle(events);
      expect(b.step(FRAME)).toEqual(events);
      b.volatileFlashes = []; // headless presentation cannot affect simulation outcomes
    }
    expect(captureSimSnapshot(a, 30)).toEqual(captureSimSnapshot(b, 30));
    expect(a.rng()).toBe(b.rng());
  });

  it('accepts a short genuine recording with the current local ranked verifier under rules 1.1.0', () => {
    const seed = 54321;
    const sim = new GameSim({ rng: seededRng(seed), config: RANKED_CONFIG });
    const recorder = new ReplayRecorder(seed, RANKED_CONFIG);
    const ticks = 300;
    for (let tick = 0; tick < ticks; tick++) {
      recorder.recordTick(tick, NO_INPUT);
      sim.step(FIXED_DT, NO_INPUT);
      expect(sim.isGameOver).toBe(false);
    }
    recorder.markTimeLimit(sim);
    expect(GAMEPLAY_RULES_VERSION).toBe('1.1.0');
    const replay = JSON.parse(recorder.serialize());
    const verdict = verifyRankedReplay(replay, {
      seed, rulesVersion: GAMEPLAY_RULES_VERSION, config: RANKED_CONFIG, createdAt: 0, timeLimitTicks: ticks,
    }, 5000, loadSettings());
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.result.calculatedScore).toBe(sim.totalScore);
  });
});
