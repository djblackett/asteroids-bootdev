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
/** Two players start on, and respawn at, their own spawn points (Python P1_SPAWN / P2_SPAWN); index = player number - 1. */
export const PLAYER_SPAWNS: ReadonlyArray<{ readonly x: number; readonly y: number }> = [
  { x: SCREEN_WIDTH * 0.25, y: Math.floor(SCREEN_HEIGHT / 2) },
  { x: SCREEN_WIDTH * 0.75, y: Math.floor(SCREEN_HEIGHT / 2) },
];

// --- Two-player co-op ---------------------------------------------------------
/** Shared-lives pool for the whole team (Python `SHARED_LIVES_POOL`). */
export const SHARED_LIVES_POOL = 6;
/** Friendly fire default in the menu (Python `FRIENDLY_FIRE_ENABLED`). */
export const FRIENDLY_FIRE_DEFAULT = true;
/** Lives a revived player comes back with (Python hard-codes 3). */
export const REVIVE_LIVES = 3;
/**
 * Python defines `REVIVE_SPAWN_CHANCE` = 0.3 ("30 % chance to spawn revive when a player dies") but never uses it, so no
 * Revive ever appeared. Here it is the share of power-up drops (an asteroid's 8 % roll and the guaranteed UFO drop) that
 * turn into a Revive while a player is out of lives and their teammate is still alive and no Revive is already on the field.
 */
export const REVIVE_SPAWN_CHANCE = 0.3;
/** Menu choices for a player's movement speed (Python `speed_options`); the multiplier only scales forward / backward speed. */
export const SPEED_OPTIONS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

// --- Shooting --------------------------------------------------------------
export const SHOT_RADIUS = 5;
export const PLAYER_SHOOT_SPEED = 500; // pixels per second
export const PLAYER_SHOOT_COOLDOWN = 0.3; // seconds
/** Shots further than this outside the playfield are despawned (the Python original never culls). */
export const SHOT_CULL_MARGIN = 50;

// --- Power-ups -------------------------------------------------------------
export const POWERUP_RADIUS = 15;
export const POWERUP_LIFETIME = 12.0; // seconds before an uncollected pickup disappears
export const REVIVE_LIFETIME = 15.0;
export const POWERUP_SPEED = 30; // px/s drift
/** Chance that a destroyed asteroid drops one of the four ordinary power-ups. */
export const POWERUP_SPAWN_CHANCE = 0.08;
/** Checked first; a successful roll drops MEGA POWER instead. */
export const MEGA_POWER_SPAWN_CHANCE = 0.015;

export const RAPID_FIRE_DURATION = 5.0;
export const RAPID_FIRE_COOLDOWN = 0.1; // shot cooldown while active (normally 0.3)
export const MULTI_SHOT_DURATION = 8.0;
export const MULTI_SHOT_ANGLE_SPREAD = 15; // degrees either side of the heading
export const SLOW_MOTION_DURATION = 6.0;
export const SLOW_MOTION_FACTOR = 0.4; // asteroids only
export const MEGA_POWER_DURATION = 6.0;

// --- Combo and kill streaks -------------------------------------------------
/** Seconds after a kill before the combo drops back to zero; every kill restarts the window. */
export const COMBO_TIMEOUT = 3.0;
/** Score multiplier by kills in the current combo. Python: `COMBO_MULTIPLIERS.get(count, COMBO_MULTIPLIERS[5])`. */
export const COMBO_MULTIPLIERS: Readonly<Record<number, number>> = { 1: 1.0, 2: 1.5, 3: 2.0, 4: 2.5, 5: 3.0 };

export interface KillStreakMilestone {
  kills: number;
  name: string;
  color: number;
}
/** Banner shown the moment the combo count reaches `kills`. Ascending order. */
export const KILL_STREAK_MILESTONES: readonly KillStreakMilestone[] = [
  { kills: 15, name: 'KILLING SPREE!', color: 0xffc832 },
  { kills: 30, name: 'RAMPAGE!', color: 0xff9600 },
  { kills: 50, name: 'DOMINATING!', color: 0xff64ff },
  { kills: 75, name: 'UNSTOPPABLE!', color: 0xff3232 },
  { kills: 100, name: 'GODLIKE!', color: 0xff0000 },
  { kills: 150, name: 'LEGENDARY!', color: 0xffd700 },
  { kills: 200, name: 'BEYOND LEGENDARY!', color: 0x00ffff },
];
export const KILL_STREAK_NOTIFICATION_DURATION = 2.5; // seconds

// --- UFOs ------------------------------------------------------------------
export const UFO_ENABLED = true;
export const UFO_MAX_ACTIVE = 2;

export const UFO_LARGE_RADIUS = 30;
export const UFO_LARGE_SPEED = 100; // px/s
export const UFO_LARGE_SHOOT_COOLDOWN = 2.0;
/** 0 = random direction, 1 = perfect aim: the shot may stray up to `180 * (1 - accuracy)` degrees either way. */
export const UFO_LARGE_SHOOT_ACCURACY = 0.0;
export const UFO_LARGE_POINTS = 200;

export const UFO_SMALL_RADIUS = 20;
export const UFO_SMALL_SPEED = 180;
export const UFO_SMALL_SHOOT_COOLDOWN = 1.5;
export const UFO_SMALL_SHOOT_ACCURACY = 0.7; // = at most 54 degrees off the line to the ship
export const UFO_SMALL_POINTS = 500;

export const UFO_SHOT_SPEED = 350;
export const UFO_SHOT_RADIUS = 6;

/** A UFO picks a new heading every 2-4 s and eases its velocity towards it. */
export const UFO_DIRECTION_CHANGE_MIN = 2.0;
export const UFO_DIRECTION_CHANGE_MAX = 4.0;
/** Python: `velocity.lerp(target, min(1, dt * 2))`; here the continuous form `1 - exp(-2 dt)`, which is frame-rate independent. */
export const UFO_VELOCITY_EASE_RATE = 2.0;
/** Small UFOs fly straight across the screen horizontally 40 % of the time. */
export const UFO_SMALL_HORIZONTAL_CHANCE = 0.4;
/** First shot comes after a random delay in this range. */
export const UFO_FIRST_SHOT_MIN = 0.5;
export const UFO_FIRST_SHOT_MAX = 1.5;
export const UFO_BLINK_INTERVAL = 0.3;

/** Continuous mode: first UFO after 5 s of play, then one attempt every 15 s. */
export const UFO_CONTINUOUS_SPAWN_TIME = 5.0;
export const UFO_CONTINUOUS_RESPAWN_TIME = 15.0;
/** Spawn point along the chosen edge, as a fraction of its length. */
export const UFO_SPAWN_EDGE_MIN = 0.2;
export const UFO_SPAWN_EDGE_MAX = 0.8;
/** Wave mode (not implemented yet): from this wave on, 40 % of spawns are small UFOs. */
export const UFO_SMALL_WAVE_START = 5;
export const UFO_SMALL_SPAWN_CHANCE = 0.4;

/**
 * Continuous mode: when small UFOs enter the schedule. Python picks the type from the *wave* number, which only wave mode
 * ever advances, so in continuous mode small UFOs never appeared. Here the existing difficulty progression is reused
 * instead: `GameSim.difficultyLevel` goes up by one every `DIFFICULTY_INCREASE_INTERVAL` (30 s) and is what makes the
 * asteroids faster. Each row is "from this difficulty level on, a UFO spawn is small with this probability" (the highest
 * row reached wins; before the first row every spawn is a large UFO and no random number is drawn).
 *
 *   level 4  (2:00)  20 %  - the odd small UFO
 *   level 8  (4:00)  40 %  - the rate Python uses from wave 5
 *   level 12 (6:00)  60 %  - small UFOs are now the more likely spawn
 *
 * Spawn timing (first at 5 s, then every 15 s) and the maximum of 2 UFOs are unchanged. Set the table to `[]` to restore
 * the original "large only" behaviour.
 */
export const UFO_SMALL_PROGRESSION: ReadonlyArray<{ readonly level: number; readonly chance: number }> = [
  { level: 4, chance: 0.2 },
  { level: 8, chance: 0.4 },
  { level: 12, chance: 0.6 },
];

/**
 * A shield (or a life) lost to a UFO *body* only protects against that contact once: while the ship stays inside the same
 * UFO it takes no second hit for up to this long. Separating ends the grace at once, so a fresh collision is a new hit, and
 * after the grace has run out the normal rules apply again (a shield never gives lasting immunity).
 */
export const UFO_SHIELD_CONTACT_GRACE = 1.0;

export const UFO_DESTROY_SHAKE = 6;
export const UFO_DESTROY_PARTICLES = 10;

/**
 * Python's `handle_laser_asteroid_collisions` only looks at asteroids, so its Laser Beam passes straight through UFOs.
 * That is an oversight we deliberately fixed: the beam kills every UFO it touches (once per beam: flat points, one
 * guaranteed power-up). Set to false to restore the original pass-through.
 */
export const LASER_HITS_UFOS = true;

// --- Laser beam ------------------------------------------------------------
export const LASER_BEAM_MAX_SHOTS = 15;
export const LASER_BEAM_COOLDOWN = 1.0;
export const LASER_BEAM_LIFETIME = 0.3;
export const LASER_BEAM_WIDTH = 3;

// --- Boost -----------------------------------------------------------------
export const BOOST_DURATION = 3.0;
export const BOOST_SPEED_MULTIPLIER = 2.5;
/** Starts counting when the boost starts, so it is already 3 s in when the boost ends. */
export const BOOST_COOLDOWN = 8.0;
export const BOOST_WARNING_TIME = 1.0; // seconds before expiry that the warning ring pulses

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
