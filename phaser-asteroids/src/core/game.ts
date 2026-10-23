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
  LASER_HITS_UFOS,
  MAX_FRAME_DT,
  MAX_SUBSTEP_DT,
  MEGA_POWER_DURATION,
  PARTICLE_SPEED,
  PLAYER_SPAWNS,
  PLAYER_START_X,
  PLAYER_START_Y,
  REVIVE_LIVES,
  SHARED_LIVES_POOL,
  SCREEN_SHAKE_COOLDOWN,
  SCREEN_SHAKE_DECAY,
  SCREEN_SHAKE_MAX,
  SLOW_MOTION_DURATION,
  SLOW_MOTION_FACTOR,
  UFO_DESTROY_PARTICLES,
  UFO_DESTROY_SHAKE,
  UFO_SHIELD_CONTACT_GRACE,
  VOLATILE_EXPLOSION_RADIUS,
  VOLATILE_EXPLOSION_SHAKE,
} from './constants';
import {
  beginDeath,
  getPoints,
  takeHit,
  updateAsteroid,
  type Asteroid,
  type DeathEffect,
} from './asteroid';
import { DEFAULT_GAME_CONFIG, resolveGameConfig, type GameConfig } from './gameConfig';
import { laserHits, updateLaser, type LaserBeam } from './laser';
import { circlesOverlap, rotateVec, type Circle, type Vec2 } from './math';
import { emitBurst, ParticleSystem } from './particles';
import {
  activateMegaPower,
  activateMultiShot,
  activateRapidFire,
  activateShield,
  createPlayer,
  eliminatePlayer,
  respawnPlayer,
  takeDamage,
  updatePlayer,
  NO_INPUT,
  type DamageResult,
  type PlayerInput,
  type PlayerState,
} from './player';
import {
  chooseOrdinaryDrop,
  createPowerUp,
  maybeSpawnPowerUp,
  updatePowerUp,
  type PowerUp,
  type PowerUpType,
} from './powerup';
import { defaultRng, uniform, type Rng } from './rng';
import {
  createBanner,
  createCombo,
  registerKill,
  scaledPoints,
  tickBanner,
  tickCombo,
  type ComboState,
  type StreakBanner,
} from './scoring';
import { updateShot, type Shot } from './shot';
import { createSpawner, updateSpawner, type SpawnerState } from './spawner';
import { Starfield } from './starfield';
import {
  createUfo,
  createUfoSpawner,
  UFO_STATS,
  updateUfo,
  updateUfoSpawner,
  type Ufo,
  type UfoShot,
  type UfoSpawnerState,
  type UfoType,
} from './ufo';

/** What hurt a ship. */
export type HitSource = 'asteroid' | 'ufo' | 'ufo_shot' | 'friendly_shot' | 'friendly_laser';

/**
 * Things that happened during a step that the presentation layer may want to react to (audio, ...).
 * `player` is the player number (1 or 2) the event belongs to; the simulation always sets it where it applies.
 */
export type SimEvent =
  | { type: 'shot_fired'; player?: number } // one per trigger pull, however many projectiles it produced
  | { type: 'laser_fired'; player?: number }
  | { type: 'boost_started'; player?: number }
  /**
   * An asteroid started to break up. `points` is what was paid (0 when it crashed into the ship or was shot by a UFO),
   * to `player` (absent when nobody was paid). `combo` / `multiplier` are present when it was a kill that counted
   * towards the combo.
   */
  | { type: 'asteroid_destroyed'; radius: number; points: number; combo?: number; multiplier?: number; player?: number; volatile?: boolean }
  | { type: 'volatile_exploded'; position: Vec2; radius: number; depth: number }
  | { type: 'asteroid_hit'; position: Vec2 }
  | { type: 'powerup_dropped'; powerType: PowerUpType }
  | { type: 'powerup_collected'; powerType: PowerUpType; player?: number }
  /** A ship lost a life (shield and respawn protection absorb silently). `livesLeft` is the player's, or the team's pool. */
  | { type: 'player_hit'; livesLeft: number; source?: HitSource; player?: number }
  /** A player lost their last life while the teammate plays on (a run's last death is `game_over` instead). */
  | { type: 'player_eliminated'; player: number }
  /** `player` came back with `REVIVE_LIVES` lives because `by` picked up a Revive. */
  | { type: 'player_revived'; player: number; by: number }
  /** The combo just reached a kill-streak milestone: show the banner. At most one per kill. */
  | { type: 'kill_streak'; kills: number; name: string; color: number }
  | { type: 'ufo_spawned'; ufoType: UfoType }
  | { type: 'ufo_fired'; ufoType: UfoType }
  | { type: 'ufo_destroyed'; ufoType: UfoType; points: number; radius: number; position: Vec2; player?: number }
  | { type: 'wall_bounce' }
  /** `score` is the team total (the only score in a one-player game); `scores` has one entry per player. */
  | { type: 'game_over'; score: number; scores?: number[]; reason?: GameOverReason };

export type GameOverReason = 'all_eliminated' | 'shared_lives_exhausted';

export type GamePhase = 'playing' | 'gameOver';

/** Brief expanding ring shown where a power-up was picked up. */
export interface PickupFlash {
  position: Vec2;
  type: PowerUpType;
  age: number;
}
export const PICKUP_FLASH_DURATION = 0.4;

/** Presentation only: negative age briefly staggers chain rings, never their damage. No RNG is used. */
export interface VolatileFlash {
  position: Vec2;
  radius: number;
  depth: number;
  age: number;
}
export const VOLATILE_FLASH_DURATION = 0.32;
export const VOLATILE_FLASH_LIMIT = 32;

interface VolatileBlast {
  position: Vec2;
  scorer: PlayerState | null;
  depth: number;
}

export interface GameSimOptions {
  rng?: Rng;
  /** Overrides the "no shooting right after starting" grace period (mainly for tests). */
  startCooldown?: number;
  /** False switches the UFO schedule off (Python `UFO_ENABLED`); UFOs can still be added with `spawnUfo`. */
  ufos?: boolean;
  /** Whether the Laser Beam kills UFOs; defaults to `LASER_HITS_UFOS`. False restores Python's pass-through. */
  laserHitsUfos?: boolean;
  /** Players, lives mode, friendly fire and speed handicaps; the default is the classic one-player game. */
  config?: Partial<GameConfig>;
}

/**
 * The whole game rules, with no rendering or Phaser dependency. A scene feeds it input and a frame
 * time, then draws whatever state it finds. Mirrors the update order of the Python `gameloop.py`:
 * timers -> difficulty -> players -> entities -> starfield -> collisions.
 *
 * One simulation owns the shared world; one or two `PlayerState`s (`players`, `player` = Player 1) live in it.
 */
export class GameSim {
  readonly rng: Rng;
  readonly config: GameConfig;
  phase: GamePhase = 'playing';
  /** Why the run ended; null while it is on. */
  gameOverReason: GameOverReason | null = null;

  /** Player 1. */
  readonly player: PlayerState;
  /** Player 2, or null in a one-player game. */
  readonly player2: PlayerState | null;
  /** Everybody in the run in player order (length 1 or 2). */
  readonly players: PlayerState[];
  shots: Shot[] = [];
  asteroids: Asteroid[] = [];
  powerups: PowerUp[] = [];
  ufos: Ufo[] = [];
  /** Enemy projectiles; see `UfoShot` for how they differ from `shots`. */
  ufoShots: UfoShot[] = [];
  lasers: LaserBeam[] = [];
  pickupFlashes: PickupFlash[] = [];
  volatileFlashes: VolatileFlash[] = [];
  readonly particles = new ParticleSystem();
  readonly starfield: Starfield;
  readonly spawner: SpawnerState = createSpawner();
  readonly ufoSpawner: UfoSpawnerState;

  /** Combo / kill-streak counter (see `scoring.ts`). Shared by the whole team, as in Python. */
  readonly combo: ComboState = createCombo();
  /** The kill-streak banner on screen, if any. */
  streakBanner: StreakBanner | null = null;

  /** Seconds of play since (re)start. */
  time = 0;
  difficultyTimer = 0;
  /** How many difficulty steps (every 30 s) have happened; also what brings small UFOs into the schedule. */
  difficultyLevel = 0;
  asteroidSpeedMultiplier = 1;
  asteroidSpawnRate = ASTEROID_SPAWN_RATE;
  startCooldown: number;

  /**
   * Slow Motion is a property of the world, not the player, and only slows asteroids: the spawner,
   * shots, pickups, ships, cooldowns and every timer keep running on real time.
   */
  slowMotion = { active: false, timer: 0 };

  /** Current screen-shake magnitude in pixels; decays linearly. */
  screenShake = 0;
  private screenShakeCooldown = 0;
  /** Wall-spark rate limiter per player. */
  private sparkTimers: number[] = [];

  /** Counts down after game over; retry is only allowed once it reaches zero. */
  retryDelay = 0;

  private events: SimEvent[] = [];
  private readonly laserHitsUfos: boolean;

  constructor(options: GameSimOptions = {}) {
    this.rng = options.rng ?? defaultRng;
    this.laserHitsUfos = options.laserHitsUfos ?? LASER_HITS_UFOS;
    this.config = resolveGameConfig({ ...DEFAULT_GAME_CONFIG, ...options.config });
    this.startCooldown = options.startCooldown ?? GAME_START_COOLDOWN;

    const shared = this.config.livesMode === 'shared';
    const lives = shared ? SHARED_LIVES_POOL : undefined;
    if (this.config.playerCount === 1) {
      this.player = createPlayer(PLAYER_START_X, PLAYER_START_Y, 1, this.config.speed[0]);
      this.player2 = null;
    } else {
      const [s1, s2] = PLAYER_SPAWNS as readonly [Vec2, Vec2];
      this.player = createPlayer(s1.x, s1.y, 1, this.config.speed[0], lives);
      this.player2 = createPlayer(s2.x, s2.y, 2, this.config.speed[1], lives);
    }
    this.players = this.player2 ? [this.player, this.player2] : [this.player];
    this.sparkTimers = this.players.map(() => 0);
    this.starfield = new Starfield(this.rng);
    this.ufoSpawner = createUfoSpawner(options.ufos ?? true);
  }

  /** Adds a UFO (the schedule uses this too). It starts at rest and picks its first heading at random. */
  spawnUfo(type: UfoType, x: number, y: number): Ufo {
    const ufo = createUfo(x, y, type, this.rng);
    this.ufos.push(ufo);
    this.events.push({ type: 'ufo_spawned', ufoType: type });
    return ufo;
  }

  get isGameOver(): boolean {
    return this.phase === 'gameOver';
  }

  /** The team's lives in a shared-lives game, otherwise null (every player counts their own). */
  get sharedLives(): number | null {
    return this.config.livesMode === 'shared' && this.players.length > 1 ? this.player.lives : null;
  }

  /** Sum of every player's score (the only score in a one-player game). */
  get totalScore(): number {
    return this.players.reduce((sum, p) => sum + p.score, 0);
  }

  playerByNumber(number: number): PlayerState {
    return this.players.find((p) => p.playerNumber === number) ?? this.player;
  }

  /** The player a UFO at `from` shoots at: the nearest one that is alive and not under respawn protection (Player 1 on a tie). */
  targetFor(from: Vec2): PlayerState | null {
    let best: PlayerState | null = null;
    let bestDistance = Infinity;
    for (const p of this.players) {
      if (p.lives <= 0 || p.isRespawning) continue;
      const distance = (p.position.x - from.x) ** 2 + (p.position.y - from.y) ** 2;
      if (distance < bestDistance) {
        best = p;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** True while a player is out of lives (independent lives), a teammate is alive to collect it, and no Revive is lying around. */
  get reviveEligible(): boolean {
    if (this.players.length < 2 || this.config.livesMode !== 'independent' || this.reviveOnField) return false;
    return this.players.some((p) => p.lives <= 0) && this.players.some((p) => p.lives > 0);
  }

  get reviveOnField(): boolean {
    return this.powerups.some((p) => p.alive && p.type === 'revive');
  }

  /**
   * Advances the game by one rendered frame. Long frames are clamped and split into short
   * sub-steps so behaviour (and collision detection) stays stable at any refresh rate.
   * `input` is Player 1's controls, `input2` Player 2's (ignored in a one-player game).
   */
  step(frameDt: number, input: PlayerInput = NO_INPUT, input2: PlayerInput = NO_INPUT): SimEvent[] {
    this.events = [];
    const dt = Math.min(Math.max(frameDt, 0), MAX_FRAME_DT);
    if (dt === 0) return this.events;

    const inputs = [input, input2];
    const steps = Math.ceil(dt / MAX_SUBSTEP_DT);
    const sub = dt / steps;
    for (let i = 0; i < steps; i++) {
      if (this.phase === 'playing') this.substep(sub, inputs);
      else this.stepGameOver(sub);
    }
    return this.events;
  }

  // --- phases ---------------------------------------------------------------

  private stepGameOver(dt: number): void {
    // Entities freeze, but explosion particles finish and the retry countdown runs.
    this.retryDelay = Math.max(0, this.retryDelay - dt);
    this.particles.update(dt);
    this.updateVolatileFlashes(dt);
  }

  private substep(dt: number, inputs: readonly PlayerInput[]): void {
    this.updateTimers(dt);
    this.updateDifficulty();
    this.updatePlayers(dt, inputs);
    this.updateEntities(dt);
    this.scrollStarfield(dt);
    this.processCollisions(dt);
    this.particles.update(dt);
    this.shots = this.shots.filter((s) => s.alive);
    this.ufoShots = this.ufoShots.filter((s) => s.alive);
    this.ufos = this.ufos.filter((u) => u.alive);
    this.asteroids = this.asteroids.filter((a) => a.alive);
    this.powerups = this.powerups.filter((p) => p.alive);
  }

  private updateTimers(dt: number): void {
    this.updateVolatileFlashes(dt);
    if (this.startCooldown > 0) this.startCooldown -= dt;
    this.time += dt;
    this.difficultyTimer += dt;

    tickCombo(this.combo, dt);
    if (this.streakBanner && !tickBanner(this.streakBanner, dt)) this.streakBanner = null;

    if (this.slowMotion.active) {
      this.slowMotion.timer -= dt;
      if (this.slowMotion.timer <= 0) this.slowMotion.active = false;
    }

    if (this.screenShake > 0) this.screenShake = Math.max(0, this.screenShake - SCREEN_SHAKE_DECAY * dt);
    if (this.screenShakeCooldown > 0) this.screenShakeCooldown -= dt;
    this.sparkTimers = this.sparkTimers.map((t) => (t > 0 ? t - dt : t));

    for (const flash of this.pickupFlashes) flash.age += dt;
    this.pickupFlashes = this.pickupFlashes.filter((f) => f.age < PICKUP_FLASH_DURATION);
  }

  /** Every 30 s asteroids get 15% faster and spawn a little more often. */
  private updateDifficulty(): void {
    if (this.difficultyTimer >= DIFFICULTY_INCREASE_INTERVAL) {
      this.difficultyTimer = 0;
      this.difficultyLevel += 1;
      this.asteroidSpeedMultiplier += DIFFICULTY_SPEED_INCREMENT;
      this.asteroidSpawnRate = Math.max(
        this.asteroidSpawnRate - DIFFICULTY_SPAWN_RATE_INCREMENT,
        DIFFICULTY_SPAWN_RATE_MIN,
      );
    }
  }

  private updatePlayers(dt: number, inputs: readonly PlayerInput[]): void {
    this.players.forEach((player, index) => {
      const input = inputs[index] ?? NO_INPUT;
      if (player.lives <= 0) {
        // A player who is out does nothing, but a laser / boost key held (or tapped) meanwhile must not fire the moment
        // they are revived: keep the "already used" flags in step with the keys.
        player.laser.keyHeld = !!input.laser;
        player.boost.keyHeld = !!input.boost;
        return;
      }
      player.canShoot = this.startCooldown <= 0;
      const result = updatePlayer(player, input, dt);
      const number = player.playerNumber;

      if (result.shots.length > 0) {
        this.shots.push(...result.shots);
        this.events.push({ type: 'shot_fired', player: number });
      }
      if (result.laser) {
        this.lasers.push(result.laser);
        this.events.push({ type: 'laser_fired', player: number });
      }
      if (result.boostStarted) this.events.push({ type: 'boost_started', player: number });

      if (result.bounce) {
        this.addScreenShake(BOUNDARY_SHAKE_AMOUNT);
        // Pushing against a wall bounces every frame; rate-limit sparks so they do not scale with FPS.
        if ((this.sparkTimers[index] ?? 0) <= 0) {
          this.sparkTimers[index] = BOUNDARY_SPARK_INTERVAL;
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
    });
  }

  /** The stars follow the average movement of the ships still in play (Python `Starfield.update`). */
  private scrollStarfield(dt: number): void {
    const living = this.players.filter((p) => p.lives > 0);
    if (living.length === 0) return;
    const x = living.reduce((sum, p) => sum + p.motion.x, 0) / living.length;
    const y = living.reduce((sum, p) => sum + p.motion.y, 0) / living.length;
    this.starfield.scroll({ x: x * dt, y: y * dt });
  }

  private updateEntities(dt: number): void {
    // New asteroids are updated in the same frame they spawn (this matters for the edge-cull quirk).
    this.asteroids.push(...updateSpawner(this.spawner, dt, this.asteroidSpawnRate, this.rng));

    const newUfo = updateUfoSpawner(
      this.ufoSpawner,
      this.spawner.gameplayTimer,
      this.ufos.length,
      this.rng,
      this.difficultyLevel,
    );
    if (newUfo) {
      this.ufos.push(newUfo);
      this.events.push({ type: 'ufo_spawned', ufoType: newUfo.type });
    }

    for (const shot of this.shots) updateShot(shot, dt);
    for (const shot of this.ufoShots) updateShot(shot, dt);

    // Slow Motion scales asteroid movement only. The death animation still ends after 0.15 real seconds.
    const baseDt = dt * this.asteroidSpeedMultiplier;
    const asteroidDt = this.slowMotion.active ? baseDt * SLOW_MOTION_FACTOR : baseDt;
    const children: Asteroid[] = [];
    for (const asteroid of this.asteroids) {
      children.push(...updateAsteroid(asteroid, asteroidDt, dt, this.rng));
    }
    this.asteroids.push(...children);

    for (const powerup of this.powerups) updatePowerUp(powerup, dt);

    // UFOs run on real time: neither difficulty scaling nor Slow Motion touches them. A shot fired now first moves next frame.
    // Each one aims at whichever living, unprotected ship is nearest to it right now.
    for (const ufo of this.ufos) {
      const shot = updateUfo(ufo, dt, this.targetFor(ufo.position)?.position ?? null, this.rng);
      if (shot) {
        this.ufoShots.push(shot);
        this.events.push({ type: 'ufo_fired', ufoType: ufo.type });
      }
    }
  }

  // --- collisions -----------------------------------------------------------

  private processCollisions(dt: number): void {
    // Same priority as the Python loop: ships vs asteroids, shots vs asteroids, lasers vs asteroids (and UFOs), shots vs
    // UFOs, ships vs UFOs, UFO shots vs ships, pickups, then friendly fire. Each step stops the whole pass if it ended the game.
    // When two things compete for one target the one earlier in the lists (Player 1 before Player 2, older shots first) wins.
    if (!this.collidePlayersWithAsteroids()) return;
    this.collideShotsWithAsteroids();
    this.collideLasersWithTargets(dt);
    this.collideShotsWithUfos();
    if (!this.collidePlayersWithUfos(dt)) return;
    if (!this.collideUfoShotsWithPlayers()) return;
    this.collectPowerUps();
    if (this.players.length > 1 && this.config.friendlyFire) this.collideFriendlyFire();
  }

  /** The living ship nearest to `target` that overlaps it (Player 1 wins a tie), or null. */
  private nearestOverlappingPlayer(target: Circle): PlayerState | null {
    let best: PlayerState | null = null;
    let bestDistance = Infinity;
    for (const p of this.players) {
      if (p.lives <= 0 || !circlesOverlap(p, target)) continue;
      const distance = (p.position.x - target.position.x) ** 2 + (p.position.y - target.position.y) ** 2;
      if (distance < bestDistance) {
        best = p;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** One hit on a ship from `source`. @returns what happened to it, or 'game_over' if that ended the run. */
  private hurt(player: PlayerState, source: HitSource): DamageResult | 'game_over' {
    const result = takeDamage(player);
    if (result !== 'life_lost') return result;
    return this.afterLifeLost(player, source) ? 'life_lost' : 'game_over';
  }

  /**
   * A ship just lost a life: respawn it, or, with none left, either put it out (its teammate plays on) or end the run.
   * In a shared-lives game the pool is every ship's `lives` kept in step, so any loss costs the team one life and the
   * run ends when the pool is empty. @returns false if the run ended.
   */
  private afterLifeLost(player: PlayerState, source: HitSource): boolean {
    if (this.config.livesMode === 'shared') for (const p of this.players) p.lives = player.lives;
    this.events.push({ type: 'player_hit', livesLeft: player.lives, source, player: player.playerNumber });
    if (player.lives > 0) {
      const spawn = this.spawnFor(player);
      respawnPlayer(player, spawn.x, spawn.y);
      return true;
    }

    // Out of lives: the ship stops. (With a shared pool that is every ship, since they all hit zero together.)
    for (const p of this.players) if (p.lives <= 0) eliminatePlayer(p);
    if (this.players.some((p) => p.lives > 0)) {
      this.events.push({ type: 'player_eliminated', player: player.playerNumber });
      return true;
    }
    this.triggerGameOver(this.config.livesMode === 'shared' ? 'shared_lives_exhausted' : 'all_eliminated');
    return false;
  }

  private spawnFor(player: PlayerState): Vec2 {
    return PLAYER_SPAWNS[player.playerNumber - 1] ?? (PLAYER_SPAWNS[0] as Vec2);
  }

  /** @returns false if the game ended during this check. */
  private collidePlayersWithAsteroids(): boolean {
    for (const asteroid of this.asteroids) {
      if (!asteroid.alive || asteroid.dying) continue;
      const player = this.nearestOverlappingPlayer(asteroid);
      if (!player) continue;

      // Boosting rams through: it is checked before any damage logic, so neither a shield nor
      // respawn protection is used up and the ship can never be hurt while a boost is running.
      if (player.boost.active) {
        this.hitAsteroid(asteroid, player);
        continue;
      }

      if (this.hurt(player, 'asteroid') === 'game_over') return false;
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
        this.hitAsteroid(asteroid, this.playerByNumber(shot.owner));
        shot.alive = false;
        break;
      }
    }
    // UFO shots wreck asteroids too. As in Python the kill pays nobody but still counts for the combo and can drop a power-up.
    for (const shot of this.ufoShots) {
      if (!shot.alive) continue;
      for (const asteroid of this.asteroids) {
        if (!asteroid.alive || asteroid.dying) continue;
        if (!circlesOverlap(shot, asteroid)) continue;
        this.hitAsteroid(asteroid, null);
        shot.alive = false;
        break;
      }
    }
  }

  /**
   * Each beam hits every asteroid and UFO it touches exactly once while it lasts, paying its owner. Children spawned
   * into the beam's path before it fades are new objects, so they can be hit too (as in the Python game).
   */
  private collideLasersWithTargets(dt: number): void {
    const remaining: LaserBeam[] = [];
    for (const laser of this.lasers) {
      if (!updateLaser(laser, dt)) continue;
      remaining.push(laser);
      const owner = this.playerByNumber(laser.owner);
      for (const asteroid of this.asteroids) {
        if (!asteroid.alive || asteroid.dying) continue;
        if (laserHits(laser, asteroid)) this.hitAsteroid(asteroid, owner);
      }
      if (this.laserHitsUfos) {
        for (const ufo of this.ufos) {
          if (ufo.alive && laserHits(laser, ufo)) this.destroyUfo(ufo, owner);
        }
      }
    }
    this.lasers = remaining;
  }

  /** A player shot is used up by the first UFO it touches. */
  private collideShotsWithUfos(): void {
    for (const ufo of this.ufos) {
      if (!ufo.alive) continue;
      for (const shot of this.shots) {
        if (!shot.alive || !circlesOverlap(ufo, shot)) continue;
        this.destroyUfo(ufo, this.playerByNumber(shot.owner));
        shot.alive = false;
        break;
      }
    }
  }

  /**
   * Ramming with a boost destroys the UFO and costs the ship nothing (no shield, no life). Otherwise `takeDamage`
   * runs, but the UFO survives the contact, so a shield that absorbed it starts a grace period (`contactGrace`): that
   * ship is not hit again while it stays in that same contact, until it separates or the grace runs out. Each ship has
   * its own grace. @returns false if the game ended.
   */
  private collidePlayersWithUfos(dt: number): boolean {
    for (const ufo of this.ufos) {
      for (const player of this.players) {
        if (!ufo.alive) break;
        const slot = player.playerNumber - 1;
        if (player.lives <= 0 || !circlesOverlap(player, ufo)) {
          ufo.contactGrace[slot] = 0;
          continue;
        }
        if (player.boost.active) {
          this.destroyUfo(ufo, player);
          continue;
        }
        const grace = ufo.contactGrace[slot] ?? 0;
        if (grace > 0) {
          ufo.contactGrace[slot] = grace - dt;
          continue;
        }
        const result = this.hurt(player, 'ufo');
        if (result === 'game_over') return false;
        if (result === 'shield') ufo.contactGrace[slot] = UFO_SHIELD_CONTACT_GRACE;
      }
    }
    return true;
  }

  /**
   * UFO shots hurt a boosting ship too (the boost only protects against ramming). Every shot that connects is used up,
   * by the nearest ship if it touches both (Python hit both; one projectile is one hit here).
   */
  private collideUfoShotsWithPlayers(): boolean {
    for (const shot of this.ufoShots) {
      if (!shot.alive) continue;
      const player = this.nearestOverlappingPlayer(shot);
      if (!player) continue;
      shot.alive = false;
      if (this.hurt(player, 'ufo_shot') === 'game_over') return false;
    }
    return true;
  }

  private collectPowerUps(): void {
    for (const powerup of this.powerups) {
      if (!powerup.alive) continue;
      // Player 1 gets first claim on a pickup that overlaps both ships.
      const collector = this.players.find((p) => p.lives > 0 && circlesOverlap(p, powerup));
      if (!collector) continue;
      powerup.alive = false;
      this.applyPowerUp(powerup.type, collector);
      this.pickupFlashes.push({ position: { ...powerup.position }, type: powerup.type, age: 0 });
      this.events.push({ type: 'powerup_collected', powerType: powerup.type, player: collector.playerNumber });
    }
  }

  private applyPowerUp(type: PowerUpType, player: PlayerState): void {
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
        this.reviveTeammate(player);
        break;
    }
  }

  /**
   * Python `handle_powerup_collection`: the collector brings back a teammate who is out of lives with `REVIVE_LIVES`
   * lives, at that player's spawn point with the usual 2 s of protection, all power-ups cleared and score kept. With
   * nobody to revive (one player, shared lives, teammate alive) the pickup is simply consumed.
   */
  private reviveTeammate(collector: PlayerState): void {
    if (this.config.livesMode !== 'independent') return;
    const downed = this.players.find((p) => p !== collector && p.lives <= 0);
    if (!downed) return;
    downed.lives = REVIVE_LIVES;
    const spawn = this.spawnFor(downed);
    respawnPlayer(downed, spawn.x, spawn.y);
    this.pickupFlashes.push({ position: { ...spawn }, type: 'revive', age: 0 });
    this.events.push({ type: 'player_revived', player: downed.playerNumber, by: collector.playerNumber });
  }

  /**
   * Python's friendly fire: a player's shot or Laser Beam hurts the *other* ship (never its owner), with the same
   * shield / respawn-protection rules as any hit, and a shot that connects is used up. A beam hurts a given ship at most
   * once. There is no ship-versus-ship collision and a boost does not hurt the other ship. @returns false if the game ended.
   */
  private collideFriendlyFire(): boolean {
    for (const shot of this.shots) {
      if (!shot.alive) continue;
      for (const player of this.players) {
        if (player.playerNumber === shot.owner || player.lives <= 0 || !circlesOverlap(player, shot)) continue;
        shot.alive = false;
        if (this.hurt(player, 'friendly_shot') === 'game_over') return false;
        break;
      }
    }
    for (const laser of this.lasers) {
      for (const player of this.players) {
        if (player.playerNumber === laser.owner || player.lives <= 0) continue;
        if (laserHits(laser, player) && this.hurt(player, 'friendly_laser') === 'game_over') return false;
      }
    }
    return true;
  }

  /**
   * One hit on an asteroid from a shot, laser or boost ram. Armored asteroids absorb the first hit
   * (flash + sparks, no points); a kill scores, starts the death animation and may drop a power-up.
   * `scorer` is the player credited (null for UFO shots, which pay nobody).
   */
  private hitAsteroid(asteroid: Asteroid, scorer: PlayerState | null, blasts?: VolatileBlast[], depth = 0): void {
    // Keep the guard at the damage/score boundary as well as in collision callers.
    if (!asteroid.alive || asteroid.dying) return;
    const result = takeHit(asteroid);
    if (!result.destroyed) {
      this.applyEffect(result.effect, 1);
      if (result.effect) this.events.push({ type: 'asteroid_hit', position: { ...asteroid.position } });
      return;
    }

    // A kill: advance the combo first, then pay at the new multiplier. The combo is the team's; the points go to `scorer` alone.
    const credit = registerKill(this.combo);
    const points = scorer ? scaledPoints(getPoints(asteroid), credit.multiplier) : 0;
    if (scorer) scorer.score += points;
    const drop = maybeSpawnPowerUp(asteroid.position.x, asteroid.position.y, this.rng, this.reviveEligible);
    const effect = beginDeath(asteroid);
    if (asteroid.archetype !== 'volatile') this.applyEffect(effect, 1);
    this.events.push({
      type: 'asteroid_destroyed',
      radius: asteroid.radius,
      points,
      combo: credit.count,
      multiplier: credit.multiplier,
      ...(asteroid.archetype === 'volatile' ? { volatile: true } : {}),
      ...(scorer ? { player: scorer.playerNumber } : {}),
    });

    if (credit.milestone) {
      this.streakBanner = createBanner(credit.milestone);
      this.events.push({ type: 'kill_streak', kills: credit.milestone.kills, name: credit.milestone.name, color: credit.milestone.color });
    }
    if (drop) {
      this.powerups.push(drop);
      this.events.push({ type: 'powerup_dropped', powerType: drop.type });
    }
    this.detonateVolatile(asteroid, scorer, blasts, depth);
  }

  /**
   * A UFO dies: flat points (200 / 500, never multiplied), no combo or kill-streak progress, a burst, a screen shake
   * and one guaranteed ordinary power-up (never MEGA POWER; a Revive instead when one is needed). Callers check
   * `ufo.alive` first, which is what stops a UFO being destroyed, paid or dropped for twice.
   */
  private destroyUfo(ufo: Ufo, scorer: PlayerState): void {
    ufo.alive = false;
    const points = UFO_STATS[ufo.type].points;
    scorer.score += points;
    this.addScreenShake(UFO_DESTROY_SHAKE);
    emitBurst(this.particles, ufo.position.x, ufo.position.y, UFO_DESTROY_PARTICLES, this.rng);
    const drop = createPowerUp(ufo.position.x, ufo.position.y, chooseOrdinaryDrop(this.rng, this.reviveEligible), this.rng);
    this.powerups.push(drop);
    this.events.push({
      type: 'ufo_destroyed',
      ufoType: ufo.type,
      points,
      radius: ufo.radius,
      position: { ...ufo.position },
      player: scorer.playerNumber,
    });
    this.events.push({ type: 'powerup_dropped', powerType: drop.type });
  }

  private destroyWithoutScore(asteroid: Asteroid, shakeScale: number): void {
    if (!asteroid.alive || asteroid.dying) return;
    const effect = beginDeath(asteroid);
    const volatile = asteroid.archetype === 'volatile';
    if (!volatile) this.applyEffect(effect, shakeScale);
    if (effect) this.events.push({ type: 'asteroid_destroyed', radius: asteroid.radius, points: 0, ...(volatile ? { volatile: true } : {}) });
    this.detonateVolatile(asteroid, null);
  }

  /**
   * Breadth-first, synchronous damage in stable asteroid-list order. A nested kill only appends to the queue.
   * beginDeath has already marked each source dying, so it can be queued once and cannot be paid again.
   * Children appear after the usual death delay, outside this snapshot and this blast's lifetime.
   */
  private detonateVolatile(asteroid: Asteroid, scorer: PlayerState | null, pending?: VolatileBlast[], depth = 0): void {
    if (asteroid.archetype !== 'volatile') return;
    const blasts = pending ?? [];
    blasts.push({ position: { ...asteroid.position }, scorer, depth });
    if (pending) return;

    const targets = this.asteroids.slice();
    for (let i = 0; i < blasts.length; i++) {
      const blast = blasts[i]!;
      const radius = VOLATILE_EXPLOSION_RADIUS;
      this.volatileFlashes.push({ position: { ...blast.position }, radius, depth: blast.depth, age: -Math.min(blast.depth, 4) * 0.025 });
      if (this.volatileFlashes.length > VOLATILE_FLASH_LIMIT) this.volatileFlashes.shift();
      this.events.push({ type: 'volatile_exploded', position: { ...blast.position }, radius, depth: blast.depth });
      this.addScreenShake(VOLATILE_EXPLOSION_SHAKE);
      // Visit each original target once per blast. Distinct blasts may each strip one armor hit.
      for (const target of targets) {
        if (!target.alive || target.dying || !circlesOverlap({ position: blast.position, radius }, target)) continue;
        this.hitAsteroid(target, blast.scorer, blasts, blast.depth + 1);
      }
    }
  }

  private updateVolatileFlashes(dt: number): void {
    for (const flash of this.volatileFlashes) flash.age += dt;
    this.volatileFlashes = this.volatileFlashes.filter((flash) => flash.age < VOLATILE_FLASH_DURATION);
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

  private triggerGameOver(reason: GameOverReason): void {
    this.phase = 'gameOver';
    this.gameOverReason = reason;
    this.retryDelay = GAME_OVER_RETRY_DELAY;
    this.lasers = [];
    this.streakBanner = null;
    this.events.push({ type: 'game_over', score: this.totalScore, scores: this.players.map((p) => p.score), reason });
  }
}
