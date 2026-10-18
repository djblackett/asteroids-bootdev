/**
 * Gameplay constants, ported 1:1 from the Python game's constants.py.
 * Values for features that are not implemented yet are deliberately omitted.
 */

export const SCREEN_WIDTH = 1280;
export const SCREEN_HEIGHT = 720;

/** The Pygame original ran at a nominal 60 FPS; per-frame constants are normalised against this. */
export const REFERENCE_FPS = 60;

// --- Asteroids -------------------------------------------------------------
export const ASTEROID_MIN_RADIUS = 20;
export const ASTEROID_KINDS = 3;
export const ASTEROID_MAX_RADIUS = ASTEROID_MIN_RADIUS * ASTEROID_KINDS;
export const ASTEROID_SPAWN_RATE = 0.5; // seconds between spawn attempts

export type AsteroidArchetype = 'standard' | 'armored' | 'volatile';

export interface ArchetypeConfig {
  hitPoints: number;
  pointsMultiplier: number;
  pointsBonus: number;
  color: number;
  outlineWidth: number;
}

export const ASTEROID_ARCHETYPES: Record<AsteroidArchetype, ArchetypeConfig> = {
  standard: { hitPoints: 1, pointsMultiplier: 1.0, pointsBonus: 0, color: 0xffffff, outlineWidth: 2 },
  armored: { hitPoints: 2, pointsMultiplier: 1.5, pointsBonus: 10, color: 0xaadcff, outlineWidth: 3 },
  volatile: { hitPoints: 1, pointsMultiplier: 1.75, pointsBonus: 20, color: 0xffb45a, outlineWidth: 2 },
};

/** Seconds of play before each archetype can spawn (continuous mode). */
export const ASTEROID_ARCHETYPE_TIME_UNLOCKS: Record<AsteroidArchetype, number> = {
  standard: 0,
  armored: 45,
  volatile: 120,
};

/** Volatile has weight 0 in the original, so it never spawns. */
export const ASTEROID_ARCHETYPE_SPAWN_WEIGHTS: Record<AsteroidArchetype, number> = {
  standard: 1.0,
  armored: 0.35,
  volatile: 0.0,
};

export const ASTEROID_ARMORED_HIT_FLASH_DURATION = 0.12;
export const ASTEROID_ARMORED_HIT_PARTICLES = 4;
export const ASTEROID_ARMORED_HIT_SHAKE = 1;
export const ASTEROID_DEATH_DURATION = 0.15;
export const ASTEROID_DEATH_DURATION_MAX = 0.15;
export const ASTEROID_SHAKE_INTENSITY = 3;

export const POINTS_LARGE_ASTEROID = 10;
export const POINTS_MEDIUM_ASTEROID = 20;
export const POINTS_SMALL_ASTEROID = 50;

// --- Player ----------------------------------------------------------------
export const PLAYER_RADIUS = 20;
export const PLAYER_TURN_SPEED = 300; // degrees per second
export const PLAYER_SPEED = 300; // pixels per second
export const PLAYER_LIVES = 3;
export const PLAYER_RESPAWN_INVULNERABILITY = 2.0; // seconds
export const GAME_START_COOLDOWN = 0.2; // seconds before the first shot is allowed

/** Respawn point after losing a life (Python P1_SPAWN). */
export const PLAYER_RESPAWN_X = SCREEN_WIDTH * 0.25;
export const PLAYER_RESPAWN_Y = Math.floor(SCREEN_HEIGHT / 2);
/** Initial point in single-player mode. */
export const PLAYER_START_X = Math.floor(SCREEN_WIDTH / 2);
export const PLAYER_START_Y = Math.floor(SCREEN_HEIGHT / 2);

// --- Shooting --------------------------------------------------------------
export const SHOT_RADIUS = 5;
export const PLAYER_SHOOT_SPEED = 500; // pixels per second
export const PLAYER_SHOOT_COOLDOWN = 0.3; // seconds
/** Shots further than this outside the playfield are despawned (the Python original never culls). */
export const SHOT_CULL_MARGIN = 50;

// --- Boundary bounce -------------------------------------------------------
export const BOUNDARY_BOUNCE_FORCE = 150; // px/s
/** Python: `velocity *= 0.85` every frame at 60 FPS. */
export const BOUNCE_DAMPING_PER_FRAME = 0.85;
/** Below this speed (px/s) the residual bounce velocity is snapped to zero. */
export const BOUNCE_STOP_SPEED = 0.05;
export const BOUNDARY_PARTICLE_COUNT = 6;
export const BOUNDARY_SHAKE_AMOUNT = 4;
/** Minimum seconds between spark bursts while the ship is pushed against a wall. */
export const BOUNDARY_SPARK_INTERVAL = 1 / 60;

// --- Screen shake ----------------------------------------------------------
export const SCREEN_SHAKE_LARGE = 8;
export const SCREEN_SHAKE_MEDIUM = 5;
export const SCREEN_SHAKE_SMALL = 2;
export const SCREEN_SHAKE_DECAY = 20.0; // per second
export const SCREEN_SHAKE_MAX = 12;
export const SCREEN_SHAKE_COOLDOWN = 0.1; // seconds

// --- Particles -------------------------------------------------------------
export const PARTICLE_COUNT_LARGE = 12;
export const PARTICLE_COUNT_MEDIUM = 8;
export const PARTICLE_COUNT_SMALL = 5;
export const PARTICLE_SPEED = 100; // px/s
export const PARTICLE_MAX = 500;
/** Python: `velocity *= 0.95` every frame at 60 FPS. */
export const PARTICLE_DAMPING_PER_FRAME = 0.95;
export const EXHAUST_PARTICLE_SPAWN_RATE = 0.05; // seconds
export const EXHAUST_PARTICLE_SPEED = 80;
export const EXHAUST_PARTICLE_SPREAD = 20; // degrees

// --- Difficulty (continuous mode) -----------------------------------------
export const DIFFICULTY_INCREASE_INTERVAL = 30.0;
export const DIFFICULTY_SPEED_INCREMENT = 0.15;
export const DIFFICULTY_SPAWN_RATE_INCREMENT = 0.05;
export const DIFFICULTY_SPAWN_RATE_MIN = 0.2;

// --- Game over -------------------------------------------------------------
export const GAME_OVER_RETRY_DELAY = 1.5; // seconds

// --- Starfield -------------------------------------------------------------
export const STARFIELD_STAR_COUNT = 200;
/**
 * Camera offset gained per pixel the ship actually travels. The Python value (0.05 per *frame*,
 * fed by a velocity that is zero during normal flight) never produced sensible parallax; with
 * 1.0 the nearest layer drifts at 0.5x ship speed.
 */
export const STARFIELD_PARALLAX_STRENGTH = 1.0;
export const STARFIELD_PARALLAX_FACTORS = [0.1, 0.3, 0.5] as const;

// --- Simulation stepping ---------------------------------------------------
/** Real frames longer than this (tab stalls, debugger pauses) are clamped. */
export const MAX_FRAME_DT = 0.1;
/** Frames longer than this are subdivided so fast shots cannot tunnel through small asteroids. */
export const MAX_SUBSTEP_DT = 1 / 30;
