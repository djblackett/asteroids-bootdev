"""Asteroids game - Main entry point."""

# pygbag: debug=0
# Debug console disabled for cleaner web experience

import pygame
import random
import asyncio
import sys

from asteroid import Asteroid
from asteroidfield import AsteroidField
from player import Player
from shot import Shot
from powerup import PowerUp
from laserbeam import LaserBeam
from particlesystem import ParticleSystem
from taunt import TauntAnimation
from startscreen import draw_start_screen
from controlconfig import ControlConfig
from starfield import Starfield
from ufo import UFO
from spatialgrid import SpatialGrid
from soundeffects import (
    start_background_music, init_sounds, set_music_speed,
    reset_music_speed, unpause_music
)
from constants import (
    SCREEN_HEIGHT, SCREEN_WIDTH,
    ASTEROID_SPAWN_RATE,
    BOUNDARY_PARTICLE_COUNT, BOUNDARY_SHAKE_AMOUNT, PARTICLE_SPEED,
    EXHAUST_PARTICLE_SPEED, EXHAUST_PARTICLE_SPREAD,
    BACKGROUND_MUSIC_ENABLED,
    STARFIELD_ENABLED, STARFIELD_STAR_COUNT,
    SHARED_LIVES_POOL,
    REVIVE_SYSTEM_ENABLED, REVIVE_SPAWN_CHANCE,
    WAVE_SYSTEM_ENABLED, WAVE_BREAK_DURATION, WAVE_MAX_DURATION,
    UFO_ENABLED,
    DIFFICULTY_INCREASE_INTERVAL, DIFFICULTY_SPEED_INCREMENT,
    DIFFICULTY_SPAWN_RATE_INCREMENT, DIFFICULTY_SPAWN_RATE_MIN,
    SCREEN_SHAKE_DECAY, SCREEN_SHAKE_MAX, SCREEN_SHAKE_COOLDOWN,
    SLOW_MOTION_FACTOR,
    MEGA_POWER_MUSIC_SPEEDUP_ENABLED, MEGA_POWER_MUSIC_SPEED,
    GAMEPLAY_DEBUG,
)
import frametime

# Import new modules
from gamestate import GameState
import hud
from events import process_events
from collisions import (
    handle_player_asteroid_collision,
    handle_shot_asteroid_collisions,
    handle_laser_asteroid_collisions,
    handle_ufo_shot_collision,
    handle_ufo_player_collision,
    handle_ufo_shot_hitting_player,
    handle_powerup_collection,
    handle_friendly_fire_shot,
    handle_friendly_fire_laser,
    spawn_particles,
    add_screen_shake,
)

IS_WEB = sys.platform == "emscripten"


def debug_print(*args, **kwargs):
    """Print only on desktop, not on web."""
    if not IS_WEB:
        print(*args, **kwargs)


def handle_player_death(player, player_num, death_x, death_y):
    """Handle player death logic including revive spawning."""
    if REVIVE_SYSTEM_ENABLED and random.random() < REVIVE_SPAWN_CHANCE:
        PowerUp(death_x, death_y, PowerUp.REVIVE)
        debug_print(f"Revive power-up spawned at Player {player_num}'s death location!")


def reset_game(updatable, player1_input=None, player2_input=None, speed_multiplier=1.0, player_count=2):
    """Reset all game objects for a new game."""
    # Clear all sprite groups
    for sprite in updatable:
        sprite.kill()

    # If no inputs specified, determine based on available gamepads
    if player1_input is None or player2_input is None:
        gamepad_count = pygame.joystick.get_count()
        if gamepad_count >= 2:
            player1_input = "gamepad_0"
            player2_input = "gamepad_1"
        elif gamepad_count == 1:
            player1_input = "keyboard"
            player2_input = "gamepad_0"
        else:
            player1_input = "keyboard"
            player2_input = "keyboard_2"

    # Create players based on player_count
    if player_count == 1:
        player1 = Player(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2, player1_input, 1, speed_multiplier)
        player1.score = 0
        player2 = Player(-1000, -1000, player2_input, 2, speed_multiplier)
        player2.lives = 0
        player2.score = 0
    else:
        player1 = Player(SCREEN_WIDTH * 0.25, SCREEN_HEIGHT // 2, player1_input, 1, speed_multiplier)
        player1.score = 0
        player2 = Player(SCREEN_WIDTH * 0.75, SCREEN_HEIGHT // 2, player2_input, 2, speed_multiplier)
        player2.score = 0

    # Create asteroid field
    field = AsteroidField()
    field.players = [player1, player2]

    if WAVE_SYSTEM_ENABLED:
        field.start_wave(1)

    return player1, player2, field


async def main():
    debug_print("Starting Asteroids!")
    debug_print("Screen width:", SCREEN_WIDTH)
    debug_print("Screen height:", SCREEN_HEIGHT)

    # Initialize mixer BEFORE pygame.init()
    pygame.mixer.pre_init(frequency=22050, size=-16, channels=2, buffer=512)
    pygame.init()

    if not IS_WEB:
        pygame.mixer.set_num_channels(32)

    # Initialize fonts
    hud.init_fonts()

    # Create spatial grid for collision detection
    collision_grid = SpatialGrid(SCREEN_WIDTH, SCREEN_HEIGHT, cell_size=140)

    # Initialize joystick/gamepad support (desktop only)
    joysticks = []
    if not IS_WEB:
        pygame.joystick.init()
        joysticks = [pygame.joystick.Joystick(i) for i in range(pygame.joystick.get_count())]
        for joystick in joysticks:
            joystick.init()
            debug_print(f"Gamepad detected: {joystick.get_name()}")
        if not joysticks:
            debug_print("No gamepad detected - using keyboard controls only")
    else:
        debug_print("Web build detected: gamepad support disabled, keyboard controls only.")

    screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
    pygame.display.set_caption("Asteroids Game")

    init_sounds()
    if BACKGROUND_MUSIC_ENABLED:
        start_background_music()

    clock = pygame.time.Clock()
    dt = 0

    # Sprite groups
    updatable = pygame.sprite.Group()
    drawable = pygame.sprite.Group()
    asteroids = pygame.sprite.Group()
    shots = pygame.sprite.Group()
    powerups = pygame.sprite.Group()
    ufos = pygame.sprite.Group()
    laser_beams = []

    Player.containers = (updatable, drawable)
    Asteroid.containers = (asteroids, updatable, drawable)
    AsteroidField.containers = (updatable,)
    Shot.containers = (shots, updatable, drawable)
    PowerUp.containers = (powerups, updatable, drawable)
    UFO.containers = (ufos, updatable, drawable)

    # Control configuration
    control_config = ControlConfig()

    # Game state
    state = GameState()

    # Debug mode: skip config and start screens
    if GAMEPLAY_DEBUG:
        state.config_phase = False
        debug_print("DEBUG MODE: Skipping config/start screens")
        player1, player2, asteroid_field_ref = reset_game(updatable, "keyboard", "keyboard_2", 1.0, 1)
        state.current_player_count = 1
        state.game_started = True
    else:
        player1, player2, asteroid_field_ref = reset_game(updatable)

    # Particle system
    particle_system = ParticleSystem(max_particles=500)

    # Starfield background
    starfield = Starfield(star_count=STARFIELD_STAR_COUNT) if STARFIELD_ENABLED else None

    # Respawn positions
    p1_spawn_x, p1_spawn_y = SCREEN_WIDTH * 0.25, SCREEN_HEIGHT // 2
    p2_spawn_x, p2_spawn_y = SCREEN_WIDTH * 0.75, SCREEN_HEIGHT // 2

    # Main game loop
    while state.running:
        frametime.update()

        # Process events
        event_result = process_events(state, control_config)

        if event_result.should_quit:
            state.running = False
            continue

        if event_result.should_reset_game:
            if state.config_phase:
                # Config just completed - get settings and reset
                control_config.reset()
            else:
                # Retry from game over or config complete
                p1_input, p2_input = control_config.get_player_inputs()
                speed_mult = control_config.get_speed_multiplier()
                player_cnt = control_config.get_player_count()
                state.current_player_count = player_cnt
                state.friendly_fire_enabled = control_config.get_friendly_fire_enabled()
                state.shared_lives_enabled = control_config.get_shared_lives_enabled()

                player1, player2, asteroid_field_ref = reset_game(
                    updatable, p1_input, p2_input, speed_mult, player_cnt)

                if state.shared_lives_enabled and player_cnt == 2:
                    player1.lives = SHARED_LIVES_POOL
                    player2.lives = 0

                state.reset_for_new_game()
                particle_system.clear()
                laser_beams = []

                if state.music_sped_up:
                    reset_music_speed()
                    state.music_sped_up = False

        if event_result.return_to_config:
            # Already handled by process_events setting state flags
            pass

        # Fill screen
        screen.fill((0, 0, 0))

        # Config phase
        if state.config_phase:
            control_config.draw(screen)

        # Start screen
        elif not state.game_started:
            shake_offset = (0, 0)
            if starfield:
                starfield.draw(screen)
            for sprite in drawable:
                sprite.draw(screen, shake_offset)
            draw_start_screen(screen)

        # Active gameplay
        elif not state.game_over:
            if not state.paused:
                # Update cooldowns
                if state.game_start_cooldown > 0:
                    state.game_start_cooldown -= dt

                # Update game time and difficulty
                state.game_time += dt
                state.difficulty_timer += dt

                if state.difficulty_timer >= DIFFICULTY_INCREASE_INTERVAL:
                    state.difficulty_timer = 0.0
                    state.asteroid_speed_multiplier += DIFFICULTY_SPEED_INCREMENT
                    state.asteroid_spawn_rate = max(
                        state.asteroid_spawn_rate - DIFFICULTY_SPAWN_RATE_INCREMENT,
                        DIFFICULTY_SPAWN_RATE_MIN)
                    debug_print(f"Difficulty increased! Speed: {state.asteroid_speed_multiplier:.2f}x")

                # Music speed for MEGA POWER
                if MEGA_POWER_MUSIC_SPEEDUP_ENABLED:
                    should_have_fast_music = player1.mega_power_active or player2.mega_power_active
                    if should_have_fast_music != state.music_sped_up:
                        if should_have_fast_music:
                            set_music_speed(MEGA_POWER_MUSIC_SPEED)
                            state.music_sped_up = True
                        else:
                            reset_music_speed()
                            state.music_sped_up = False

                # Update combo timer
                if state.combo_timer > 0:
                    state.combo_timer -= dt
                    if state.combo_timer <= 0:
                        state.combo_count = 0
                        state.combo_timer = 0.0
                        state.last_streak_milestone = 0

                # Update kill streak notification
                if state.active_streak_notification:
                    if not state.active_streak_notification.update(dt):
                        state.active_streak_notification = None

                # Update slow motion
                if state.slow_motion_active:
                    state.slow_motion_timer -= dt
                    if state.slow_motion_timer <= 0:
                        state.slow_motion_active = False

                # Update screen shake
                if state.screen_shake > 0:
                    state.screen_shake -= SCREEN_SHAKE_DECAY * dt
                    if state.screen_shake < 0:
                        state.screen_shake = 0
                if state.screen_shake_cooldown > 0:
                    state.screen_shake_cooldown -= dt

                # Update starfield
                if starfield:
                    starfield.update(player1, player2)

                # Update asteroid field
                for field in updatable:
                    if isinstance(field, AsteroidField):
                        field.update(dt, state.asteroid_spawn_rate)

                # Wave system
                if WAVE_SYSTEM_ENABLED and asteroid_field_ref:
                    if state.wave_break_active:
                        state.wave_break_timer -= dt
                        if state.wave_break_timer <= 0:
                            state.current_wave += 1
                            asteroid_field_ref.start_wave(state.current_wave)
                            state.wave_break_active = False
                            state.wave_duration_timer = 0.0
                    else:
                        state.wave_duration_timer += dt
                        wave_complete = asteroid_field_ref.asteroids_to_spawn == 0 and len(asteroids) == 0
                        wave_timeout = state.wave_duration_timer >= WAVE_MAX_DURATION

                        if (wave_complete or wave_timeout) and not state.wave_break_active:
                            state.wave_break_active = True
                            state.wave_break_timer = WAVE_BREAK_DURATION
                            if wave_timeout:
                                for asteroid in list(asteroids):
                                    asteroid.kill()
                            state.wave_duration_timer = 0.0

                # UFO spawning
                if UFO_ENABLED and asteroid_field_ref.ufo_spawn_scheduled:
                    if asteroid_field_ref.ufo_spawn_timer >= asteroid_field_ref.ufo_spawn_delay:
                        asteroid_field_ref.spawn_ufo(ufos)
                        asteroid_field_ref.ufo_spawn_scheduled = False

                # Control shooting cooldown
                if state.game_start_cooldown > 0:
                    player1.can_shoot = False
                    player2.can_shoot = False
                else:
                    player1.can_shoot = True
                    player2.can_shoot = True

                # Update players
                if not state.player1_dead or (state.shared_lives_enabled and player1.lives > 0):
                    player1.update(dt)
                if not state.player2_dead or (state.shared_lives_enabled and player1.lives > 0):
                    player2.update(dt)

                # Check for new laser beams
                if player1.pending_laser:
                    laser_beams.append(player1.pending_laser)
                    player1.pending_laser = None
                if player2.pending_laser:
                    laser_beams.append(player2.pending_laser)
                    player2.pending_laser = None

                # Boundary bounce effects
                for player, p_num in [(player1, 1), (player2, 2)]:
                    if player.bounce_info:
                        if state.screen_shake_cooldown <= 0:
                            state.screen_shake = min(state.screen_shake + BOUNDARY_SHAKE_AMOUNT, SCREEN_SHAKE_MAX)
                            state.screen_shake_cooldown = SCREEN_SHAKE_COOLDOWN
                        for _ in range(BOUNDARY_PARTICLE_COUNT):
                            base_angle = player.bounce_info['direction'].angle_to(pygame.Vector2(0, 1))
                            angle = base_angle + random.uniform(-30, 30)
                            velocity = pygame.Vector2(0, 1).rotate(angle) * PARTICLE_SPEED * 0.8
                            particle_system.emit(player.bounce_info['position'].x,
                                                 player.bounce_info['position'].y, velocity)
                        player.bounce_info = None

                # Exhaust particles
                for player in [player1, player2]:
                    exhaust_info = player.get_exhaust_info()
                    if exhaust_info:
                        base_angle = exhaust_info['direction'].angle_to(pygame.Vector2(0, 1))
                        angle = base_angle + random.uniform(-EXHAUST_PARTICLE_SPREAD/2, EXHAUST_PARTICLE_SPREAD/2)
                        velocity = pygame.Vector2(0, 1).rotate(angle) * EXHAUST_PARTICLE_SPEED
                        particle_system.emit(exhaust_info['position'].x, exhaust_info['position'].y, velocity)

                # Update shots
                for shot in shots:
                    shot.update(dt)

                # Update asteroids with slow motion
                base_dt = dt * state.asteroid_speed_multiplier
                asteroid_dt = base_dt * SLOW_MOTION_FACTOR if state.slow_motion_active else base_dt
                for asteroid in asteroids:
                    asteroid.update(asteroid_dt, dt)

                # Update power-ups
                for powerup in powerups:
                    powerup.update(dt)

                # Build spatial grid
                collision_grid.clear()
                for asteroid in asteroids:
                    if not asteroid.dying:
                        collision_grid.insert(asteroid)

                # Player-asteroid collisions
                for asteroid in collision_grid.get_nearby(player1):
                    if not state.player1_dead and player1.lives > 0 and player1.check_collision(asteroid):
                        if not handle_player_asteroid_collision(
                            player1, 1, asteroid, state, particle_system,
                            p1_spawn_x, p1_spawn_y, player2):
                            break

                for asteroid in collision_grid.get_nearby(player2):
                    if not state.player2_dead and player2.lives > 0 and player2.check_collision(asteroid):
                        if not handle_player_asteroid_collision(
                            player2, 2, asteroid, state, particle_system,
                            p2_spawn_x, p2_spawn_y, player1):
                            break

                # Update particles
                particle_system.update(dt)

                # Shot-asteroid collisions
                handle_shot_asteroid_collisions(shots, collision_grid, state, particle_system)

                # Laser-asteroid collisions
                laser_beams_to_remove = handle_laser_asteroid_collisions(
                    laser_beams, asteroids, state, particle_system, dt)
                for laser in laser_beams_to_remove:
                    laser_beams.remove(laser)

                # UFO collisions
                for ufo in list(ufos):
                    for shot in shots:
                        if isinstance(shot.owner, UFO):
                            continue
                        if ufo.check_collision(shot):
                            handle_ufo_shot_collision(ufo, shot, state, particle_system)
                            break

                for ufo in ufos:
                    if not state.player1_dead and player1.lives > 0 and player1.check_collision(ufo):
                        handle_ufo_player_collision(ufo, player1, 1, state, particle_system,
                                                    p1_spawn_x, p1_spawn_y, player1, player2)
                    if not state.player2_dead and player2.lives > 0 and player2.check_collision(ufo):
                        handle_ufo_player_collision(ufo, player2, 2, state, particle_system,
                                                    p2_spawn_x, p2_spawn_y, player1, player2)

                # UFO shots hitting players
                for shot in list(shots):
                    if not isinstance(shot.owner, UFO):
                        continue
                    if not state.player1_dead and player1.lives > 0 and player1.check_collision(shot):
                        handle_ufo_shot_hitting_player(shot, player1, 1, state, p1_spawn_x, p1_spawn_y, player1, player2)
                    if not state.player2_dead and player2.lives > 0 and player2.check_collision(shot):
                        handle_ufo_shot_hitting_player(shot, player2, 2, state, p2_spawn_x, p2_spawn_y, player1, player2)

                # Power-up collection
                for powerup in powerups:
                    collected = False
                    if not state.player1_dead and player1.lives > 0 and player1.check_collision(powerup):
                        handle_powerup_collection(player1, 1, powerup, state, player2,
                                                   p1_spawn_x, p1_spawn_y, p2_spawn_x, p2_spawn_y)
                        collected = True
                    if not collected and not state.player2_dead and player2.lives > 0 and player2.check_collision(powerup):
                        handle_powerup_collection(player2, 2, powerup, state, player1,
                                                   p1_spawn_x, p1_spawn_y, p2_spawn_x, p2_spawn_y)

                # Friendly fire
                if state.friendly_fire_enabled:
                    for shot in list(shots):
                        if shot.owner != player1 and not state.player1_dead and player1.lives > 0 and player1.check_collision(shot):
                            handle_friendly_fire_shot(shot, player1, 1, state, p1_spawn_x, p1_spawn_y, player1, player2)
                            continue
                        if shot.owner != player2 and not state.player2_dead and player2.lives > 0 and player2.check_collision(shot):
                            handle_friendly_fire_shot(shot, player2, 2, state, p2_spawn_x, p2_spawn_y, player1, player2)
                            continue

                    for laser in laser_beams:
                        if laser.owner != player1 and not state.player1_dead and player1.lives > 0 and laser.check_hit(player1):
                            handle_friendly_fire_laser(laser, player1, 1, state, p1_spawn_x, p1_spawn_y, player1, player2)
                            continue
                        if laser.owner != player2 and not state.player2_dead and player2.lives > 0 and laser.check_hit(player2):
                            handle_friendly_fire_laser(laser, player2, 2, state, p2_spawn_x, p2_spawn_y, player1, player2)
                            continue

            # Rendering
            shake_offset = (0, 0)
            if state.screen_shake > 0:
                shake_offset = (
                    random.uniform(-state.screen_shake, state.screen_shake),
                    random.uniform(-state.screen_shake, state.screen_shake)
                )

            if starfield:
                starfield.draw(screen)

            for sprite in drawable:
                sprite.draw(screen, shake_offset)

            particle_system.draw(screen, shake_offset)

            for laser in laser_beams:
                laser.draw(screen, shake_offset)

            # HUD
            hud.draw_scores(screen, player1, player2, state.shared_lives_enabled, state.current_player_count)
            hud.draw_combo(screen, state.combo_count, state.combo_timer)

            if WAVE_SYSTEM_ENABLED:
                hud.draw_wave_info(screen, state.current_wave, state.wave_break_active,
                                   state.wave_break_timer, state.wave_duration_timer, WAVE_MAX_DURATION)
            else:
                hud.draw_timer(screen, state.game_time)

            if state.active_streak_notification:
                state.active_streak_notification.draw(screen)

            hud.draw_powerup_indicator(screen, player1, state.slow_motion_active, state.slow_motion_timer)

            if state.paused:
                hud.draw_pause_screen(screen, state.music_muted)

        # Game over
        else:
            if state.game_over_retry_delay > 0:
                state.game_over_retry_delay -= dt
                if state.game_over_retry_delay < 0:
                    state.game_over_retry_delay = 0

            shake_offset = (0, 0)

            if starfield:
                starfield.draw(screen)

            for sprite in drawable:
                sprite.draw(screen, shake_offset)

            particle_system.update(dt)
            particle_system.draw(screen, shake_offset)

            hud.draw_scores(screen, player1, player2, state.shared_lives_enabled, state.current_player_count)
            hud.draw_powerup_indicator(screen, player1, state.slow_motion_active, state.slow_motion_timer)

            state.button_rect = hud.draw_game_over_screen(
                screen, player1, player2, state.game_over_retry_delay,
                state.show_high_scores, state.p1_highscore_rank, state.p2_highscore_rank)

            if state.taunt_animation:
                if not state.taunt_animation.update(dt):
                    state.taunt_animation = None
                else:
                    state.taunt_animation.draw(screen)

        pygame.display.flip()
        dt = clock.tick(60) / 1000
        await asyncio.sleep(0)


if __name__ == "__main__":
    asyncio.run(main())
