import type { GameOverReason, GamePhase, GameSim } from '../core/game';
import type { Vec2 } from '../core/math';
import type { PowerUpType } from '../core/powerup';
import { comboMultiplier } from '../core/scoring';
import type { UfoType } from '../core/ufo';

export interface PlayerSnapshot {
  position: Vec2;
  velocity: Vec2;
  rotation: number;
  lives: number;
  score: number;
  canShoot: boolean;
  shootTimer: number;
  isRespawning: boolean;
  respawnTimer: number;
  isMoving: boolean;
  travelHeading: number | null;
  rapidFire: { active: boolean; timer: number };
  multiShot: { active: boolean; timer: number };
  megaPower: { active: boolean; timer: number };
  shieldActive: boolean;
  boost: { active: boolean; timer: number; cooldown: number; keyHeld: boolean };
  laser: { shotsRemaining: number; cooldown: number; keyHeld: boolean };
}

export interface AsteroidSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  archetype: string;
  hitPoints: number;
  dying: boolean;
  deathTimer: number;
}

export interface UfoSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: UfoType;
  alive: boolean;
  shootTimer: number;
}

export interface ProjectileSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner?: number;
}

export interface PowerUpSnapshot {
  x: number;
  y: number;
  type: PowerUpType;
  lifetime: number;
}

export interface LaserSnapshot {
  direction: number;
  owner: number;
  timer: number;
}

export interface SimSnapshot {
  tick: number;
  time: number;
  phase: GamePhase;
  gameOverReason: GameOverReason | null;
  totalScore: number;
  difficultyLevel: number;
  difficultyTimer: number;
  asteroidSpeedMultiplier: number;
  asteroidSpawnRate: number;
  slowMotion: { active: boolean; timer: number };
  combo: { count: number; timer: number; multiplier: number };
  player: PlayerSnapshot;
  player2: PlayerSnapshot | null;
  asteroids: AsteroidSnapshot[];
  ufos: UfoSnapshot[];
  shots: ProjectileSnapshot[];
  ufoShots: ProjectileSnapshot[];
  lasers: LaserSnapshot[];
  powerups: PowerUpSnapshot[];
}

function round(n: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

function capturePlayerSnapshot(p: GameSim['player']): PlayerSnapshot {
  return {
    position: { x: round(p.position.x), y: round(p.position.y) },
    velocity: { x: round(p.velocity.x), y: round(p.velocity.y) },
    rotation: round(p.rotation, 3),
    lives: p.lives,
    score: p.score,
    canShoot: p.canShoot,
    shootTimer: round(p.shootTimer, 3),
    isRespawning: p.isRespawning,
    respawnTimer: round(p.respawnTimer, 3),
    isMoving: p.isMoving,
    travelHeading: p.travelHeading === null ? null : round(p.travelHeading, 3),
    rapidFire: { active: p.rapidFire.active, timer: round(p.rapidFire.timer, 3) },
    multiShot: { active: p.multiShot.active, timer: round(p.multiShot.timer, 3) },
    megaPower: { active: p.megaPower.active, timer: round(p.megaPower.timer, 3) },
    shieldActive: p.shieldActive,
    boost: {
      active: p.boost.active,
      timer: round(p.boost.timer, 3),
      cooldown: round(p.boost.cooldown, 3),
      keyHeld: p.boost.keyHeld,
    },
    laser: {
      shotsRemaining: p.laser.shotsRemaining,
      cooldown: round(p.laser.cooldown, 3),
      keyHeld: p.laser.keyHeld,
    },
  };
}

export function captureSimSnapshot(sim: GameSim, tick = 0): SimSnapshot {
  return {
    tick,
    time: round(sim.time, 4),
    phase: sim.phase,
    gameOverReason: sim.gameOverReason,
    totalScore: sim.totalScore,
    difficultyLevel: sim.difficultyLevel,
    difficultyTimer: round(sim.difficultyTimer, 3),
    asteroidSpeedMultiplier: round(sim.asteroidSpeedMultiplier, 3),
    asteroidSpawnRate: round(sim.asteroidSpawnRate, 3),
    slowMotion: { active: sim.slowMotion.active, timer: round(sim.slowMotion.timer, 3) },
    combo: { count: sim.combo.count, timer: round(sim.combo.timer, 3), multiplier: comboMultiplier(sim.combo.count) },
    player: capturePlayerSnapshot(sim.player),
    player2: sim.player2 ? capturePlayerSnapshot(sim.player2) : null,
    asteroids: sim.asteroids.map((a) => ({
      x: round(a.position.x),
      y: round(a.position.y),
      vx: round(a.velocity.x),
      vy: round(a.velocity.y),
      radius: a.radius,
      archetype: a.archetype,
      hitPoints: a.hitPoints,
      dying: a.dying,
      deathTimer: round(a.deathTimer, 3),
    })),
    ufos: sim.ufos.map((u) => ({
      x: round(u.position.x),
      y: round(u.position.y),
      vx: round(u.velocity.x),
      vy: round(u.velocity.y),
      type: u.type,
      alive: u.alive,
      shootTimer: round(u.shootTimer, 3),
    })),
    shots: sim.shots.map((s) => ({
      x: round(s.position.x),
      y: round(s.position.y),
      vx: round(s.velocity.x),
      vy: round(s.velocity.y),
      owner: s.owner,
    })),
    ufoShots: sim.ufoShots.map((s) => ({
      x: round(s.position.x),
      y: round(s.position.y),
      vx: round(s.velocity.x),
      vy: round(s.velocity.y),
    })),
    lasers: sim.lasers.map((l) => ({
      direction: round(l.direction, 3),
      owner: l.owner,
      timer: round(l.timer, 3),
    })),
    powerups: sim.powerups.map((p) => ({
      x: round(p.position.x),
      y: round(p.position.y),
      type: p.type,
      lifetime: round(p.lifetime, 3),
    })),
  };
}

export interface SnapshotDiff {
  match: boolean;
  differences: string[];
}

export function compareSnapshots(a: SimSnapshot, b: SimSnapshot): SnapshotDiff {
  const differences: string[] = [];

  const check = (path: string, valA: unknown, valB: unknown) => {
    if (JSON.stringify(valA) !== JSON.stringify(valB)) {
      differences.push(`${path}: expected ${JSON.stringify(valA)} but got ${JSON.stringify(valB)}`);
    }
  };

  check('phase', a.phase, b.phase);
  check('totalScore', a.totalScore, b.totalScore);
  check('difficultyLevel', a.difficultyLevel, b.difficultyLevel);
  check('player.lives', a.player.lives, b.player.lives);
  check('player.score', a.player.score, b.player.score);
  check('player.rotation', a.player.rotation, b.player.rotation);
  check('player.position', a.player.position, b.player.position);
  check('player.velocity', a.player.velocity, b.player.velocity);
  check('player.travelHeading', a.player.travelHeading, b.player.travelHeading);
  check('player.shieldActive', a.player.shieldActive, b.player.shieldActive);
  check('player.boost', a.player.boost, b.player.boost);
  check('player.laser', a.player.laser, b.player.laser);
  check('combo', a.combo, b.combo);
  check('slowMotion', a.slowMotion, b.slowMotion);
  check('asteroids.length', a.asteroids.length, b.asteroids.length);
  check('ufos.length', a.ufos.length, b.ufos.length);
  check('shots.length', a.shots.length, b.shots.length);
  check('powerups.length', a.powerups.length, b.powerups.length);

  if (differences.length === 0) {
    // If coarse checks pass, deep compare the rest
    check('asteroids', a.asteroids, b.asteroids);
    check('ufos', a.ufos, b.ufos);
    check('shots', a.shots, b.shots);
    check('powerups', a.powerups, b.powerups);
  }

  return {
    match: differences.length === 0,
    differences,
  };
}
