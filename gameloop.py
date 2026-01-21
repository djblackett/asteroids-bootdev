"""Game loop update and rendering logic for Asteroids game."""

import random
import pygame

from asteroidfield import AsteroidField
from ufo import UFO
from constants import (
    SCREEN_WIDTH, SCREEN_HEIGHT,
    BOUNDARY_PARTICLE_COUNT, BOUNDARY_SHAKE_AMOUNT, PARTICLE_SPEED,
    EXHAUST_PARTICLE_SPEED, EXHAUST_PARTICLE_SPREAD,
    WAVE_SYSTEM_ENABLED, WAVE_BREAK_DURATION, WAVE_MAX_DURATION,
    UFO_ENABLED,
    DIFFICULTY_INCREASE_INTERVAL, DIFFICULTY_SPEED_INCREMENT,
    DIFFICULTY_SPAWN_RATE_INCREMENT, DIFFICULTY_SPAWN_RATE_MIN,
    SCREEN_SHAKE_DECAY, SCREEN_SHAKE_MAX, SCREEN_SHAKE_COOLDOWN,
    SLOW_MOTION_FACTOR,
    MEGA_POWER_MUSIC_SPEEDUP_ENABLED, MEGA_POWER_MUSIC_SPEED,
)
from soundeffects import set_music_speed, reset_music_speed
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
)
import hud

# Respawn positions
P1_SPAWN = (SCREEN_WIDTH * 0.25, SCREEN_HEIGHT // 2)
P2_SPAWN = (SCREEN_WIDTH * 0.75, SCREEN_HEIGHT // 2)


def update_timers(state, dt):
    """Update all game timers."""
    if state.game_start_cooldown > 0:
        state.game_start_cooldown -= dt

    state.game_time += dt
    state.difficulty_timer += dt

    if state.combo_timer > 0:
        state.combo_timer -= dt
        if state.combo_timer <= 0:
            state.combo_count = 0
            state.combo_timer = 0.0
            state.last_streak_milestone = 0

    if state.active_streak_notification:
        if not state.active_streak_notification.update(dt):
            state.active_streak_notification = None

    if state.slow_motion_active:
        state.slow_motion_timer -= dt
        if state.slow_motion_timer <= 0:
            state.slow_motion_active = False

    if state.screen_shake > 0:
        state.screen_shake -= SCREEN_SHAKE_DECAY * dt
        if state.screen_shake < 0:
            state.screen_shake = 0
    if state.screen_shake_cooldown > 0:
        state.screen_shake_cooldown -= dt


def update_difficulty(state):
    """Update difficulty progression."""
    if state.difficulty_timer >= DIFFICULTY_INCREASE_INTERVAL:
        state.difficulty_timer = 0.0
        state.asteroid_speed_multiplier += DIFFICULTY_SPEED_INCREMENT
        state.asteroid_spawn_rate = max(
            state.asteroid_spawn_rate - DIFFICULTY_SPAWN_RATE_INCREMENT,
            DIFFICULTY_SPAWN_RATE_MIN)


def update_music_speed(state, player1, player2):
    """Update music speed based on MEGA POWER status."""
    if MEGA_POWER_MUSIC_SPEEDUP_ENABLED:
        should_have_fast_music = player1.mega_power_active or player2.mega_power_active
        if should_have_fast_music != state.music_sped_up:
            if should_have_fast_music:
                set_music_speed(MEGA_POWER_MUSIC_SPEED)
                state.music_sped_up = True
            else:
                reset_music_speed()
                state.music_sped_up = False


def update_wave_system(state, asteroid_field_ref, asteroids, dt):
    """Update the wave system."""
    if not WAVE_SYSTEM_ENABLED or not asteroid_field_ref:
        return

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


def update_players(state, player1, player2, dt, laser_beams, particle_system):
    """Update players, lasers, and particle effects."""
    # Control shooting cooldown
    can_shoot = state.game_start_cooldown <= 0
    player1.can_shoot = can_shoot
    player2.can_shoot = can_shoot

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
    for player in [player1, player2]:
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


def update_entities(state, dt, updatable, shots, asteroids, powerups, asteroid_field_ref, ufos):
    """Update all game entities."""
    # Update asteroid field
    for field in updatable:
        if isinstance(field, AsteroidField):
            field.update(dt, state.asteroid_spawn_rate)

    # UFO spawning
    if UFO_ENABLED and asteroid_field_ref.ufo_spawn_scheduled:
        if asteroid_field_ref.ufo_spawn_timer >= asteroid_field_ref.ufo_spawn_delay:
            asteroid_field_ref.spawn_ufo(ufos)
            asteroid_field_ref.ufo_spawn_scheduled = False

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

    # Update UFOs
    for ufo in ufos:
        ufo.update(dt)


def process_collisions(state, player1, player2, shots, asteroids, powerups, ufos,
                       laser_beams, collision_grid, particle_system, dt):
    """Process all collisions."""
    p1_spawn_x, p1_spawn_y = P1_SPAWN
    p2_spawn_x, p2_spawn_y = P2_SPAWN

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


def render_gameplay(screen, state, player1, player2, starfield, drawable,
                    particle_system, laser_beams):
    """Render gameplay screen."""
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


def render_game_over(screen, state, player1, player2, starfield, drawable,
                     particle_system, dt):
    """Render game over screen."""
    if state.game_over_retry_delay > 0:
        state.game_over_retry_delay -= dt
        if state.game_over_retry_delay < 0:
            state.game_over_retry_delay = 0

    if starfield:
        starfield.draw(screen)

    for sprite in drawable:
        sprite.draw(screen, (0, 0))

    particle_system.update(dt)
    particle_system.draw(screen, (0, 0))

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
