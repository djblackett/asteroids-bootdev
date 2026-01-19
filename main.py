"""Asteroids game - Main entry point."""

# pygbag: debug=0

import pygame
import asyncio
import sys

from asteroid import Asteroid
from asteroidfield import AsteroidField
from player import Player
from shot import Shot
from powerup import PowerUp
from particlesystem import ParticleSystem
from controlconfig import ControlConfig
from starfield import Starfield
from ufo import UFO
from spatialgrid import SpatialGrid
from soundeffects import start_background_music, init_sounds, reset_music_speed
from startscreen import draw_start_screen
from constants import (
    SCREEN_HEIGHT, SCREEN_WIDTH,
    BACKGROUND_MUSIC_ENABLED,
    STARFIELD_ENABLED, STARFIELD_STAR_COUNT,
    SHARED_LIVES_POOL,
    WAVE_SYSTEM_ENABLED,
    GAMEPLAY_DEBUG,
)
import frametime
import hud
from gamestate import GameState
from events import process_events
from gameloop import (
    update_timers, update_difficulty, update_music_speed,
    update_wave_system, update_players, update_entities,
    process_collisions, render_gameplay, render_game_over,
)

IS_WEB = sys.platform == "emscripten"


def debug_print(*args, **kwargs):
    if not IS_WEB:
        print(*args, **kwargs)


def reset_game(updatable, player1_input=None, player2_input=None, speed_multiplier=1.0, player_count=2):
    """Reset all game objects for a new game."""
    for sprite in updatable:
        sprite.kill()

    if player1_input is None or player2_input is None:
        gamepad_count = pygame.joystick.get_count()
        if gamepad_count >= 2:
            player1_input, player2_input = "gamepad_0", "gamepad_1"
        elif gamepad_count == 1:
            player1_input, player2_input = "keyboard", "gamepad_0"
        else:
            player1_input, player2_input = "keyboard", "keyboard_2"

    if player_count == 1:
        player1 = Player(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2, player1_input, 1, speed_multiplier)
        player2 = Player(-1000, -1000, player2_input, 2, speed_multiplier)
        player2.lives = 0
    else:
        player1 = Player(SCREEN_WIDTH * 0.25, SCREEN_HEIGHT // 2, player1_input, 1, speed_multiplier)
        player2 = Player(SCREEN_WIDTH * 0.75, SCREEN_HEIGHT // 2, player2_input, 2, speed_multiplier)

    player1.score = player2.score = 0

    field = AsteroidField()
    field.players = [player1, player2]
    if WAVE_SYSTEM_ENABLED:
        field.start_wave(1)

    return player1, player2, field


async def main():
    debug_print("Starting Asteroids!")

    pygame.mixer.pre_init(frequency=22050, size=-16, channels=2, buffer=512)
    pygame.init()
    if not IS_WEB:
        pygame.mixer.set_num_channels(32)

    hud.init_fonts()
    init_sounds()
    if BACKGROUND_MUSIC_ENABLED:
        start_background_music()

    screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
    pygame.display.set_caption("Asteroids Game")
    clock = pygame.time.Clock()

    # Initialize joysticks
    if not IS_WEB:
        pygame.joystick.init()
        for i in range(pygame.joystick.get_count()):
            pygame.joystick.Joystick(i).init()

    # Sprite groups
    updatable, drawable = pygame.sprite.Group(), pygame.sprite.Group()
    asteroids, shots, powerups, ufos = pygame.sprite.Group(), pygame.sprite.Group(), pygame.sprite.Group(), pygame.sprite.Group()
    laser_beams = []

    Player.containers = (updatable, drawable)
    Asteroid.containers = (asteroids, updatable, drawable)
    AsteroidField.containers = (updatable,)
    Shot.containers = (shots, updatable, drawable)
    PowerUp.containers = (powerups, updatable, drawable)
    UFO.containers = (ufos, updatable, drawable)

    control_config = ControlConfig()
    state = GameState()
    collision_grid = SpatialGrid(SCREEN_WIDTH, SCREEN_HEIGHT, cell_size=140)
    particle_system = ParticleSystem(max_particles=500)
    starfield = Starfield(star_count=STARFIELD_STAR_COUNT) if STARFIELD_ENABLED else None

    if GAMEPLAY_DEBUG:
        state.config_phase = False
        state.game_started = True
        state.current_player_count = 1
        player1, player2, asteroid_field_ref = reset_game(updatable, "keyboard", "keyboard_2", 1.0, 1)
    else:
        player1, player2, asteroid_field_ref = reset_game(updatable)

    dt = 0
    while state.running:
        frametime.update()
        event_result = process_events(state, control_config)

        if event_result.should_quit:
            break

        if event_result.should_reset_game and not state.config_phase:
            p1_input, p2_input = control_config.get_player_inputs()
            player_cnt = control_config.get_player_count()
            state.current_player_count = player_cnt
            state.friendly_fire_enabled = control_config.get_friendly_fire_enabled()
            state.shared_lives_enabled = control_config.get_shared_lives_enabled()

            player1, player2, asteroid_field_ref = reset_game(
                updatable, p1_input, p2_input, control_config.get_speed_multiplier(), player_cnt)

            if state.shared_lives_enabled and player_cnt == 2:
                player1.lives, player2.lives = SHARED_LIVES_POOL, 0

            state.reset_for_new_game()
            particle_system.clear()
            laser_beams = []
            if state.music_sped_up:
                reset_music_speed()
                state.music_sped_up = False

        screen.fill((0, 0, 0))

        if state.config_phase:
            control_config.draw(screen)
        elif not state.game_started:
            if starfield:
                starfield.draw(screen)
            for sprite in drawable:
                sprite.draw(screen, (0, 0))
            draw_start_screen(screen)
        elif not state.game_over:
            if not state.paused:
                update_timers(state, dt)
                update_difficulty(state)
                update_music_speed(state, player1, player2)
                update_wave_system(state, asteroid_field_ref, asteroids, dt)
                update_players(state, player1, player2, dt, laser_beams, particle_system)
                update_entities(state, dt, updatable, shots, asteroids, powerups, asteroid_field_ref, ufos)
                if starfield:
                    starfield.update(player1, player2)
                process_collisions(state, player1, player2, shots, asteroids, powerups, ufos,
                                   laser_beams, collision_grid, particle_system, dt)
            render_gameplay(screen, state, player1, player2, starfield, drawable, particle_system, laser_beams)
        else:
            render_game_over(screen, state, player1, player2, starfield, drawable, particle_system, dt)

        pygame.display.flip()
        dt = clock.tick(60) / 1000
        await asyncio.sleep(0)


if __name__ == "__main__":
    asyncio.run(main())
