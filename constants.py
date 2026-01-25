SCREEN_WIDTH = 1280
SCREEN_HEIGHT = 720

ASTEROID_MIN_RADIUS = 20
ASTEROID_KINDS = 3
ASTEROID_SPAWN_RATE = 0.5  # seconds - faster initial spawn rate
ASTEROID_MAX_RADIUS = ASTEROID_MIN_RADIUS * ASTEROID_KINDS

PLAYER_RADIUS = 20

PLAYER_TURN_SPEED = 300

PLAYER_SPEED = 300  # pixels per second

SHOT_RADIUS = 5
PLAYER_SHOOT_SPEED = 500  # pixels per second
PLAYER_SHOOT_COOLDOWN = 0.3  # seconds

# Power-up constants
POWERUP_SPAWN_ENABLED = True  # Set to False to disable power-up spawning entirely
# 8% chance to spawn when asteroid destroyed (reduced from 15%)
POWERUP_SPAWN_CHANCE = 0.08
# 1.5% chance to spawn MEGA POWER (reduced from 3%)
MEGA_POWER_SPAWN_CHANCE = 0.015

# Rapid Fire
RAPID_FIRE_DURATION = 5.0  # seconds
RAPID_FIRE_COOLDOWN = 0.1  # seconds (much faster than normal 0.3)

# Multi-shot
MULTI_SHOT_DURATION = 8.0  # seconds
MULTI_SHOT_ANGLE_SPREAD = 15  # degrees between bullets

# Slow Motion
SLOW_MOTION_DURATION = 6.0  # seconds
SLOW_MOTION_FACTOR = 0.4  # asteroids move at 40% speed

# Shield - one hit protection (no duration, just absorbs one hit)

# MEGA POWER - activates ALL power-ups at once!
MEGA_POWER_DURATION = 6.0  # seconds (reduced from 10.0)
MEGA_POWER_MUSIC_SPEED = 1.26  # Pitch shift up 4 semitones (2^(4/12))
# Toggle for music speed-up feature during MEGA POWER
MEGA_POWER_MUSIC_SPEEDUP_ENABLED = False
# Toggle for background music (disable for debugging when you already have music playing)
BACKGROUND_MUSIC_ENABLED = True

# Scoring system
POINTS_LARGE_ASTEROID = 10  # 60 radius
POINTS_MEDIUM_ASTEROID = 20  # 40 radius
POINTS_SMALL_ASTEROID = 50  # 20 radius

# Combo system
COMBO_TIMEOUT = 3.0  # seconds - time before combo resets
COMBO_MULTIPLIERS = {
    1: 1.0,   # No bonus
    2: 1.5,   # 1.5x points
    3: 2.0,   # 2x points
    4: 2.5,   # 2.5x points
    5: 3.0,   # 3x points and higher
}

# Kill streak notifications
KILL_STREAK_ENABLED = True  # Set to True to enable kill streak notifications
KILL_STREAK_MILESTONES = {
    15: {"name": "KILLING SPREE!", "color": (255, 200, 50)},
    30: {"name": "RAMPAGE!", "color": (255, 150, 0)},
    50: {"name": "DOMINATING!", "color": (255, 100, 255)},
    75: {"name": "UNSTOPPABLE!", "color": (255, 50, 50)},
    100: {"name": "GODLIKE!", "color": (255, 0, 0)},
    150: {"name": "LEGENDARY!", "color": (255, 215, 0)},
    200: {"name": "BEYOND LEGENDARY!", "color": (0, 255, 255)},
}
KILL_STREAK_NOTIFICATION_DURATION = 2.5  # seconds to display notification

# Screen shake and effects
SCREEN_SHAKE_LARGE = 8  # pixels for large asteroids
SCREEN_SHAKE_MEDIUM = 5  # pixels for medium asteroids
SCREEN_SHAKE_SMALL = 2  # pixels for small asteroids
SCREEN_SHAKE_DECAY = 20.0  # how fast shake decays per second
SCREEN_SHAKE_MAX = 12  # maximum screen shake (prevents stacking too high)
# minimum seconds between shake additions (prevents rapid stacking)
SCREEN_SHAKE_COOLDOWN = 0.1

# Asteroid death animation
ASTEROID_DEATH_DURATION = 0.15  # seconds
# maximum seconds (real-world time, not affected by game speed)
ASTEROID_DEATH_DURATION_MAX = 0.15
ASTEROID_SHAKE_INTENSITY = 3  # pixels to shake while dying

# Particle effects
PARTICLE_COUNT_LARGE = 12  # particles for large asteroids
PARTICLE_COUNT_MEDIUM = 8  # particles for medium asteroids
PARTICLE_COUNT_SMALL = 5  # particles for small asteroids
PARTICLE_LIFETIME = 0.5  # seconds
PARTICLE_SPEED = 100  # pixels per second

# Boundary bounce effects
BOUNDARY_BOUNCE_FORCE = 150  # Bounce-back speed when hitting walls
BOUNDARY_PARTICLE_COUNT = 6  # Number of particles spawned on wall collision
BOUNDARY_SHAKE_AMOUNT = 4  # Screen shake intensity for wall hits

# Exhaust particle effects
EXHAUST_PARTICLE_SPAWN_RATE = 0.05  # seconds between exhaust particles
# pixels per second (slower than regular particles)
EXHAUST_PARTICLE_SPEED = 80
EXHAUST_PARTICLE_LIFETIME = 0.3  # seconds (shorter lifetime for trail effect)
EXHAUST_PARTICLE_SPREAD = 20  # degrees of angular spread

# Death taunt messages
DEATH_TAUNTS = [
    "You suck",
    "git gud",
    "skill issue",
    "Try again, noob",
    "Is this your first time?",
    "My grandma plays better",
    "Press F to pay respects",
    "Maybe gaming isn't for you",
    "Oof",
    "rekt",
    "yikes...",
    "even the asteroids are laughing",
    # "controllers are on sale",
    "Have you tried the tutorial?",
    "Try again when you're sober",
    # "Suck my fat one"
]

# Death taunt animation
TAUNT_DURATION = 2.5  # seconds the taunt stays on screen
TAUNT_FADE_IN = 0.3  # seconds to fade in
TAUNT_FADE_OUT = 0.5  # seconds to fade out

# Laser Beam
LASER_BEAM_MAX_SHOTS = 15  # Maximum number of laser beams available
LASER_BEAM_COOLDOWN = 1.0  # Cooldown between laser shots in seconds

# Boost
BOOST_DURATION = 3.0  # seconds the boost lasts
BOOST_SPEED_MULTIPLIER = 2.5  # Speed multiplier during boost
BOOST_COOLDOWN = 8.0  # seconds before boost can be used again

# Progressive Difficulty
DIFFICULTY_INCREASE_INTERVAL = 30.0  # seconds between difficulty increases
# Speed multiplier increase per interval (15%)
DIFFICULTY_SPEED_INCREMENT = 0.15
# Spawn rate increase - reduces time between spawns (more asteroids over time)
# reduces spawn delay by 0.05s each interval
DIFFICULTY_SPAWN_RATE_INCREMENT = 0.05
# minimum spawn delay (cap at 5 asteroids per second)
DIFFICULTY_SPAWN_RATE_MIN = 0.2

# Starfield Background
STARFIELD_ENABLED = True  # Set to False to disable starfield
STARFIELD_STAR_COUNT = 200  # Total number of stars across all layers
# How much stars move based on player velocity (0.0 - 1.0)
STARFIELD_PARALLAX_STRENGTH = 0.05

# Friendly Fire
FRIENDLY_FIRE_ENABLED = True  # Set to False to disable shooting other players

# Co-op System
SHARED_LIVES_ENABLED = False  # Set to True for shared life pool between players
SHARED_LIVES_POOL = 6  # Total lives shared between both players when enabled
REVIVE_SYSTEM_ENABLED = True  # Set to True to enable revive power-ups
REVIVE_SPAWN_CHANCE = 0.3  # 30% chance to spawn revive when a player dies
REVIVE_DURATION = 15.0  # seconds before revive power-up despawns
REVIVE_BLINK_SPEED = 3.0  # blinks per second when about to expire

# Wave System
# Set to True to enable wave-based spawning instead of continuous
WAVE_SYSTEM_ENABLED = False
# Base number of asteroids in wave 1 (doubled for more chaos)
WAVE_BASE_ASTEROIDS = 10
# How many more asteroids per wave (faster ramp-up)
WAVE_ASTEROID_INCREMENT = 3
# seconds of breathing room between waves (much shorter)
WAVE_BREAK_DURATION = 1.5
# seconds between spawning each asteroid in a wave (rapid fire!)
WAVE_SPAWN_DELAY = 0.1
# Maximum seconds for a wave before forcing next wave (keep it moving!)
WAVE_MAX_DURATION = 25.0

# UFO System
UFO_ENABLED = True  # Set to False to disable UFO spawning entirely
UFO_SPAWN_WAVE_START = 2  # UFOs start spawning from this wave onwards
UFO_SPAWN_CHANCE = 0.5  # 50% chance to spawn a UFO during a wave
UFO_MAX_ACTIVE = 2  # Maximum number of UFOs on screen at once

# Large UFO
UFO_LARGE_RADIUS = 30  # pixels
UFO_LARGE_SPEED = 100  # pixels per second (slow, predictable)
UFO_LARGE_SHOOT_COOLDOWN = 2.0  # seconds between shots (shoots randomly)
UFO_LARGE_SHOOT_ACCURACY = 0.0  # 0 = random direction, 1 = perfect aim at player
UFO_LARGE_POINTS = 200  # points awarded for destroying

# Small UFO
UFO_SMALL_RADIUS = 20  # pixels
UFO_SMALL_SPEED = 180  # pixels per second (faster, more aggressive)
UFO_SMALL_SHOOT_COOLDOWN = 1.5  # seconds between shots
# 70% accuracy aiming at player (with some randomness)
UFO_SMALL_SHOOT_ACCURACY = 0.7
UFO_SMALL_POINTS = 500  # points awarded for destroying (high value target!)
UFO_SMALL_WAVE_START = 5  # Small UFOs start appearing from wave 5 onwards

# UFO Shot
UFO_SHOT_SPEED = 350  # pixels per second
UFO_SHOT_RADIUS = 6  # slightly larger than player shots

# UFO Spawn Timing (Wave Mode)
UFO_SPAWN_MIN_DELAY = 8.0  # minimum seconds into wave before UFO can spawn
UFO_SPAWN_MAX_DELAY = 15.0  # maximum seconds into wave before UFO spawns

# UFO Spawn Timing (Continuous Mode)
UFO_CONTINUOUS_SPAWN_TIME = 5.0  # seconds into gameplay before first UFO spawns
UFO_CONTINUOUS_RESPAWN_TIME = 15.0  # seconds between UFO spawns after the first

# Debug Mode - Skip config/start screens for instant gameplay testing
# Set to True to immediately start the game with default settings
GAMEPLAY_DEBUG = False
