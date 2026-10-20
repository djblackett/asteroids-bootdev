import { describe, expect, it } from 'vitest';
import { PLAYER_SPAWNS, UFO_SHOT_SPEED } from '../src/core/constants';
import { GameSim } from '../src/core/game';
import { NO_INPUT, type PlayerState } from '../src/core/player';
import {
  FRAME,
  collectEvents,
  crashInto,
  eventsOfType,
  hold,
  knockOut,
  parkedUfoFor,
  quietCoop,
  quietSim,
  rock,
  runFor,
  shotBy,
  ufoShotAt,
} from './helpers';

/** Phase 4: friendly fire, who gets credited, collision ordering, and UFO targeting with two ships. */

function ships(sim: GameSim): [PlayerState, PlayerState] {
  if (!sim.player2) throw new Error('no player 2');
  return [sim.player, sim.player2];
}

/** Player 1 on the left facing right, Player 2 on the right, nothing else around. */
function facing(config: Parameters<typeof quietCoop>[0] = {}): { sim: GameSim; p1: PlayerState; p2: PlayerState } {
  const sim = quietCoop(config);
  const [p1, p2] = ships(sim);
  p1.position = { x: 200, y: 360 };
  p1.rotation = 270; // facing right
  p2.position = { x: 800, y: 360 };
  p2.rotation = 90;
  return { sim, p1, p2 };
}

describe('friendly fire: shots', () => {
  it("a player's shot hurts the other ship: a life, the respawn, the shot is used up, no points, no combo", () => {
    const { sim, p1, p2 } = facing();
    const shot = shotBy(1, p2.position.x, p2.position.y);
    sim.shots.push(shot);
    const events = sim.step(FRAME);
    expect(p2.lives).toBe(2);
    expect(p1.lives).toBe(3);
    expect(shot.alive).toBe(false);
    expect(p2.position).toEqual(PLAYER_SPAWNS[1]);
    expect(eventsOfType(events, 'player_hit')).toEqual([{ type: 'player_hit', livesLeft: 2, source: 'friendly_shot', player: 2 }]);
    expect(p1.score).toBe(0);
    expect(sim.combo.count).toBe(0);
  });

  it('works both ways', () => {
    const { sim, p1, p2 } = facing();
    sim.shots.push(shotBy(2, p1.position.x, p1.position.y));
    sim.step(FRAME);
    expect(p1.lives).toBe(2);
    expect(p2.lives).toBe(3);
  });

  it('a shot that flies across the screen actually reaches the other ship', () => {
    const { sim, p1, p2 } = facing();
    const events = collectEvents(sim, 1.6, hold({ shoot: true }));
    expect(eventsOfType(events, 'player_hit').some((e) => e.source === 'friendly_shot' && e.player === 2)).toBe(true);
    expect(p1.lives).toBe(3);
    expect(p2.lives).toBeLessThan(3);
  });

  it('a ship is never hurt by its own shots, even when it fires through itself', () => {
    const { sim, p1 } = facing();
    sim.shots.push(shotBy(1, p1.position.x, p1.position.y));
    const events = sim.step(FRAME);
    expect(p1.lives).toBe(3);
    expect(eventsOfType(events, 'player_hit')).toHaveLength(0);
  });

  it('multi-shot and rapid-fire bullets all carry their owner and all count', () => {
    const { sim, p1 } = facing();
    p1.multiShot = { active: true, timer: 5 };
    p1.rapidFire = { active: true, timer: 5 };
    sim.step(FRAME, hold({ shoot: true }));
    expect(sim.shots).toHaveLength(3);
    expect(sim.shots.every((s) => s.owner === 1)).toBe(true);
  });

  it('a shield absorbs the hit (shield gone, no life lost) and the shot is used up', () => {
    const { sim, p2 } = facing();
    p2.shieldActive = true;
    const shot = shotBy(1, p2.position.x, p2.position.y);
    sim.shots.push(shot);
    const events = sim.step(FRAME);
    expect(p2.shieldActive).toBe(false);
    expect(p2.lives).toBe(3);
    expect(shot.alive).toBe(false);
    expect(eventsOfType(events, 'player_hit')).toHaveLength(0);
  });

  it('respawn protection absorbs the hit without being used up, and the shot is still used up', () => {
    const { sim, p2 } = facing();
    p2.isRespawning = true;
    p2.respawnTimer = 1;
    const shot = shotBy(1, p2.position.x, p2.position.y);
    sim.shots.push(shot);
    sim.step(FRAME);
    expect(p2.lives).toBe(3);
    expect(shot.alive).toBe(false);
    expect(p2.respawnTimer).toBeLessThan(1);
    expect(p2.isRespawning).toBe(true);
  });

  it('can be switched off: shots pass through the other ship', () => {
    const { sim, p2 } = facing({ friendlyFire: false });
    const shot = shotBy(1, p2.position.x, p2.position.y);
    sim.shots.push(shot);
    sim.step(FRAME);
    expect(p2.lives).toBe(3);
    expect(shot.alive).toBe(true);
  });

  it('there is no friendly fire in a one-player game, whatever was asked for', () => {
    const sim = new GameSim({ rng: undefined, startCooldown: 0, ufos: false, config: { playerCount: 1, friendlyFire: true } });
    sim.spawner.spawnTimer = -1e9;
    sim.shots.push(shotBy(1, sim.player.position.x, sim.player.position.y));
    sim.step(FRAME);
    expect(sim.player.lives).toBe(3);
  });

  it("killing the other ship's last life with a shot eliminates it; the shooter plays on, or the run ends if it was the last ship", () => {
    const { sim, p1, p2 } = facing();
    p2.lives = 1;
    p2.isRespawning = false;
    sim.shots.push(shotBy(1, p2.position.x, p2.position.y));
    const events = sim.step(FRAME);
    expect(p2.lives).toBe(0);
    expect(sim.isGameOver).toBe(false);
    expect(eventsOfType(events, 'player_eliminated')).toEqual([{ type: 'player_eliminated', player: 2 }]);
    expect(p1.score).toBe(0);

    p1.lives = 1;
    p1.isRespawning = false;
    sim.shots.push(shotBy(2, p1.position.x, p1.position.y)); // a shot already in flight from the dead ship
    const end = sim.step(FRAME);
    expect(sim.isGameOver).toBe(true);
    expect(eventsOfType(end, 'game_over')).toHaveLength(1);
  });

  it('with shared lives a friendly hit costs the team a life', () => {
    const { sim, p2 } = facing({ livesMode: 'shared' });
    sim.shots.push(shotBy(1, p2.position.x, p2.position.y));
    sim.step(FRAME);
    expect(sim.sharedLives).toBe(5);
  });
});

describe('friendly fire: Laser Beam', () => {
  it('hurts the other ship exactly once for the whole beam, never its owner', () => {
    const { sim, p1, p2 } = facing();
    const events = [...sim.step(FRAME, hold({ laser: true })), ...collectEvents(sim, 0.5)];
    const hits = eventsOfType(events, 'player_hit');
    expect(hits).toEqual([{ type: 'player_hit', livesLeft: 2, source: 'friendly_laser', player: 2 }]);
    expect(p2.lives).toBe(2);
    expect(p1.lives).toBe(3);
  });

  it('a shield absorbs it and the beam does not hit again once the shield is gone', () => {
    const { sim, p2 } = facing();
    p2.shieldActive = true;
    runFor(sim, 0.01, hold({ laser: true }));
    runFor(sim, 0.5);
    expect(p2.shieldActive).toBe(false);
    expect(p2.lives).toBe(3);
  });

  it('does not touch a ship that is off its line', () => {
    const { sim, p2 } = facing();
    p2.position = { x: 800, y: 600 };
    runFor(sim, 0.5, hold({ laser: true }));
    expect(p2.lives).toBe(3);
  });

  it('is off when friendly fire is off', () => {
    const { sim, p2 } = facing({ friendlyFire: false });
    runFor(sim, 0.5, hold({ laser: true }));
    expect(p2.lives).toBe(3);
  });

  it('the beam of an eliminated player still pays the owner for kills but cannot hurt a dead ship', () => {
    const { sim, p1, p2 } = facing();
    sim.step(FRAME, hold({ laser: true })); // beam in the air
    knockOut(sim, p2);
    expect(p2.lives).toBe(0);
    expect(p1.lives).toBe(3);
  });
});

describe('no other ship-versus-ship interaction (as in Python)', () => {
  it('ships may overlap freely and a boosting ship does not hurt the other', () => {
    const { sim, p1, p2 } = facing();
    p2.position = { ...p1.position };
    p1.boost = { active: true, timer: 3, cooldown: 8, keyHeld: true };
    runFor(sim, 0.5);
    expect(p1.lives).toBe(3);
    expect(p2.lives).toBe(3);
  });
});

describe('who is credited, and one result per object', () => {
  it('a shot pays only its owner, at the team combo', () => {
    const sim = quietCoop();
    const [p1, p2] = ships(sim);
    sim.asteroids.push(rock(100, 100, 20), rock(300, 100, 20));
    sim.shots.push(shotBy(1, 100, 100), shotBy(2, 300, 100));
    const events = sim.step(FRAME);
    expect(p1.score).toBe(50); // first kill: x1
    expect(p2.score).toBe(75); // second kill: the combo is shared, x1.5
    expect(eventsOfType(events, 'asteroid_destroyed').map((e) => [e.player, e.points])).toEqual([
      [1, 50],
      [2, 75],
    ]);
    expect(sim.combo.count).toBe(2);
  });

  it('both ships shooting the same rock in one frame: one kill, one payment (the earlier shot), one explosion', () => {
    const sim = quietCoop();
    const [p1, p2] = ships(sim);
    sim.asteroids.push(rock(100, 100, 20));
    const second = shotBy(2, 100, 100);
    sim.shots.push(shotBy(1, 100, 100), second);
    const events = sim.step(FRAME);
    expect(eventsOfType(events, 'asteroid_destroyed')).toHaveLength(1);
    expect(p1.score).toBe(50);
    expect(p2.score).toBe(0);
    expect(sim.combo.count).toBe(1);
    expect(second.alive).toBe(true); // it passed the dying rock
  });

  it("a shot and a laser on the same rock in one frame: the shot is resolved first, so the shooter is paid once", () => {
    const sim = quietCoop();
    const [p1, p2] = ships(sim);
    p1.position = { x: 100, y: 300 };
    p1.rotation = 270;
    sim.asteroids.push(rock(400, 300, 20));
    sim.shots.push(shotBy(2, 400, 300));
    sim.step(FRAME, hold({ laser: true }));
    runFor(sim, 0.4);
    expect(p2.score).toBe(50);
    expect(p1.score).toBe(0);
    expect(sim.combo.count).toBe(1);
  });

  it("one ship's laser pierces a rock while the other ship's shot hits a different one: each is paid to its owner", () => {
    const sim = quietCoop();
    const [p1, p2] = ships(sim);
    p1.position = { x: 100, y: 300 };
    p1.rotation = 270;
    sim.asteroids.push(rock(400, 300, 20), rock(700, 500, 20));
    sim.shots.push(shotBy(2, 700, 500));
    sim.step(FRAME, hold({ laser: true }));
    runFor(sim, 0.4);
    expect(p2.score).toBeGreaterThan(0);
    expect(p1.score).toBeGreaterThan(0);
    expect(sim.combo.count).toBe(2);
  });

  it("a boost ram pays the booster only; the other ship's lives and shield are untouched", () => {
    const sim = quietCoop();
    const [p1, p2] = ships(sim);
    p1.boost = { active: true, timer: 3, cooldown: 8, keyHeld: true };
    p2.shieldActive = true;
    p2.position = { x: p1.position.x + 60, y: p1.position.y };
    sim.asteroids.push(rock(p1.position.x + 5, p1.position.y, 20));
    sim.step(FRAME);
    expect(p1.score).toBeGreaterThan(0);
    expect(p2.score).toBe(0);
    expect(p1.lives).toBe(3);
    expect(p2.shieldActive).toBe(true);
  });

  it('a crashed ship pays nobody and does not move the combo', () => {
    const sim = quietCoop();
    const [p1, p2] = ships(sim);
    const events = crashInto(sim, p2);
    expect(eventsOfType(events, 'asteroid_destroyed')[0]?.points).toBe(0);
    expect(p1.score + p2.score).toBe(0);
    expect(sim.combo.count).toBe(0);
  });

  it('one rock touching both ships crashes into the nearer one only (Player 1 on a tie)', () => {
    const sim = quietCoop();
    const [p1, p2] = ships(sim);
    p1.position = { x: 500, y: 300 };
    p2.position = { x: 540, y: 300 };
    sim.asteroids.push(rock(520, 300, 20));
    sim.step(FRAME);
    expect([p1.lives, p2.lives]).toEqual([2, 3]); // equidistant: Player 1
    sim.asteroids.push(rock(535, 300, 20));
    p1.isRespawning = false;
    p1.position = { x: 500, y: 300 };
    sim.step(FRAME);
    expect(p2.lives).toBe(2);
  });

  it('UFO kills pay the shooter the flat amount and never touch the combo', () => {
    const sim = quietCoop();
    const [p1, p2] = ships(sim);
    parkedUfoFor(sim, 'small', 640, 100);
    sim.shots.push(shotBy(2, 640, 100));
    const events = sim.step(FRAME);
    expect(p2.score).toBe(500);
    expect(p1.score).toBe(0);
    expect(eventsOfType(events, 'ufo_destroyed')[0]?.player).toBe(2);
    expect(sim.combo.count).toBe(0);
  });

  it('both ships hitting one UFO in the same frame: one kill, one payment to the earlier shot, one drop', () => {
    const sim = quietCoop();
    const [p1, p2] = ships(sim);
    parkedUfoFor(sim, 'large', 640, 100);
    const late = shotBy(2, 640, 100);
    sim.shots.push(shotBy(1, 640, 100), late);
    const events = sim.step(FRAME);
    expect(eventsOfType(events, 'ufo_destroyed')).toHaveLength(1);
    expect(eventsOfType(events, 'powerup_dropped')).toHaveLength(1);
    expect(p1.score).toBe(200);
    expect(p2.score).toBe(0);
    expect(sim.powerups).toHaveLength(1);
    expect(late.alive).toBe(true);
  });

  it('a UFO rammed by one ship and shot by the other in the same frame is paid once', () => {
    const sim = quietCoop();
    const [p1, p2] = ships(sim);
    p1.boost = { active: true, timer: 3, cooldown: 8, keyHeld: true };
    p1.position = { x: 640, y: 300 };
    parkedUfoFor(sim, 'large', 650, 300);
    sim.shots.push(shotBy(2, 650, 300));
    const events = sim.step(FRAME);
    expect(p1.score + p2.score).toBe(200);
    expect(eventsOfType(events, 'ufo_destroyed')).toHaveLength(1);
    expect(eventsOfType(events, 'powerup_dropped')).toHaveLength(1); // (the ramming ship is sitting on it, so it is collected at once)
  });

  it('a UFO shot that kills a rock pays nobody, but the combo counts it', () => {
    const sim = quietCoop();
    sim.asteroids.push(rock(100, 100, 20));
    sim.ufoShots.push(ufoShotAt(100, 100));
    sim.step(FRAME);
    expect(sim.totalScore).toBe(0);
    expect(sim.combo.count).toBe(1);
  });

  it('a UFO shot touching both ships hits only the nearer one and is used up', () => {
    const sim = quietCoop();
    const [p1, p2] = ships(sim);
    p1.position = { x: 500, y: 300 };
    p2.position = { x: 535, y: 300 };
    const shot = ufoShotAt(525, 300);
    sim.ufoShots.push(shot);
    const events = sim.step(FRAME);
    expect(shot.alive).toBe(false);
    expect(eventsOfType(events, 'player_hit')).toEqual([{ type: 'player_hit', livesLeft: 2, source: 'ufo_shot', player: 2 }]);
    expect([p1.lives, p2.lives]).toEqual([3, 2]);
  });

  it("a player's shot that reaches the other ship and an enemy in the same step: the enemy is resolved first (shots vs enemies precede friendly fire)", () => {
    const sim = quietCoop();
    const [p1, p2] = ships(sim);
    sim.asteroids.push(rock(p2.position.x, p2.position.y, 20));
    sim.shots.push(shotBy(1, p2.position.x, p2.position.y));
    sim.step(FRAME);
    // The crash on P2 comes first in the pass; the shot is then spent on the (now dying) rock's neighbour: nothing.
    expect(p2.lives).toBeLessThanOrEqual(3);
    expect(p1.score).toBe(0);
    expect(sim.players.every((p) => p.lives >= 2)).toBe(true);
  });

  it("a protected ship staying in contact with a hazard is hit only as often as the rules say, and independently of the other ship", () => {
    const sim = quietCoop();
    const [p1, p2] = ships(sim);
    p1.shieldActive = true;
    parkedUfoFor(sim, 'large', p1.position.x + 20, p1.position.y);
    parkedUfoFor(sim, 'large', p2.position.x + 20, p2.position.y);
    runFor(sim, 0.5);
    expect(p1.lives).toBe(3); // shield, then grace
    expect(p2.lives).toBe(2); // unshielded: one hit, then respawn protection / separation
  });

  it('a power-up touching both ships goes to Player 1 only, once', () => {
    const sim = quietCoop();
    const [p1, p2] = ships(sim);
    p1.position = { x: 600, y: 300 };
    p2.position = { x: 625, y: 300 };
    sim.powerups.push({ position: { x: 612, y: 300 }, velocity: { x: 0, y: 0 }, radius: 15, type: 'rapid_fire', lifetime: 10, alive: true });
    const events = sim.step(FRAME);
    expect(eventsOfType(events, 'powerup_collected')).toHaveLength(1);
    expect(p1.rapidFire.active).toBe(true);
    expect(p2.rapidFire.active).toBe(false);
  });
});

describe('scores and game over', () => {
  it('totals and per-player scores are reported at the end', () => {
    const sim = quietCoop();
    const [p1, p2] = ships(sim);
    p1.score = 10;
    p2.score = 32;
    expect(sim.totalScore).toBe(42);
    knockOut(sim, p1);
    const events = knockOut(sim, p2);
    expect(eventsOfType(events, 'game_over')[0]).toMatchObject({ score: 42, scores: [10, 32] });
  });

  it('scores survive elimination and Revive', () => {
    const sim = quietCoop();
    const [p1, p2] = ships(sim);
    p2.score = 300;
    knockOut(sim, p2);
    expect(p2.score).toBe(300);
    sim.powerups.push({ position: { ...p1.position }, velocity: { x: 0, y: 0 }, radius: 15, type: 'revive', lifetime: 10, alive: true });
    sim.step(FRAME);
    expect(p2.score).toBe(300);
    expect(p2.lives).toBe(3);
  });
});

describe('UFO targeting with two ships', () => {
  it('shoots at the nearest living, unprotected ship', () => {
    const sim = quietCoop();
    const [p1, p2] = ships(sim);
    expect(sim.targetFor({ x: 300, y: 100 })).toBe(p1);
    expect(sim.targetFor({ x: 900, y: 100 })).toBe(p2);
    p1.isRespawning = true;
    expect(sim.targetFor({ x: 300, y: 100 })).toBe(p2);
    p1.isRespawning = false;
    p2.lives = 0;
    expect(sim.targetFor({ x: 900, y: 100 })).toBe(p1);
    p1.lives = 0;
    expect(sim.targetFor({ x: 900, y: 100 })).toBeNull();
  });

  it('a tie goes to Player 1', () => {
    const sim = quietCoop();
    expect(sim.targetFor({ x: 640, y: 360 })).toBe(sim.player);
  });

  it('tracks the ships as they move, die, respawn and return', () => {
    const sim = quietCoop();
    const [p1, p2] = ships(sim);
    const at = { x: 500, y: 100 };
    expect(sim.targetFor(at)).toBe(p1);
    p2.position = { x: 520, y: 140 };
    expect(sim.targetFor(at)).toBe(p2);
    crashInto(sim, p2); // respawning at its spawn, protected: not a target
    expect(sim.targetFor(at)).toBe(p1);
    runFor(sim, 2.1);
    expect(sim.targetFor({ x: 900, y: 360 })).toBe(p2);
    knockOut(sim, p2);
    expect(sim.targetFor({ x: 900, y: 360 })).toBe(p1);
    sim.powerups.push({ position: { ...p1.position }, velocity: { x: 0, y: 0 }, radius: 15, type: 'revive', lifetime: 10, alive: true });
    sim.step(FRAME);
    runFor(sim, 2.1);
    expect(sim.targetFor({ x: 900, y: 360 })).toBe(p2);
  });

  it('an actual UFO shot is aimed at the nearer ship (perfect aim), not at the other', () => {
    const aimed = (ufoX: number): { dx: number; dy: number } => {
      const sim = quietCoop();
      const ufo = parkedUfoFor(sim, 'small', ufoX, 100);
      ufo.accuracy = 1;
      ufo.shootTimer = 0;
      sim.step(FRAME);
      const shot = sim.ufoShots[0];
      if (!shot) throw new Error('no shot');
      return { dx: shot.velocity.x / UFO_SHOT_SPEED, dy: shot.velocity.y / UFO_SHOT_SPEED };
    };
    expect(aimed(300).dx).toBeLessThan(0.1); // above P1 (x = 320): straight down
    expect(aimed(300).dy).toBeGreaterThan(0.9);
    expect(aimed(980).dx).toBeLessThan(0.1); // above P2 (x = 960)
    expect(aimed(900).dx).toBeGreaterThan(0.1); // a bit left of P2: aims right, towards P2
  });

  it('with no ship alive nothing is targeted (the shot goes to a random point)', () => {
    const sim = quietCoop();
    for (const p of sim.players) p.lives = 0;
    expect(sim.targetFor({ x: 1, y: 1 })).toBeNull();
  });

  it('UFO spawning is the same in a two-player game: first at 5 s, large only at first', () => {
    const sim = new GameSim({ startCooldown: 0, config: { playerCount: 2 } });
    sim.spawner.spawnTimer = -1e9;
    for (const p of sim.players) p.lives = 999;
    let first = -1;
    let type = '';
    for (let i = 0; i < 60 * 8 && first < 0; i++) {
      const e = eventsOfType(sim.step(FRAME), 'ufo_spawned')[0];
      if (e) {
        first = sim.time;
        type = e.ufoType;
      }
    }
    expect(first).toBeGreaterThanOrEqual(5);
    expect(first).toBeLessThan(5.1);
    expect(type).toBe('large');
  });
});

describe('one-player play is untouched by the co-op code', () => {
  it('Player 2 inputs are ignored and there is exactly one ship to hit', () => {
    const sim = quietSim();
    sim.step(FRAME, NO_INPUT, hold({ move: 1, shoot: true, laser: true }));
    expect(sim.shots).toHaveLength(0);
    expect(sim.lasers).toHaveLength(0);
    expect(sim.players).toHaveLength(1);
  });
});
