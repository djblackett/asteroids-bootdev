SCREEN_WIDTH = 1280
SCREEN_HEIGHT = 720

ASTEROID_MIN_RADIUS = 20
ASTEROID_KINDS = 3
ASTEROID_SPAWN_RATE = 0.8  # seconds
ASTEROID_MAX_RADIUS = ASTEROID_MIN_RADIUS * ASTEROID_KINDS

PLAYER_RADIUS = 20

PLAYER_TURN_SPEED = 300

PLAYER_SPEED = 200  # pixels per second

SHOT_RADIUS = 5
PLAYER_SHOOT_SPEED = 500  # pixels per second
PLAYER_SHOOT_COOLDOWN = 0.3  # seconds

# Power-up constants
POWERUP_SPAWN_CHANCE = 0.15  # 15% chance to spawn when asteroid destroyed
MEGA_POWER_SPAWN_CHANCE = 0.03  # 3% chance to spawn MEGA POWER (much rarer!)

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
MEGA_POWER_DURATION = 10.0  # seconds
MEGA_POWER_MUSIC_SPEED = 1.26  # Pitch shift up 4 semitones (2^(4/12))
MEGA_POWER_MUSIC_SPEEDUP_ENABLED = False  # Toggle for music speed-up feature during MEGA POWER

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

# Screen shake and effects
SCREEN_SHAKE_LARGE = 8  # pixels for large asteroids
SCREEN_SHAKE_MEDIUM = 5  # pixels for medium asteroids
SCREEN_SHAKE_SMALL = 2  # pixels for small asteroids
SCREEN_SHAKE_DECAY = 8.0  # how fast shake decays per second
SCREEN_SHAKE_MAX = 12  # maximum screen shake (prevents stacking too high)
SCREEN_SHAKE_COOLDOWN = 0.1  # minimum seconds between shake additions (prevents rapid stacking)

# Asteroid death animation
ASTEROID_DEATH_DURATION = 0.15  # seconds
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
EXHAUST_PARTICLE_SPEED = 80  # pixels per second (slower than regular particles)
EXHAUST_PARTICLE_LIFETIME = 0.3  # seconds (shorter lifetime for trail effect)
EXHAUST_PARTICLE_SPREAD = 20  # degrees of angular spread