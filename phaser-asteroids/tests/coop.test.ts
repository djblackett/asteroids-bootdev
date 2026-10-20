import { describe, expect, it } from 'vitest';
import {
  BOOST_SPEED_MULTIPLIER,
  PLAYER_LIVES,
  PLAYER_RESPAWN_INVULNERABILITY,
  PLAYER_SPAWNS,
  PLAYER_SPEED,
  PLAYER_START_X,
  PLAYER_START_Y,
  REVIVE_LIFETIME,
  REVIVE_LIVES,
  SHARED_LIVES_POOL,
} from '../src/core/constants';
import { GameSim } from '../src/core/game';
import { resolveGameConfig } from '../src/core/gameConfig';
import { NO_INPUT } from '../src/core/player';
import {
  FRAME,
  collectEvents,
  crashInto,
  eventsOfType,
  hitUnprotected,
  hold,
  knockOut,
  parkedUfoFor,
  pickupAt,
  queueRng,
  quietCoop,
  quietSim,
  rock,
  runFor,
  shotBy,
} from './helpers';

/** Phase 4: two-player co-op in the pure simulation. */

function runBoth(sim: GameSim, seconds: number, p1 = NO_INPUT, p2 = NO_INPUT): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) sim.step(FRAME, p1, p2);
}

describe('configuration and initial state', () => {
  it('a one-player game has exactly the classic shape: one ship at the centre, no second player', () => {
    const sim = new GameSim();
    expect(sim.players).toHaveLength(1);
    expect(sim.player2).toBeNull();
    expect(sim.player.playerNumber).toBe(1);
    expect(sim.player.position).toEqual({ x: PLAYER_START_X, y: PLAYER_START_Y });
    expect(sim.player.lives).toBe(PLAYER_LIVES);
    expect(sim.sharedLives).toBeNull();
    expect(sim.config).toEqual({ playerCount: 1, livesMode: 'independent', friendlyFire: false, speed: [1, 1] });
  });

  it('co-op settings can never leak into a one-player game', () => {
    const sim = new GameSim({ config: { playerCount: 1, livesMode: 'shared', friendlyFire: true, speed: [0.5, 2] } });
    expect(sim.config).toEqual({ playerCount: 1, livesMode: 'independent', friendlyFire: false, speed: [1, 1] });
    expect(sim.player.speedMultiplier).toBe(1);
    expect(sim.player.lives).toBe(PLAYER_LIVES);
    expect(sim.players).toHaveLength(1);
    expect(resolveGameConfig({ playerCount: 1, livesMode: 'shared' }).livesMode).toBe('independent');
  });

  it('two players start on their own spawn points with their own lives, numbers and zero scores', () => {
    const sim = quietCoop();
    const [p1, p2] = sim.players;
    expect(sim.players).toHaveLength(2);
    expect(sim.player2).toBe(p2);
    expect(p1?.position).toEqual({ x: 320, y: 360 });
    expect(p2?.position).toEqual({ x: 960, y: 360 });
    expect(p1?.position).toEqual(PLAYER_SPAWNS[0]);
    expect(p2?.position).toEqual(PLAYER_SPAWNS[1]);
    expect([p1?.playerNumber, p2?.playerNumber]).toEqual([1, 2]);
    expect([p1?.lives, p2?.lives]).toEqual([PLAYER_LIVES, PLAYER_LIVES]);
    expect([p1?.score, p2?.score]).toEqual([0, 0]);
    expect(p1).not.toBe(p2);
    expect(p1?.position).not.toBe(p2?.position);
    expect(sim.config.friendlyFire).toBe(true); // Python's FRIENDLY_FIRE_ENABLED default
  });

  it('shared lives: one pool of six that both ships show', () => {
    const sim = quietCoop({ livesMode: 'shared' });
    expect(sim.players.map((p) => p.lives)).toEqual([SHARED_LIVES_POOL, SHARED_LIVES_POOL]);
    expect(sim.sharedLives).toBe(6);
  });
});

describe('independent controls, movement and weapons', () => {
  it('each input drives only its own ship', () => {
    const sim = quietCoop();
    runBoth(sim, 0.5, hold({ move: 1 }), NO_INPUT);
    expect(sim.player.position.y).toBeGreaterThan(360 + 100);
    expect(sim.player2?.position).toEqual({ x: 960, y: 360 });

    const sim2 = quietCoop();
    runBoth(sim2, 0.5, NO_INPUT, hold({ rotate: 1 }));
    expect(sim2.player.rotation).toBe(0);
    expect(sim2.player2?.rotation).toBeGreaterThan(100);
  });

  it('both ships move, turn and shoot in the same frame', () => {
    const sim = quietCoop();
    const events = sim.step(FRAME, hold({ move: 1, rotate: -1, shoot: true }), hold({ move: -1, rotate: 1, shoot: true }));
    const shots = eventsOfType(events, 'shot_fired');
    expect(shots.map((e) => e.player).sort()).toEqual([1, 2]);
    expect(sim.shots.map((s) => s.owner).sort()).toEqual([1, 2]);
    expect(sim.player.rotation).toBeGreaterThan(0);
    expect(sim.player2?.rotation).toBeLessThan(360);
    expect(sim.player.isMoving && sim.player2?.isMoving).toBe(true);
  });

  it('cooldowns are per ship: a held trigger fires every 0.3 s, a tap fires once', () => {
    const sim = quietCoop();
    const events: ReturnType<typeof collectEvents> = [];
    events.push(...sim.step(FRAME, hold({ shoot: true }), hold({ shoot: true })));
    for (let i = 0; i < 59; i++) events.push(...sim.step(FRAME, hold({ shoot: true }), NO_INPUT));
    const by = (n: number): number => eventsOfType(events, 'shot_fired').filter((e) => e.player === n).length;
    expect(by(1)).toBe(4); // t = 0, 0.3, 0.6, 0.9
    expect(by(2)).toBe(1);
  });

  it('power-ups belong to the player who collected them', () => {
    const sim = quietCoop();
    const p2 = sim.player2;
    if (!p2) throw new Error('no player 2');
    p2.rapidFire = { active: true, timer: 5 };
    p2.multiShot = { active: true, timer: 5 };
    sim.step(FRAME, hold({ shoot: true }), hold({ shoot: true }));
    expect(sim.shots.filter((s) => s.owner === 1)).toHaveLength(1);
    expect(sim.shots.filter((s) => s.owner === 2)).toHaveLength(3);
    expect(sim.player.rapidFire.active).toBe(false);
    expect(sim.player.multiShot.active).toBe(false);
  });

  it('a shield, Mega Power or Boost on one ship never touches the other', () => {
    const sim = quietCoop();
    pickupAt(sim, 'shield', 320, 360);
    pickupAt(sim, 'mega_power', 960, 360);
    sim.step(FRAME);
    expect(sim.player.shieldActive).toBe(true);
    expect(sim.player2?.shieldActive).toBe(true); // mega power includes a shield, for P2 only
    expect(sim.player.megaPower.active).toBe(false);
    expect(sim.player2?.megaPower.active).toBe(true);
    sim.step(FRAME, hold({ boost: true }), NO_INPUT);
    expect(sim.player.boost.active).toBe(true);
    expect(sim.player2?.boost.active).toBe(false);
  });

  it('laser charges and boost cooldowns are per ship', () => {
    const sim = quietCoop();
    sim.step(FRAME, hold({ laser: true }), NO_INPUT);
    expect(sim.player.laser.shotsRemaining).toBe(14);
    expect(sim.player2?.laser.shotsRemaining).toBe(15);
    sim.step(FRAME, NO_INPUT, hold({ boost: true }));
    expect(sim.player.boost.cooldown).toBe(0);
    expect(sim.player2?.boost.cooldown).toBeGreaterThan(7);
  });
});

describe('speed handicaps', () => {
  function distance(speed: [number, number], p1 = hold({ move: 1 }), p2 = hold({ move: 1 })) {
    const sim = quietCoop({ speed });
    runBoth(sim, 0.5, p1, p2);
    return { p1: sim.player.position.y - 360, p2: (sim.player2?.position.y ?? 0) - 360 };
  }

  it('scales only the chosen ship, forward and backward', () => {
    const d = distance([1, 0.5]);
    expect(d.p1).toBeCloseTo(PLAYER_SPEED * 0.5, 0);
    expect(d.p2).toBeCloseTo(PLAYER_SPEED * 0.25, 0);
    const back = distance([2, 1], hold({ move: -1 }), hold({ move: -1 }));
    expect(back.p1 / back.p2).toBeCloseTo(2, 5);
  });

  it('multiplies with Boost and leaves turning and shots alone', () => {
    const sim = quietCoop({ speed: [1.5, 1] });
    sim.player.boost = { active: true, timer: 3, cooldown: 8, keyHeld: true };
    sim.step(1 / 60, hold({ move: 1 }), NO_INPUT);
    expect(sim.player.position.y - 360).toBeCloseTo((PLAYER_SPEED * 1.5 * BOOST_SPEED_MULTIPLIER) / 60, 4);

    const turn = quietCoop({ speed: [0.5, 2] });
    runBoth(turn, 0.25, hold({ rotate: 1 }), hold({ rotate: 1 }));
    expect(turn.player.rotation).toBeCloseTo(turn.player2?.rotation ?? -1, 9);

    const shot = quietCoop({ speed: [0.5, 2] });
    shot.step(FRAME, hold({ shoot: true }), hold({ shoot: true }));
    const speeds = shot.shots.map((s) => Math.hypot(s.velocity.x, s.velocity.y));
    expect(speeds[0]).toBeCloseTo(speeds[1] ?? 0, 9);
  });

  it('the one-player game is unchanged at the default speed', () => {
    const sim = quietSim();
    runFor(sim, 0.5, hold({ move: 1 }));
    expect(sim.player.speedMultiplier).toBe(1);
    expect(sim.player.position.y - 360).toBeCloseTo(PLAYER_SPEED * 0.5, 0);
  });
});

describe('independent lives, elimination and game over', () => {
  it('Player 1 running out of lives does not end the run while Player 2 is alive', () => {
    const sim = quietCoop();
    const events = knockOut(sim, sim.player);
    expect(sim.player.lives).toBe(0);
    expect(sim.isGameOver).toBe(false);
    expect(eventsOfType(events, 'player_hit').map((e) => e.livesLeft)).toEqual([2, 1, 0]);
    expect(eventsOfType(events, 'player_eliminated')).toEqual([{ type: 'player_eliminated', player: 1 }]);
    expect(eventsOfType(events, 'game_over')).toHaveLength(0);
    // The survivor keeps playing.
    const y = sim.player2?.position.y ?? 0;
    runBoth(sim, 0.3, NO_INPUT, hold({ move: 1 }));
    expect(sim.player2?.position.y).toBeGreaterThan(y + 50);
  });

  it('Player 2 running out of lives does not end the run while Player 1 is alive', () => {
    const sim = quietCoop();
    const events = knockOut(sim, sim.player2 ?? sim.player);
    expect(sim.player2?.lives).toBe(0);
    expect(sim.isGameOver).toBe(false);
    expect(eventsOfType(events, 'player_eliminated')).toEqual([{ type: 'player_eliminated', player: 2 }]);
    runBoth(sim, 0.3, hold({ move: 1 }), NO_INPUT);
    expect(sim.player.position.y).toBeGreaterThan(400);
  });

  it('an eliminated ship is inert: it does not move, shoot or fire a laser, and nothing can hit it', () => {
    const sim = quietCoop();
    const p1 = sim.player;
    knockOut(sim, p1);
    const at = { ...p1.position };
    const all = collectEvents(sim, 0.5, hold({ move: 1, shoot: true, laser: true, boost: true }));
    expect(p1.position).toEqual(at);
    expect(eventsOfType(all, 'shot_fired')).toHaveLength(0);
    expect(eventsOfType(all, 'laser_fired')).toHaveLength(0);
    sim.asteroids.push(rock(at.x, at.y, 20));
    expect(eventsOfType(sim.step(FRAME), 'player_hit')).toHaveLength(0);
    expect(p1.lives).toBe(0);
  });

  it('the run ends exactly once, when the second ship loses its last life, with both scores', () => {
    const sim = quietCoop();
    sim.player.score = 120;
    if (sim.player2) sim.player2.score = 340;
    knockOut(sim, sim.player);
    const events = knockOut(sim, sim.player2 ?? sim.player);
    expect(sim.isGameOver).toBe(true);
    expect(sim.gameOverReason).toBe('all_eliminated');
    expect(eventsOfType(events, 'game_over')).toEqual([{ type: 'game_over', score: 460, scores: [120, 340], reason: 'all_eliminated' }]);
    expect(sim.retryDelay).toBeGreaterThan(0);
    expect(collectEvents(sim, 1)).toEqual([]); // frozen: no repeated events
  });

  it('simultaneous deaths of both ships on their last lives end the run once, with no stuck state', () => {
    const sim = quietCoop();
    for (const p of sim.players) {
      p.lives = 1;
      p.isRespawning = false;
    }
    sim.asteroids.push(rock(sim.player.position.x, sim.player.position.y, 20), rock(sim.player2?.position.x ?? 0, sim.player2?.position.y ?? 0, 20));
    const events = sim.step(FRAME);
    expect(sim.isGameOver).toBe(true);
    expect(sim.players.map((p) => p.lives)).toEqual([0, 0]);
    expect(eventsOfType(events, 'game_over')).toHaveLength(1);
    expect(eventsOfType(events, 'player_hit')).toHaveLength(2);
  });

  it('simultaneous hits with lives to spare cost each ship exactly one life', () => {
    const sim = quietCoop();
    sim.asteroids.push(rock(sim.player.position.x, sim.player.position.y, 20), rock(sim.player2?.position.x ?? 0, sim.player2?.position.y ?? 0, 20));
    sim.step(FRAME);
    expect(sim.players.map((p) => p.lives)).toEqual([2, 2]);
    expect(sim.players.every((p) => p.isRespawning)).toBe(true);
  });

  it('respawn goes to the ship\'s own spawn point and protection timers are independent', () => {
    const sim = quietCoop();
    const p2 = sim.player2;
    if (!p2) throw new Error('no player 2');
    p2.position = { x: 1100, y: 100 };
    crashInto(sim, p2);
    expect(p2.position).toEqual(PLAYER_SPAWNS[1]);
    expect(p2.isRespawning).toBe(true);
    expect(sim.player.isRespawning).toBe(false);
    // Protection on one ship does not protect the other.
    const hit = hitUnprotected(sim, sim.player);
    expect(eventsOfType(hit, 'player_hit')).toHaveLength(1);
    expect(sim.player.lives).toBe(2);
    // ...and protection runs out on its own clock.
    runBoth(sim, PLAYER_RESPAWN_INVULNERABILITY + 0.1);
    expect(p2.isRespawning).toBe(false);
    expect(sim.player.isRespawning).toBe(false);
  });

  it('a ship that respawns can move and shoot at once, and its state does not disturb the other', () => {
    const sim = quietCoop();
    crashInto(sim, sim.player);
    const before = { ...(sim.player2?.position ?? { x: 0, y: 0 }) };
    const events = sim.step(FRAME, hold({ move: 1, shoot: true }), NO_INPUT);
    expect(eventsOfType(events, 'shot_fired')).toHaveLength(1);
    expect(sim.player.position.y).toBeGreaterThan(360);
    expect(sim.player2?.position).toEqual(before);
  });

  it('pausing (not stepping) in the middle of a respawn changes nothing', () => {
    const sim = quietCoop();
    crashInto(sim, sim.player);
    const timer = sim.player.respawnTimer;
    sim.step(0);
    sim.step(0, hold({ move: 1 }));
    expect(sim.player.respawnTimer).toBe(timer);
    expect(sim.player.isRespawning).toBe(true);
  });

  it('a new game from either terminal state is completely fresh', () => {
    const over = quietCoop();
    knockOut(over, over.player);
    knockOut(over, over.player2 ?? over.player);
    expect(over.isGameOver).toBe(true);
    const fresh = quietCoop();
    expect(fresh.isGameOver).toBe(false);
    expect(fresh.players.map((p) => p.lives)).toEqual([3, 3]);
    expect(fresh.shots).toHaveLength(0);
    expect(fresh.combo.count).toBe(0);
  });
});

describe('shared lives', () => {
  it('any death costs the team one life from the pool and the ship respawns at its own spawn', () => {
    const sim = quietCoop({ livesMode: 'shared' });
    const events = crashInto(sim, sim.player2 ?? sim.player);
    expect(sim.players.map((p) => p.lives)).toEqual([5, 5]);
    expect(sim.sharedLives).toBe(5);
    expect(eventsOfType(events, 'player_hit')).toEqual([{ type: 'player_hit', livesLeft: 5, source: 'asteroid', player: 2 }]);
    expect(sim.player2?.position).toEqual(PLAYER_SPAWNS[1]);
    hitUnprotected(sim, sim.player);
    expect(sim.sharedLives).toBe(4);
  });

  it('both ships stay in play while the pool lasts, then the run ends the moment it is empty', () => {
    const sim = quietCoop({ livesMode: 'shared' });
    for (let pool = 5; pool >= 1; pool--) {
      hitUnprotected(sim, pool % 2 === 0 ? sim.player : (sim.player2 ?? sim.player));
      expect(sim.sharedLives).toBe(pool);
      expect(sim.isGameOver).toBe(false);
    }
    const events = hitUnprotected(sim, sim.player);
    expect(sim.isGameOver).toBe(true);
    expect(sim.gameOverReason).toBe('shared_lives_exhausted');
    expect(sim.players.map((p) => p.lives)).toEqual([0, 0]);
    expect(eventsOfType(events, 'game_over')).toHaveLength(1);
    expect(eventsOfType(events, 'player_eliminated')).toHaveLength(0);
  });

  it('simultaneous deaths cost two lives, and an empty pool never goes negative', () => {
    const sim = quietCoop({ livesMode: 'shared' });
    sim.asteroids.push(rock(sim.player.position.x, sim.player.position.y, 20), rock(sim.player2?.position.x ?? 0, sim.player2?.position.y ?? 0, 20));
    sim.step(FRAME);
    expect(sim.sharedLives).toBe(4);

    const last = quietCoop({ livesMode: 'shared' });
    for (const p of last.players) p.lives = 1;
    last.asteroids.push(rock(last.player.position.x, last.player.position.y, 20), rock(last.player2?.position.x ?? 0, last.player2?.position.y ?? 0, 20));
    const events = last.step(FRAME);
    expect(last.players.map((p) => p.lives)).toEqual([0, 0]);
    expect(eventsOfType(events, 'game_over')).toHaveLength(1);
    expect(eventsOfType(events, 'player_hit')).toHaveLength(1);
  });

  it('a shield still protects its own ship without costing the team a life', () => {
    const sim = quietCoop({ livesMode: 'shared' });
    if (sim.player2) sim.player2.shieldActive = true;
    crashInto(sim, sim.player2 ?? sim.player);
    expect(sim.sharedLives).toBe(6);
    expect(sim.player2?.shieldActive).toBe(false);
  });

  it('Revive is never offered, and collecting one does nothing', () => {
    const sim = quietCoop({ livesMode: 'shared' });
    expect(sim.reviveEligible).toBe(false);
    pickupAt(sim, 'revive', sim.player.position.x, sim.player.position.y);
    const events = sim.step(FRAME);
    expect(eventsOfType(events, 'player_revived')).toHaveLength(0);
    expect(sim.sharedLives).toBe(6);
  });
});

describe('Revive', () => {
  function downed(): GameSim {
    const sim = quietCoop();
    knockOut(sim, sim.player2 ?? sim.player);
    sim.powerups.length = 0;
    return sim;
  }

  it('is only worth dropping while one player is out and the other is alive', () => {
    expect(new GameSim().reviveEligible).toBe(false);
    expect(quietCoop().reviveEligible).toBe(false);
    expect(downed().reviveEligible).toBe(true);
    const both = quietCoop();
    knockOut(both, both.player);
    expect(both.reviveEligible).toBe(true);
    const shared = quietCoop({ livesMode: 'shared' });
    shared.player.lives = 0;
    expect(shared.reviveEligible).toBe(false);
    const sim = downed();
    pickupAt(sim, 'revive', 640, 100);
    expect(sim.reviveEligible).toBe(false); // one at a time
  });

  it('an asteroid drop becomes a Revive when eligible (and not otherwise), using the forced RNG', () => {
    const forced = (eligible: boolean): string | undefined => {
      const rng = queueRng(2);
      const sim = quietCoop({}, 2, rng);
      if (eligible) {
        knockOut(sim, sim.player2 ?? sim.player);
        runBoth(sim, 0.4); // let the crashed rocks finish dying: they draw random shake offsets
        sim.powerups.length = 0;
      }
      sim.asteroids.push(rock(100, 100, 20));
      sim.shots.push(shotBy(1, 100, 100));
      rng.queue(0.5, 0.01, 0.0, 0.1); // no mega roll, drop roll passes, first ordinary type, Revive roll < 30 %
      sim.step(FRAME);
      return sim.powerups[0]?.type;
    };
    expect(forced(true)).toBe('revive');
    expect(forced(false)).toBe('rapid_fire');
  });

  it('a one-player game never drops a Revive, in 20 000 rolls', () => {
    const sim = quietSim(5);
    sim.player.lives = 999;
    let revives = 0;
    for (let i = 0; i < 20000; i++) {
      sim.asteroids.push(rock(100, 100, 20));
      sim.shots.push(shotBy(1, 100, 100));
      sim.step(FRAME);
      for (const p of sim.powerups) if (p.type === 'revive') revives++;
      sim.powerups.length = 0;
      sim.asteroids.length = 0;
    }
    expect(revives).toBe(0);
  });

  it('guaranteed UFO drops turn into a Revive about 30 % of the time while eligible, never otherwise', () => {
    const share = (eligible: boolean): number => {
      const sim = quietCoop({}, 11);
      if (eligible) knockOut(sim, sim.player2 ?? sim.player);
      let revive = 0;
      const n = 500;
      for (let i = 0; i < n; i++) {
        sim.powerups.length = 0;
        parkedUfoFor(sim, 'large', 640, 100);
        sim.shots.push(shotBy(1, 640, 100));
        sim.step(FRAME);
        if (sim.powerups[0]?.type === 'revive') revive++;
        sim.ufos.length = 0;
      }
      return revive / n;
    };
    expect(share(true)).toBeGreaterThan(0.22);
    expect(share(true)).toBeLessThan(0.38);
    expect(share(false)).toBe(0);
  });

  it('only a Revive at a time: while one lies on the field no second one drops', () => {
    const sim = downed();
    pickupAt(sim, 'revive', 640, 100);
    for (let i = 0; i < 300; i++) {
      sim.asteroids.push(rock(100, 100, 20));
      sim.shots.push(shotBy(1, 100, 100));
      sim.step(FRAME);
      sim.asteroids.length = 0;
    }
    expect(sim.powerups.filter((p) => p.type === 'revive')).toHaveLength(1);
  });

  it('the surviving player collecting it brings the teammate back: 3 lives, own spawn, protected, score kept, power-ups cleared', () => {
    const sim = downed();
    const p2 = sim.player2;
    if (!p2) throw new Error('no player 2');
    p2.score = 777;
    p2.rapidFire = { active: true, timer: 3 };
    const flashes = sim.pickupFlashes.length;
    pickupAt(sim, 'revive', sim.player.position.x, sim.player.position.y);
    const events = sim.step(FRAME);
    expect(eventsOfType(events, 'player_revived')).toEqual([{ type: 'player_revived', player: 2, by: 1 }]);
    expect(eventsOfType(events, 'powerup_collected')).toEqual([{ type: 'powerup_collected', powerType: 'revive', player: 1 }]);
    expect(p2.lives).toBe(REVIVE_LIVES);
    expect(p2.position).toEqual(PLAYER_SPAWNS[1]);
    expect(p2.isRespawning).toBe(true);
    expect(p2.score).toBe(777);
    expect(p2.rapidFire.active).toBe(false);
    expect(sim.players).toHaveLength(2);
    expect(sim.players[1]).toBe(p2); // the same ship, not a copy
    expect(sim.pickupFlashes.length).toBeGreaterThan(flashes);
    expect(sim.powerups.filter((p) => p.type === 'revive')).toHaveLength(0);
    expect(sim.reviveEligible).toBe(false);
  });

  it('works the other way round, and the revived ship acts normally again (and is vulnerable after its protection)', () => {
    const sim = quietCoop();
    knockOut(sim, sim.player);
    sim.powerups.length = 0;
    const p2 = sim.player2;
    if (!p2) throw new Error('no player 2');
    pickupAt(sim, 'revive', p2.position.x, p2.position.y);
    sim.step(FRAME);
    expect(sim.player.lives).toBe(3);
    const events = sim.step(FRAME, hold({ move: 1, shoot: true }), NO_INPUT);
    expect(eventsOfType(events, 'shot_fired')).toHaveLength(1);
    expect(crashInto(sim, sim.player).filter((e) => e.type === 'player_hit')).toHaveLength(0); // protected
    runBoth(sim, PLAYER_RESPAWN_INVULNERABILITY + 0.1);
    crashInto(sim, sim.player);
    expect(sim.player.lives).toBe(2);
  });

  it('an eliminated ship cannot collect, and nothing happens when the teammate is alive: the pickup is just consumed', () => {
    const sim = downed();
    const out = sim.player2;
    if (!out) throw new Error('no player 2');
    pickupAt(sim, 'revive', out.position.x, out.position.y);
    sim.step(FRAME);
    expect(sim.powerups).toHaveLength(1); // the downed ship left it alone
    expect(out.lives).toBe(0);

    const alive = quietCoop();
    pickupAt(alive, 'revive', alive.player.position.x, alive.player.position.y);
    const events = alive.step(FRAME);
    expect(eventsOfType(events, 'player_revived')).toHaveLength(0);
    expect(eventsOfType(events, 'powerup_collected')).toHaveLength(1);
    expect(alive.players.map((p) => p.lives)).toEqual([3, 3]);
  });

  it('cannot be collected twice, even when it overlaps both ships: Player 1 gets first claim', () => {
    const sim = quietCoop();
    knockOut(sim, sim.player2 ?? sim.player);
    sim.powerups.length = 0;
    sim.player.position = { x: 500, y: 300 };
    pickupAt(sim, 'revive', 500, 300);
    const events = sim.step(FRAME);
    expect(eventsOfType(events, 'powerup_collected')).toHaveLength(1);
    expect(eventsOfType(events, 'player_revived')).toHaveLength(1);

    const both = quietCoop();
    both.player.position = { x: 600, y: 300 };
    if (both.player2) both.player2.position = { x: 620, y: 300 };
    pickupAt(both, 'shield', 610, 300);
    const e = both.step(FRAME);
    expect(eventsOfType(e, 'powerup_collected').map((x) => x.player)).toEqual([1]);
    expect(both.player.shieldActive).toBe(true);
    expect(both.player2?.shieldActive).toBe(false);
  });

  it('the collector losing its last life in the same step ends the run instead; no Revive happens', () => {
    const sim = downed();
    sim.player.lives = 1;
    sim.player.isRespawning = false;
    pickupAt(sim, 'revive', sim.player.position.x, sim.player.position.y);
    sim.asteroids.push(rock(sim.player.position.x, sim.player.position.y, 20));
    const events = sim.step(FRAME);
    expect(sim.isGameOver).toBe(true);
    expect(eventsOfType(events, 'player_revived')).toHaveLength(0);
    expect(sim.player2?.lives).toBe(0);
  });

  it('a Revive expires uncollected after its 15 s, and a new one can drop afterwards', () => {
    const sim = downed();
    pickupAt(sim, 'revive', 640, 100);
    expect(sim.powerups[0]?.lifetime).toBe(REVIVE_LIFETIME);
    runBoth(sim, REVIVE_LIFETIME + 0.5);
    expect(sim.powerups).toHaveLength(0);
    expect(sim.reviveEligible).toBe(true);
  });

  it('a revived ship that is knocked out again can be revived again', () => {
    const sim = downed();
    pickupAt(sim, 'revive', sim.player.position.x, sim.player.position.y);
    sim.step(FRAME);
    knockOut(sim, sim.player2 ?? sim.player);
    expect(sim.player2?.lives).toBe(0);
    expect(sim.reviveEligible).toBe(true);
    sim.powerups.length = 0;
    pickupAt(sim, 'revive', sim.player.position.x, sim.player.position.y);
    sim.step(FRAME);
    expect(sim.player2?.lives).toBe(3);
  });

  it('laser and boost keys held while a ship is out do not fire the moment it is revived', () => {
    const sim = downed();
    const out = sim.player2;
    if (!out) throw new Error('no player 2');
    runBoth(sim, 0.2, NO_INPUT, hold({ laser: true, boost: true }));
    pickupAt(sim, 'revive', sim.player.position.x, sim.player.position.y);
    const events = sim.step(FRAME, NO_INPUT, hold({ laser: true, boost: true }));
    expect(out.lives).toBe(3);
    expect(eventsOfType(events, 'laser_fired')).toHaveLength(0);
    expect(eventsOfType(events, 'boost_started')).toHaveLength(0);
    // Released and pressed again: now they work.
    sim.step(FRAME, NO_INPUT, NO_INPUT);
    const again = sim.step(FRAME, NO_INPUT, hold({ laser: true }));
    expect(eventsOfType(again, 'laser_fired')).toHaveLength(1);
  });
});
