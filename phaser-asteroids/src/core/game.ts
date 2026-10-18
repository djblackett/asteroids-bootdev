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
  PARTICLE_SPEED,
  PLAYER_RESPAWN_X,
  PLAYER_RESPAWN_Y,
  PLAYER_START_X,
  PLAYER_START_Y,
  SCREEN_SHAKE_COOLDOWN,
  SCREEN_SHAKE_DECAY,
  SCREEN_SHAKE_MAX,
} from './constants';
import {
  beginDeath,
  getPoints,
  takeHit,
  updateAsteroid,
  type Asteroid,
  type DeathEffect,
} from './asteroid';
import { circlesOverlap, rotateVec, type Vec2 } from './math';
import { emitBurst, ParticleSystem } from './particles';
import {
  createPlayer,
  respawnPlayer,
  takeDamage,
  updatePlayer,
  NO_INPUT,
  type PlayerInput,
  type PlayerState,
} from './player';
import { defaultRng, uniform, type Rng } from './rng';
import { updateShot, type Shot } from './shot';
import { createSpawner, updateSpawner, type SpawnerState } from './spawner';
import { Starfield } from './starfield';

/** Things that happened during a step that the presentation layer may want to react to (audio, ...). */
export type SimEvent =
  | { type: 'shot_fired' }
  | { type: 'asteroid_destroyed'; radius: number; points: number }
  | { type: 'asteroid_hit'; position: Vec2 }
  | { type: 'player_hit'; livesLeft: number }
  | { type: 'wall_bounce' }
  | { type: 'game_over'; score: number };

export type GamePhase = 'playing' | 'gameOver';

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
  readonly particles = new ParticleSystem();
  readonly starfield: Starfield;
  readonly spawner: SpawnerState = createSpawner();

  /** Seconds of play since (re)start. */
  time = 0;
  difficultyTimer = 0;
  asteroidSpeedMultiplier = 1;
  asteroidSpawnRate = ASTEROID_SPAWN_RATE;
  startCooldown: number;

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
    this.processCollisions();
    this.particles.update(dt);
    this.shots = this.shots.filter((s) => s.alive);
    this.asteroids = this.asteroids.filter((a) => a.alive);
  }

  private updateTimers(dt: number): void {
    if (this.startCooldown > 0) this.startCooldown -= dt;
    this.time += dt;
    this.difficultyTimer += dt;
    if (this.screenShake > 0) this.screenShake = Math.max(0, this.screenShake - SCREEN_SHAKE_DECAY * dt);
    if (this.screenShakeCooldown > 0) this.screenShakeCooldown -= dt;
    if (this.sparkTimer > 0) this.sparkTimer -= dt;
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

    for (const shot of result.shots) {
      this.shots.push(shot);
      this.events.push({ type: 'shot_fired' });
    }

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

    const asteroidDt = dt * this.asteroidSpeedMultiplier;
    const children: Asteroid[] = [];
    for (const asteroid of this.asteroids) {
      children.push(...updateAsteroid(asteroid, asteroidDt, dt, this.rng));
    }
    this.asteroids.push(...children);
  }

  // --- collisions -----------------------------------------------------------

  private processCollisions(): void {
    // Player first, then shots: same priority as the Python loop.
    if (!this.collidePlayerWithAsteroids()) return;
    this.collideShotsWithAsteroids();
  }

  /** @returns false if the game ended during this check. */
  private collidePlayerWithAsteroids(): boolean {
    const player = this.player;
    for (const asteroid of this.asteroids) {
      if (!asteroid.alive || asteroid.dying || player.lives <= 0) continue;
      if (!circlesOverlap(player, asteroid)) continue;

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
      // Whatever hit the ship is destroyed too (no score), even when invulnerability absorbed it.
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

        const result = takeHit(asteroid);
        if (result.destroyed) {
          const points = getPoints(asteroid);
          this.player.score += points;
          this.applyEffect(beginDeath(asteroid), 1);
          this.events.push({ type: 'asteroid_destroyed', radius: asteroid.radius, points });
        } else {
          this.applyEffect(result.effect, 1);
          this.events.push({ type: 'asteroid_hit', position: { ...asteroid.position } });
        }
        shot.alive = false;
        break;
      }
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
    this.events.push({ type: 'game_over', score: this.player.score });
  }
}
