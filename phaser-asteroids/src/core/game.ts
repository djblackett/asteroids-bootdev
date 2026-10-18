import {
  ASTEROID_SPAWN_RATE,
  BOUNDARY_PARTICLE_COUNT,
  BOUNDARY_SHAKE_AMOUNT,
  BOUNDARY_SPARK_INTERVAL,
  DIFFICULTY_INCREASE_INTERVAL,
  DIFFICULTY_SPAWN_RATE_INCREMENT,
  DIFFICULTY_SPAWN_RATE_MIN,
  DIFFICULTY_SPEED_INCREMENT,
  EXHAUST_PARTICLE_SPEED,
  EXHAUST_PARTICLE_SPREAD,
  GAME_OVER_RETRY_DELAY,
  GAME_START_COOLDOWN,
  MAX_FRAME_DT,
  MAX_SUBSTEP_DT,
  MEGA_POWER_DURATION,
  PARTICLE_SPEED,
  PLAYER_RESPAWN_X,
  PLAYER_RESPAWN_Y,
  PLAYER_START_X,
  PLAYER_START_Y,
  SCREEN_SHAKE_COOLDOWN,
  SCREEN_SHAKE_DECAY,
  SCREEN_SHAKE_MAX,
  SLOW_MOTION_DURATION,
  SLOW_MOTION_FACTOR,
} from './constants';
import {
  beginDeath,
  getPoints,
  takeHit,
  updateAsteroid,
  type Asteroid,
  type DeathEffect,
} from './asteroid';
import { laserHits, updateLaser, type LaserBeam } from './laser';
import { circlesOverlap, rotateVec, type Vec2 } from './math';
import { emitBurst, ParticleSystem } from './particles';
import {
  activateMegaPower,
  activateMultiShot,
  activateRapidFire,
  activateShield,
  createPlayer,
  respawnPlayer,
  takeDamage,
  updatePlayer,
  NO_INPUT,
  type PlayerInput,
  type PlayerState,
} from './player';
import { maybeSpawnPowerUp, updatePowerUp, type PowerUp, type PowerUpType } from './powerup';
import { defaultRng, uniform, type Rng } from './rng';
import { updateShot, type Shot } from './shot';
import { createSpawner, updateSpawner, type SpawnerState } from './spawner';
import { Starfield } from './starfield';

/** Things that happened during a step that the presentation layer may want to react to (audio, ...). */
export type SimEvent =
  | { type: 'shot_fired' } // one per trigger pull, however many projectiles it produced
  | { type: 'laser_fired' }
  | { type: 'boost_started' }
  | { type: 'asteroid_destroyed'; radius: number; points: number }
  | { type: 'asteroid_hit'; position: Vec2 }
  | { type: 'powerup_dropped'; powerType: PowerUpType }
  | { type: 'powerup_collected'; powerType: PowerUpType }
  | { type: 'player_hit'; livesLeft: number }
  | { type: 'wall_bounce' }
  | { type: 'game_over'; score: number };

export type GamePhase = 'playing' | 'gameOver';

/** Brief expanding ring shown where a power-up was picked up. */
export interface PickupFlash {
  position: Vec2;
  type: PowerUpType;
  age: number;
}
export const PICKUP_FLASH_DURATION = 0.4;

export interface GameSimOptions {
  rng?: Rng;
  /** Overrides the "no shooting right after starting" grace period (mainly for tests). */
  startCooldown?: number;
}

/**
 * The whole game rules, with no rendering or Phaser dependency. A scene feeds it input and a frame
 * time, then draws whatever state it finds. Mirrors the update order of the Python `gameloop.py`:
 * timers -> difficulty -> player -> entities -> starfield -> collisions.
 */
export class GameSim {
  readonly rng: Rng;
  phase: GamePhase = 'playing';

  readonly player: PlayerState;
  shots: Shot[] = [];
  asteroids: Asteroid[] = [];
  powerups: PowerUp[] = [];
  lasers: LaserBeam[] = [];
  pickupFlashes: PickupFlash[] = [];
  readonly particles = new ParticleSystem();
  readonly starfield: Starfield;
  readonly spawner: SpawnerState = createSpawner();

  /** Seconds of play since (re)start. */
  time = 0;
  difficultyTimer = 0;
  asteroidSpeedMultiplier = 1;
  asteroidSpawnRate = ASTEROID_SPAWN_RATE;
  startCooldown: number;

  /**
   * Slow Motion is a property of the world, not the player, and only slows asteroids: the spawner,
   * shots, pickups, ship, cooldowns and every timer keep running on real time.
   */
  slowMotion = { active: false, timer: 0 };

  /** Current screen-shake magnitude in pixels; decays linearly. */
  screenShake = 0;
  private screenShakeCooldown = 0;
  private sparkTimer = 0;

  /** Counts down after game over; retry is only allowed once it reaches zero. */
  retryDelay = 0;

  private events: SimEvent[] = [];

  constructor(options: GameSimOptions = {}) {
    this.rng = options.rng ?? defaultRng;
    this.startCooldown = options.startCooldown ?? GAME_START_COOLDOWN;
    this.player = createPlayer(PLAYER_START_X, PLAYER_START_Y);
    this.starfield = new Starfield(this.rng);
  }

  get isGameOver(): boolean {
    return this.phase === 'gameOver';
  }

  /**
   * Advances the game by one rendered frame. Long frames are clamped and split into short
   * sub-steps so behaviour (and collision detection) stays stable at any refresh rate.
   */
  step(frameDt: number, input: PlayerInput = NO_INPUT): SimEvent[] {
    this.events = [];
    const dt = Math.min(Math.max(frameDt, 0), MAX_FRAME_DT);
    if (dt === 0) return this.events;

    const steps = Math.ceil(dt / MAX_SUBSTEP_DT);
    const sub = dt / steps;
    for (let i = 0; i < steps; i++) {
      if (this.phase === 'playing') this.substep(sub, input);
      else this.stepGameOver(sub);
    }
    return this.events;
  }

  // --- phases ---------------------------------------------------------------

  private stepGameOver(dt: number): void {
    // Entities freeze, but explosion particles finish and the retry countdown runs.
    this.retryDelay = Math.max(0, this.retryDelay - dt);
    this.particles.update(dt);
  }

  private substep(dt: number, input: PlayerInput): void {
    this.updateTimers(dt);
    this.updateDifficulty();
    this.updatePlayer(dt, input);
    this.updateEntities(dt);
    this.starfield.scroll({ x: this.player.motion.x * dt, y: this.player.motion.y * dt });
    this.processCollisions(dt);
    this.particles.update(dt);
    this.shots = this.shots.filter((s) => s.alive);
    this.asteroids = this.asteroids.filter((a) => a.alive);
    this.powerups = this.powerups.filter((p) => p.alive);
  }

  private updateTimers(dt: number): void {
    if (this.startCooldown > 0) this.startCooldown -= dt;
    this.time += dt;
    this.difficultyTimer += dt;

    if (this.slowMotion.active) {
      this.slowMotion.timer -= dt;
      if (this.slowMotion.timer <= 0) this.slowMotion.active = false;
    }

    if (this.screenShake > 0) this.screenShake = Math.max(0, this.screenShake - SCREEN_SHAKE_DECAY * dt);
    if (this.screenShakeCooldown > 0) this.screenShakeCooldown -= dt;
    if (this.sparkTimer > 0) this.sparkTimer -= dt;

    for (const flash of this.pickupFlashes) flash.age += dt;
    this.pickupFlashes = this.pickupFlashes.filter((f) => f.age < PICKUP_FLASH_DURATION);
  }

  /** Every 30 s asteroids get 15% faster and spawn a little more often. */
  private updateDifficulty(): void {
    if (this.difficultyTimer >= DIFFICULTY_INCREASE_INTERVAL) {
      this.difficultyTimer = 0;
      this.asteroidSpeedMultiplier += DIFFICULTY_SPEED_INCREMENT;
      this.asteroidSpawnRate = Math.max(
        this.asteroidSpawnRate - DIFFICULTY_SPAWN_RATE_INCREMENT,
        DIFFICULTY_SPAWN_RATE_MIN,
      );
    }
  }

  private updatePlayer(dt: number, input: PlayerInput): void {
    const player = this.player;
    player.canShoot = this.startCooldown <= 0;
    const result = updatePlayer(player, input, dt);

    if (result.shots.length > 0) {
      this.shots.push(...result.shots);
      this.events.push({ type: 'shot_fired' });
    }
    if (result.laser) {
      this.lasers.push(result.laser);
      this.events.push({ type: 'laser_fired' });
    }
    if (result.boostStarted) this.events.push({ type: 'boost_started' });

    if (result.bounce) {
      this.addScreenShake(BOUNDARY_SHAKE_AMOUNT);
      // Pushing against a wall bounces every frame; rate-limit sparks so they do not scale with FPS.
      if (this.sparkTimer <= 0) {
        this.sparkTimer = BOUNDARY_SPARK_INTERVAL;
        for (let i = 0; i < BOUNDARY_PARTICLE_COUNT; i++) {
          const dir = rotateVec(result.bounce.direction, uniform(this.rng, -30, 30));
          const speed = PARTICLE_SPEED * 0.8;
          this.particles.emit(
            result.bounce.position.x,
            result.bounce.position.y,
            { x: dir.x * speed, y: dir.y * speed },
            this.rng,
          );
        }
        this.events.push({ type: 'wall_bounce' });
      }
    }

    if (result.exhaust) {
      const spread = EXHAUST_PARTICLE_SPREAD / 2;
      const dir = rotateVec(result.exhaust.direction, uniform(this.rng, -spread, spread));
      this.particles.emit(
        result.exhaust.position.x,
        result.exhaust.position.y,
        { x: dir.x * EXHAUST_PARTICLE_SPEED, y: dir.y * EXHAUST_PARTICLE_SPEED },
        this.rng,
      );
    }
  }

  private updateEntities(dt: number): void {
    // New asteroids are updated in the same frame they spawn (this matters for the edge-cull quirk).
    this.asteroids.push(...updateSpawner(this.spawner, dt, this.asteroidSpawnRate, this.rng));

    for (const shot of this.shots) updateShot(shot, dt);

    // Slow Motion scales asteroid movement only. The death animation still ends after 0.15 real seconds.
    const baseDt = dt * this.asteroidSpeedMultiplier;
    const asteroidDt = this.slowMotion.active ? baseDt * SLOW_MOTION_FACTOR : baseDt;
    const children: Asteroid[] = [];
    for (const asteroid of this.asteroids) {
      children.push(...updateAsteroid(asteroid, asteroidDt, dt, this.rng));
    }
    this.asteroids.push(...children);

    for (const powerup of this.powerups) updatePowerUp(powerup, dt);
  }

  // --- collisions -----------------------------------------------------------

  private processCollisions(dt: number): void {
    // Same priority as the Python loop: player, shots, lasers, pickups.
    if (!this.collidePlayerWithAsteroids()) return;
    this.collideShotsWithAsteroids();
    this.collideLasersWithAsteroids(dt);
    this.collectPowerUps();
  }

  /** @returns false if the game ended during this check. */
  private collidePlayerWithAsteroids(): boolean {
    const player = this.player;
    for (const asteroid of this.asteroids) {
      if (!asteroid.alive || asteroid.dying || player.lives <= 0) continue;
      if (!circlesOverlap(player, asteroid)) continue;

      // Boosting rams through: it is checked before any damage logic, so neither a shield nor
      // respawn protection is used up and the ship can never be hurt while a boost is running.
      if (player.boost.active) {
        this.hitAsteroid(asteroid, player);
        continue;
      }

      const damage = takeDamage(player);
      if (damage === 'life_lost') {
        this.events.push({ type: 'player_hit', livesLeft: player.lives });
        if (player.lives > 0) {
          respawnPlayer(player, PLAYER_RESPAWN_X, PLAYER_RESPAWN_Y);
        } else {
          this.triggerGameOver();
          return false;
        }
      }
      // Whatever hit the ship is destroyed too (no score, no drops), even when a shield or
      // invulnerability absorbed it.
      this.destroyWithoutScore(asteroid, 0.5);
    }
    return true;
  }

  private collideShotsWithAsteroids(): void {
    for (const shot of this.shots) {
      if (!shot.alive) continue;
      for (const asteroid of this.asteroids) {
        if (!asteroid.alive || asteroid.dying) continue;
        if (!circlesOverlap(shot, asteroid)) continue;
        this.hitAsteroid(asteroid, this.player);
        shot.alive = false;
        break;
      }
    }
  }

  /**
   * Each beam hits every asteroid it touches exactly once while it lasts. Children spawned into the
   * beam's path before it fades are new objects, so they can be hit too (as in the Python game).
   */
  private collideLasersWithAsteroids(dt: number): void {
    const remaining: LaserBeam[] = [];
    for (const laser of this.lasers) {
      if (!updateLaser(laser, dt)) continue;
      remaining.push(laser);
      for (const asteroid of this.asteroids) {
        if (!asteroid.alive || asteroid.dying) continue;
        if (laserHits(laser, asteroid)) this.hitAsteroid(asteroid, this.player);
      }
    }
    this.lasers = remaining;
  }

  private collectPowerUps(): void {
    const player = this.player;
    if (player.lives <= 0) return;
    for (const powerup of this.powerups) {
      if (!powerup.alive || !circlesOverlap(player, powerup)) continue;
      this.applyPowerUp(powerup.type);
      this.pickupFlashes.push({ position: { ...powerup.position }, type: powerup.type, age: 0 });
      this.events.push({ type: 'powerup_collected', powerType: powerup.type });
      powerup.alive = false;
    }
  }

  private applyPowerUp(type: PowerUpType): void {
    const player = this.player;
    switch (type) {
      case 'mega_power':
        activateMegaPower(player);
        // Python sets (not extends) Slow Motion to the mega duration.
        this.slowMotion = { active: true, timer: MEGA_POWER_DURATION };
        break;
      case 'rapid_fire':
        activateRapidFire(player);
        break;
      case 'multi_shot':
        activateMultiShot(player);
        break;
      case 'shield':
        activateShield(player);
        break;
      case 'slow_motion':
        this.slowMotion = { active: true, timer: SLOW_MOTION_DURATION };
        break;
      case 'revive':
        // Revive only does something in two-player games; with nobody to revive it is simply consumed.
        break;
    }
  }

  /**
   * One hit on an asteroid from a shot, laser or boost ram. Armored asteroids absorb the first hit
   * (flash + sparks, no points); a kill scores, starts the death animation and may drop a power-up.
   */
  private hitAsteroid(asteroid: Asteroid, scorer: PlayerState): void {
    const result = takeHit(asteroid);
    if (!result.destroyed) {
      this.applyEffect(result.effect, 1);
      if (result.effect) this.events.push({ type: 'asteroid_hit', position: { ...asteroid.position } });
      return;
    }

    const points = getPoints(asteroid);
    scorer.score += points;
    const drop = maybeSpawnPowerUp(asteroid.position.x, asteroid.position.y, this.rng);
    this.applyEffect(beginDeath(asteroid), 1);
    this.events.push({ type: 'asteroid_destroyed', radius: asteroid.radius, points });

    if (drop) {
      this.powerups.push(drop);
      this.events.push({ type: 'powerup_dropped', powerType: drop.type });
    }
  }

  private destroyWithoutScore(asteroid: Asteroid, shakeScale: number): void {
    const effect = beginDeath(asteroid);
    this.applyEffect(effect, shakeScale);
    if (effect) this.events.push({ type: 'asteroid_destroyed', radius: asteroid.radius, points: 0 });
  }

  private applyEffect(effect: DeathEffect | null, shakeScale: number): void {
    if (!effect) return;
    this.addScreenShake(effect.shakeAmount * shakeScale);
    emitBurst(this.particles, effect.position.x, effect.position.y, effect.particleCount, this.rng);
  }

  private addScreenShake(amount: number): void {
    if (this.screenShakeCooldown > 0) return;
    this.screenShake = Math.min(this.screenShake + amount, SCREEN_SHAKE_MAX);
    this.screenShakeCooldown = SCREEN_SHAKE_COOLDOWN;
  }

  private triggerGameOver(): void {
    this.phase = 'gameOver';
    this.retryDelay = GAME_OVER_RETRY_DELAY;
    this.lasers = [];
    this.events.push({ type: 'game_over', score: this.player.score });
  }
}
