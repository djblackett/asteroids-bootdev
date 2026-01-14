# this allows us to use code from
# the open-source pygame library
# throughout this file

# pygbag: debug=1
# This enables the Python console in the browser for debugging

from asteroid import Asteroid
from constants import (ASTEROID_MAX_RADIUS, ASTEROID_MIN_RADIUS, ASTEROID_SPAWN_RATE,
                      SCREEN_HEIGHT, SCREEN_WIDTH, MEGA_POWER_MUSIC_SPEEDUP_ENABLED,
                      BOUNDARY_PARTICLE_COUNT, BOUNDARY_SHAKE_AMOUNT, PARTICLE_SPEED,
                      EXHAUST_PARTICLE_SPEED, EXHAUST_PARTICLE_SPREAD, BACKGROUND_MUSIC_ENABLED,
                      STARFIELD_ENABLED, STARFIELD_STAR_COUNT, FRIENDLY_FIRE_ENABLED,
                      SHARED_LIVES_ENABLED, SHARED_LIVES_POOL, REVIVE_SYSTEM_ENABLED,
                      REVIVE_SPAWN_CHANCE, WAVE_SYSTEM_ENABLED, WAVE_BREAK_DURATION, WAVE_MAX_DURATION,
                      KILL_STREAK_ENABLED, KILL_STREAK_MILESTONES,
                      UFO_ENABLED, UFO_LARGE_POINTS, UFO_SMALL_POINTS)
from player import Player
import pygame
from constants import *
from asteroidfield import AsteroidField
from shot import Shot
from soundeffects import start_background_music, init_sounds, set_music_speed, reset_music_speed
from powerup import PowerUp
from laserbeam import LaserBeam
from particle import Particle
from taunt import TauntAnimation
from startscreen import draw_start_screen
from controlconfig import ControlConfig
from highscores import add_score, is_high_score, get_top_scores
from starfield import Starfield
from killstreak import KillStreakNotification
from ufo import UFO
import random
import asyncio
import sys

IS_WEB = sys.platform == "emscripten"


def handle_player_death(player, player_num, death_x, death_y, shared_lives_enabled):
    """
    Handle player death logic including revive spawning.
    Returns True if game should continue, False if game over.
    """
    # Spawn revive power-up if enabled
    if REVIVE_SYSTEM_ENABLED and random.random() < REVIVE_SPAWN_CHANCE:
        PowerUp(death_x, death_y, PowerUp.REVIVE)
        print(f"Revive power-up spawned at Player {player_num}'s death location!")

    return True  # Game continues (player can be revived)


def draw_scores(screen, player1, player2, shared_lives_enabled=False):
    """Draw scores and lives for both players"""
    font = pygame.font.Font(None, 36)

    # Player 1 - Top left
    p1_color = (100, 200, 255) if player1.lives > 0 or (shared_lives_enabled and player1.lives > 0) else (100, 100, 100)
    p1_score_text = font.render(f"P1: {player1.score}", True, p1_color)
    p1_score_rect = p1_score_text.get_rect(topleft=(10, 10))
    screen.blit(p1_score_text, p1_score_rect)

    # Player 2 - Top right
    p2_color = (255, 200, 100) if player2.lives > 0 or (shared_lives_enabled and player1.lives > 0) else (100, 100, 100)
    p2_score_text = font.render(f"P2: {player2.score}", True, p2_color)
    p2_score_rect = p2_score_text.get_rect(topright=(SCREEN_WIDTH - 10, 10))
    screen.blit(p2_score_text, p2_score_rect)

    # Lives display - centered if shared, separate if not
    if shared_lives_enabled and player2.lives == 0:
        # Shared lives - show in center
        lives_color = (100, 255, 255)
        lives_text = font.render(f"SHARED LIVES: {player1.lives}", True, lives_color)
        lives_rect = lives_text.get_rect(midtop=(SCREEN_WIDTH // 2, 10))
        screen.blit(lives_text, lives_rect)
    else:
        # Individual lives - show separately
        # Player 1 lives
        lives_text = font.render(f"Lives: {player1.lives}", True, p1_color)
        lives_rect = lives_text.get_rect(topleft=(10, 45))
        screen.blit(lives_text, lives_rect)

        # Player 2 lives
        lives_text = font.render(f"Lives: {player2.lives}", True, p2_color)
        lives_rect = lives_text.get_rect(topright=(SCREEN_WIDTH - 10, 45))
        screen.blit(lives_text, lives_rect)


def draw_combo(screen, combo_count, combo_timer):
    """Draw the combo counter with animations"""
    if combo_count <= 1:
        return  # Don't show for 1x

    # Get multiplier
    multiplier = COMBO_MULTIPLIERS.get(combo_count, COMBO_MULTIPLIERS[5])

    # Position in center-right of screen
    x_pos = SCREEN_WIDTH - 250
    y_pos = 100

    # Pulse effect based on timer
    pulse = 1.0 + (0.3 * (combo_timer / COMBO_TIMEOUT))

    # Color intensity based on combo level
    if combo_count >= 5:
        color = (255, 100, 255)  # Purple for high combos
    elif combo_count >= 3:
        color = (255, 165, 0)  # Orange
    else:
        color = (255, 255, 0)  # Yellow

    # Large combo text
    font_large = pygame.font.Font(None, int(80 * pulse))
    combo_text = font_large.render(f"{combo_count}x COMBO", True, color)
    combo_rect = combo_text.get_rect(center=(x_pos, y_pos))
    screen.blit(combo_text, combo_rect)

    # Multiplier text
    font_small = pygame.font.Font(None, 32)
    multiplier_text = font_small.render(f"{multiplier}x Points!", True, color)
    multiplier_rect = multiplier_text.get_rect(center=(x_pos, y_pos + 50))
    screen.blit(multiplier_text, multiplier_rect)


def draw_wave_info(screen, wave_number, wave_break_active, wave_break_timer, wave_duration=None, wave_max_duration=None):
    """Draw wave number and break countdown"""
    font_medium = pygame.font.Font(None, 48)
    font_small = pygame.font.Font(None, 32)
    font_large = pygame.font.Font(None, 80)

    # Always show current wave number in top center
    wave_color = (100, 255, 255)
    wave_text = font_medium.render(f"WAVE {wave_number}", True, wave_color)
    wave_rect = wave_text.get_rect(midtop=(SCREEN_WIDTH // 2, 10))
    screen.blit(wave_text, wave_rect)

    # Show wave timer below wave number (if not in break and timer provided)
    if not wave_break_active and wave_duration is not None and wave_max_duration is not None:
        time_remaining = max(0, wave_max_duration - wave_duration)
        minutes = int(time_remaining // 60)
        seconds = int(time_remaining % 60)

        # Color changes as time runs out
        if time_remaining <= 10:
            timer_color = (255, 100, 100)  # Red - urgent!
        elif time_remaining <= 20:
            timer_color = (255, 200, 100)  # Orange - warning
        else:
            timer_color = (150, 150, 150)  # Gray - plenty of time

        timer_text = font_small.render(f"{minutes}:{seconds:02d}", True, timer_color)
        timer_rect = timer_text.get_rect(midtop=(SCREEN_WIDTH // 2, 58))
        screen.blit(timer_text, timer_rect)

    # Show "GET READY" message during wave break
    if wave_break_active:
        # Pulse effect based on timer
        pulse = 1.0 + (0.2 * abs(wave_break_timer % 1.0 - 0.5))

        # Large "GET READY" text
        ready_color = (255, 255, 100)
        ready_text = font_large.render("GET READY!", True, ready_color)
        ready_rect = ready_text.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 - 40))
        screen.blit(ready_text, ready_rect)

        # Countdown timer
        countdown = int(wave_break_timer) + 1
        timer_text = font_large.render(str(countdown), True, ready_color)
        timer_rect = timer_text.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 + 40))
        screen.blit(timer_text, timer_rect)


def check_kill_streak_milestone(combo_count, last_milestone):
    """Check if a new kill streak milestone has been reached. Returns milestone info or None."""
    if not KILL_STREAK_ENABLED:
        return None

    # Find the highest milestone we've reached that's higher than the last one
    for milestone in sorted(KILL_STREAK_MILESTONES.keys(), reverse=True):
        if combo_count >= milestone and milestone > last_milestone:
            streak_info = KILL_STREAK_MILESTONES[milestone]
            return {
                'milestone': milestone,
                'name': streak_info['name'],
                'color': streak_info['color']
            }

    return None


def increment_combo_and_check_streak(combo_count, last_streak_milestone, active_notification):
    """Increment combo and check for kill streak milestones. Returns (new_combo, new_milestone, new_notification)."""
    combo_count += 1

    # Check if we hit a new milestone
    milestone_info = check_kill_streak_milestone(combo_count, last_streak_milestone)
    if milestone_info:
        # Create new notification
        notification = KillStreakNotification(
            combo_count,
            milestone_info['name'],
            milestone_info['color']
        )
        return combo_count, milestone_info['milestone'], notification

    return combo_count, last_streak_milestone, active_notification


def draw_powerup_indicator(screen, player, slow_motion_active, slow_motion_timer):
    """Draw power-up status indicators"""
    font = pygame.font.Font(None, 28)
    font_large = pygame.font.Font(None, 40)
    y_offset = 80  # Moved down to make room for lives display

    # Draw laser beam shots remaining
    laser_color = (100, 200, 255) if player.laser_shots_remaining > 0 else (100, 100, 100)
    laser_text = font.render(f"LASER: {player.laser_shots_remaining}/{LASER_BEAM_MAX_SHOTS}", True, laser_color)
    laser_rect = laser_text.get_rect(topleft=(10, y_offset))
    screen.blit(laser_text, laser_rect)
    y_offset += 30

    # Draw boost status
    if player.boost_active:
        time_left = int(player.boost_timer) + 1
        boost_text = font.render(f"BOOST: {time_left}s", True, (255, 100, 255))
        boost_rect = boost_text.get_rect(topleft=(10, y_offset))
        screen.blit(boost_text, boost_rect)
        y_offset += 30
    elif player.boost_cooldown > 0:
        cooldown_left = int(player.boost_cooldown) + 1
        boost_text = font.render(f"BOOST: {cooldown_left}s CD", True, (150, 150, 150))
        boost_rect = boost_text.get_rect(topleft=(10, y_offset))
        screen.blit(boost_text, boost_rect)
        y_offset += 30
    else:
        boost_text = font.render("BOOST: READY", True, (100, 255, 100))
        boost_rect = boost_text.get_rect(topleft=(10, y_offset))
        screen.blit(boost_text, boost_rect)
        y_offset += 30

    # MEGA POWER gets special treatment - larger, rainbow text
    if player.mega_power_active:
        time_left = int(player.mega_power_timer) + 1
        # Rainbow color cycling
        time = pygame.time.get_ticks() / 100
        hue = (time % 360) / 360.0
        import colorsys
        r, g, b = colorsys.hsv_to_rgb(hue, 1.0, 1.0)
        mega_color = (int(r * 255), int(g * 255), int(b * 255))
        powerup_text = font_large.render(f"*** MEGA POWER: {time_left}s ***", True, mega_color)
        powerup_rect = powerup_text.get_rect(topleft=(10, y_offset))
        screen.blit(powerup_text, powerup_rect)
        y_offset += 45
    else:
        # Show individual power-ups only if MEGA POWER is not active
        if player.rapid_fire_active:
            time_left = int(player.rapid_fire_timer) + 1
            powerup_text = font.render(f"RAPID FIRE: {time_left}s", True, (255, 255, 0))
            powerup_rect = powerup_text.get_rect(topleft=(10, y_offset))
            screen.blit(powerup_text, powerup_rect)
            y_offset += 30

        if player.multi_shot_active:
            time_left = int(player.multi_shot_timer) + 1
            powerup_text = font.render(f"MULTI-SHOT: {time_left}s", True, (255, 165, 0))
            powerup_rect = powerup_text.get_rect(topleft=(10, y_offset))
            screen.blit(powerup_text, powerup_rect)
            y_offset += 30

        if player.shield_active:
            powerup_text = font.render("SHIELD: ACTIVE", True, (0, 255, 255))
            powerup_rect = powerup_text.get_rect(topleft=(10, y_offset))
            screen.blit(powerup_text, powerup_rect)
            y_offset += 30

        if slow_motion_active:
            time_left = int(slow_motion_timer) + 1
            powerup_text = font.render(f"SLOW MOTION: {time_left}s", True, (255, 0, 255))
            powerup_rect = powerup_text.get_rect(topleft=(10, y_offset))
            screen.blit(powerup_text, powerup_rect)


def draw_pause_screen(screen):
    """Draw the pause screen overlay"""
    # Semi-transparent overlay
    overlay = pygame.Surface((SCREEN_WIDTH, SCREEN_HEIGHT))
    overlay.set_alpha(150)
    overlay.fill((0, 0, 0))
    screen.blit(overlay, (0, 0))

    # Pause text
    font_large = pygame.font.Font(None, 100)
    font_small = pygame.font.Font(None, 40)
    font_tiny = pygame.font.Font(None, 32)

    pause_text = font_large.render("PAUSED", True, (255, 255, 255))
    pause_rect = pause_text.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 - 80))
    screen.blit(pause_text, pause_rect)

    # Instructions
    instruction_text = font_small.render("Press P to Resume", True, (200, 200, 200))
    instruction_rect = instruction_text.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 + 10))
    screen.blit(instruction_text, instruction_rect)

    # Quit instruction
    quit_text = font_tiny.render("Press Q to Quit", True, (180, 180, 180))
    quit_rect = quit_text.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 + 60))
    screen.blit(quit_text, quit_rect)


def draw_game_over_screen(screen, player1, player2, retry_delay=0, show_high_scores=False, p1_rank=None, p2_rank=None):
    """Draw the game over screen with retry button and optional high scores"""
    # Semi-transparent overlay
    overlay = pygame.Surface((SCREEN_WIDTH, SCREEN_HEIGHT))
    overlay.set_alpha(180)
    overlay.fill((0, 0, 0))
    screen.blit(overlay, (0, 0))

    # Game Over text
    font_large = pygame.font.Font(None, 74)
    font_small = pygame.font.Font(None, 36)
    font_tiny = pygame.font.Font(None, 24)

    game_over_text = font_large.render("GAME OVER", True, (255, 255, 255))
    game_over_rect = game_over_text.get_rect(
        center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 - 250))
    screen.blit(game_over_text, game_over_rect)

    # Final scores
    p1_score_text = font_small.render(
        f"Player 1: {player1.score}", True, (100, 200, 255))
    p1_score_rect = p1_score_text.get_rect(
        center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 - 190))
    screen.blit(p1_score_text, p1_score_rect)

    p2_score_text = font_small.render(
        f"Player 2: {player2.score}", True, (255, 200, 100))
    p2_score_rect = p2_score_text.get_rect(
        center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 - 150))
    screen.blit(p2_score_text, p2_score_rect)

    # Show high scores if requested
    if show_high_scores:
        high_scores = get_top_scores(5)

        # High scores title
        hs_title = font_small.render("HIGH SCORES", True, (255, 215, 0))
        hs_title_rect = hs_title.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 - 100))
        screen.blit(hs_title, hs_title_rect)

        # Display top 5 high scores
        y_offset = SCREEN_HEIGHT // 2 - 60
        for i, entry in enumerate(high_scores):
            rank = i + 1
            # Highlight if this is player 1's or player 2's rank
            if rank == p1_rank:
                rank_color = (100, 200, 255)  # Player 1 color
            elif rank == p2_rank:
                rank_color = (255, 200, 100)  # Player 2 color
            else:
                rank_color = (200, 200, 200)  # Default gray

            score_text = font_tiny.render(
                f"{rank}. {entry['player']}: {entry['score']}",
                True,
                rank_color
            )
            score_rect = score_text.get_rect(center=(SCREEN_WIDTH // 2, y_offset))
            screen.blit(score_text, score_rect)
            y_offset += 30

    # Retry button - positioned below high scores
    button_width = 200
    button_height = 60
    button_x = SCREEN_WIDTH // 2 - button_width // 2
    button_y = SCREEN_HEIGHT // 2 + 140
    button_rect = pygame.Rect(button_x, button_y, button_width, button_height)

    # Draw button - grayed out if delay is active
    if retry_delay > 0:
        button_color = (60, 60, 60)
        border_color = (100, 100, 100)
        text_color = (150, 150, 150)
    else:
        button_color = (100, 100, 100)
        border_color = (255, 255, 255)
        text_color = (255, 255, 255)

    pygame.draw.rect(screen, button_color, button_rect)
    pygame.draw.rect(screen, border_color, button_rect, 3)

    retry_text = font_small.render("RETRY", True, text_color)
    retry_text_rect = retry_text.get_rect(center=button_rect.center)
    screen.blit(retry_text, retry_text_rect)

    # Instructions - show countdown if delay is active
    if retry_delay > 0:
        countdown = int(retry_delay) + 1
        instruction_text = font_small.render(
            f"Wait {countdown}...", True, (150, 150, 150))
    else:
        instruction_text = font_small.render(
            "Press R or click RETRY", True, (200, 200, 200))
    instruction_rect = instruction_text.get_rect(
        center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 + 220))
    screen.blit(instruction_text, instruction_rect)

    # Quit instruction
    quit_text = font_tiny.render("Press Q to Quit", True, (180, 180, 180))
    quit_rect = quit_text.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 + 260))
    screen.blit(quit_text, quit_rect)

    return button_rect


def reset_game(updatable, player1_input=None, player2_input=None, speed_multiplier=1.0, player_count=2):
    """Reset all game objects for a new game"""
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
        # Single player - centered position
        player1 = Player(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2, player1_input, 1, speed_multiplier)
        player1.score = 0
        # Create a dummy player2 that's inactive
        player2 = Player(-1000, -1000, player2_input, 2, speed_multiplier)
        player2.lives = 0  # Inactive
        player2.score = 0
    else:
        # Two players at different positions (25% and 75% horizontally, centered vertically)
        player1 = Player(SCREEN_WIDTH * 0.25, SCREEN_HEIGHT // 2, player1_input, 1, speed_multiplier)
        player1.score = 0
        player2 = Player(SCREEN_WIDTH * 0.75, SCREEN_HEIGHT // 2, player2_input, 2, speed_multiplier)
        player2.score = 0

    # Create asteroid field
    field = AsteroidField()
    # Set players reference for UFO targeting
    field.players = [player1, player2]

    # Start first wave if wave system is enabled
    if WAVE_SYSTEM_ENABLED:
        field.start_wave(1)

    return player1, player2, field


async def main():
    print("Starting Asteroids!")
    print("Screen width:", SCREEN_WIDTH)
    print("Screen height:", SCREEN_HEIGHT)

    # Initialize mixer BEFORE pygame.init() with very low latency settings
    pygame.mixer.pre_init(frequency=22050, size=-16, channels=2, buffer=128)
    pygame.init()

    # Initialize joystick/gamepad support (desktop only)
    joysticks = []
    if not IS_WEB:
        pygame.joystick.init()
        joysticks = [pygame.joystick.Joystick(i) for i in range(pygame.joystick.get_count())]
        for joystick in joysticks:
            joystick.init()
            print(f"Gamepad detected: {joystick.get_name()}")
        if not joysticks:
            print("No gamepad detected - using keyboard controls only")
    else:
        print("Web build detected: gamepad support disabled, keyboard controls only.")

    screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
    pygame.display.set_caption("Asteroids Game")

    # Pre-load and process all sound effects at startup
    init_sounds()

    # Start background music (if enabled) - after display and sounds are loaded
    if BACKGROUND_MUSIC_ENABLED:
        start_background_music()

    clock = pygame.time.Clock()  # Create a clock to control the frame rate
    dt = 0

    updatable = pygame.sprite.Group()
    drawable = pygame.sprite.Group()
    asteroids = pygame.sprite.Group()
    shots = pygame.sprite.Group()
    powerups = pygame.sprite.Group()
    ufos = pygame.sprite.Group()  # Group for UFO enemies
    laser_beams = []  # List to track active laser beams

    Player.containers = (updatable, drawable)
    Asteroid.containers = (asteroids, updatable, drawable)
    AsteroidField.containers = (updatable,)
    Shot.containers = (shots, updatable, drawable)
    PowerUp.containers = (powerups, updatable, drawable)
    UFO.containers = (ufos, updatable, drawable)

    # Control configuration
    control_config = ControlConfig()
    config_phase = True  # Start with config screen

    # Create two players (will be recreated after config)
    player1, player2, asteroid_field_ref = reset_game(updatable)

    # Game state
    game_started = False  # Track if game has started (start screen)
    game_over = False
    game_over_retry_delay = 0  # Delay before accepting retry input
    show_high_scores = False  # Whether to show high scores on game over screen
    p1_highscore_rank = None  # Player 1's rank on high score board
    p2_highscore_rank = None  # Player 2's rank on high score board
    paused = False  # Track if game is paused
    button_rect = None
    slow_motion_active = False
    slow_motion_timer = 0
    music_sped_up = False

    # Combo system state (shared between players)
    combo_count = 0
    combo_timer = 0.0

    # Kill streak notifications
    active_streak_notification = None  # Currently displaying kill streak notification
    last_streak_milestone = 0  # Track last milestone to avoid duplicate notifications

    # Respawn positions for each player
    p1_spawn_x = SCREEN_WIDTH * 0.25
    p1_spawn_y = SCREEN_HEIGHT // 2
    p2_spawn_x = SCREEN_WIDTH * 0.75
    p2_spawn_y = SCREEN_HEIGHT // 2

    # Screen shake and particles
    screen_shake = 0.0
    screen_shake_cooldown = 0.0
    particles = []

    # Taunt animation
    taunt_animation = None

    # Progressive difficulty
    game_time = 0.0
    difficulty_timer = 0.0
    asteroid_speed_multiplier = 1.0

    # Starfield background
    starfield = Starfield(star_count=STARFIELD_STAR_COUNT) if STARFIELD_ENABLED else None

    # Friendly fire state (will be set from control config)
    friendly_fire_enabled = FRIENDLY_FIRE_ENABLED

    # Shared lives state (will be set from control config)
    shared_lives_enabled = SHARED_LIVES_ENABLED
    shared_lives_pool = SHARED_LIVES_POOL

    # Player death state (for revive system)
    player1_dead = False
    player2_dead = False

    # Wave system state
    current_wave = 1
    wave_break_active = False
    wave_break_timer = 0.0
    wave_duration_timer = 0.0  # Tracks how long current wave has been active
    asteroid_field_ref = None  # Reference to the asteroid field for wave management

    # Main game loop
    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False

            # Handle control config phase
            if config_phase:
                control_config.handle_event(event)
                if control_config.is_complete():
                    # Get configured inputs and recreate players
                    p1_input, p2_input = control_config.get_player_inputs()
                    speed_mult = control_config.get_speed_multiplier()
                    player_cnt = control_config.get_player_count()
                    friendly_fire_enabled = control_config.get_friendly_fire_enabled()
                    shared_lives_enabled = control_config.get_shared_lives_enabled()
                    player1, player2, asteroid_field_ref = reset_game(updatable, p1_input, p2_input, speed_mult, player_cnt)

                    # Set up shared lives if enabled
                    if shared_lives_enabled and player_cnt == 2:
                        player1.lives = shared_lives_pool
                        player2.lives = 0  # Player 2 doesn't have separate lives

                    config_phase = False
                continue  # Skip other event handling during config

            # Handle start screen
            if not game_started and event.type == pygame.KEYDOWN:
                if event.key == pygame.K_SPACE:
                    game_started = True

            # Handle start screen - gamepad button (A button on Xbox, X on PlayStation)
            if not game_started and event.type == pygame.JOYBUTTONDOWN:
                if event.button == 0:  # A button / X button
                    game_started = True

            # Handle pause toggle
            if game_started and not game_over and event.type == pygame.KEYDOWN:
                if event.key == pygame.K_p:
                    paused = not paused
                # Handle quit from pause menu
                elif event.key == pygame.K_q and paused:
                    running = False

            # Handle pause toggle - gamepad (Start button)
            if game_started and not game_over and event.type == pygame.JOYBUTTONDOWN:
                if event.button == 7:  # Start button on most controllers
                    paused = not paused

            # Handle retry button click (only if delay has expired)
            if game_over and game_over_retry_delay <= 0 and event.type == pygame.MOUSEBUTTONDOWN:
                if button_rect and button_rect.collidepoint(event.pos):
                    p1_input, p2_input = control_config.get_player_inputs()
                    speed_mult = control_config.get_speed_multiplier()
                    player_cnt = control_config.get_player_count()
                    player1, player2, asteroid_field_ref = reset_game(updatable, p1_input, p2_input, speed_mult, player_cnt)
                    game_over = False
                    player1_dead = False
                    player2_dead = False
                    game_over_retry_delay = 0
                    show_high_scores = False
                    p1_highscore_rank = None
                    p2_highscore_rank = None
                    combo_count = 0
                    combo_timer = 0.0
                    last_streak_milestone = 0
                    active_streak_notification = None
                    slow_motion_active = False
                    slow_motion_timer = 0
                    screen_shake = 0.0
                    screen_shake_cooldown = 0.0
                    particles = []
                    taunt_animation = None
                    game_time = 0.0
                    difficulty_timer = 0.0
                    asteroid_speed_multiplier = 1.0
                    laser_beams = []
                    current_wave = 1
                    wave_break_active = False
                    wave_break_timer = 0.0
                    wave_duration_timer = 0.0
                    if music_sped_up:
                        reset_music_speed()
                        music_sped_up = False

            # Handle retry key press (only if delay has expired)
            if game_over and game_over_retry_delay <= 0 and event.type == pygame.KEYDOWN:
                if event.key == pygame.K_r:
                    p1_input, p2_input = control_config.get_player_inputs()
                    speed_mult = control_config.get_speed_multiplier()
                    player_cnt = control_config.get_player_count()
                    player1, player2, asteroid_field_ref = reset_game(updatable, p1_input, p2_input, speed_mult, player_cnt)
                    game_over = False
                    player1_dead = False
                    player2_dead = False
                    game_over_retry_delay = 0
                    show_high_scores = False
                    p1_highscore_rank = None
                    p2_highscore_rank = None
                    combo_count = 0
                    combo_timer = 0.0
                    last_streak_milestone = 0
                    active_streak_notification = None
                    slow_motion_active = False
                    slow_motion_timer = 0
                    screen_shake = 0.0
                    screen_shake_cooldown = 0.0
                    particles = []
                    taunt_animation = None
                    game_time = 0.0
                    difficulty_timer = 0.0
                    asteroid_speed_multiplier = 1.0
                    laser_beams = []
                    current_wave = 1
                    wave_break_active = False
                    wave_break_timer = 0.0
                    wave_duration_timer = 0.0
                    if music_sped_up:
                        reset_music_speed()
                        music_sped_up = False
                # Handle quit from game over screen
                elif event.key == pygame.K_q:
                    running = False

            # Handle retry - gamepad button (A button, only if delay has expired)
            if game_over and game_over_retry_delay <= 0 and event.type == pygame.JOYBUTTONDOWN:
                if event.button == 0:  # A button / X button
                    p1_input, p2_input = control_config.get_player_inputs()
                    speed_mult = control_config.get_speed_multiplier()
                    player_cnt = control_config.get_player_count()
                    player1, player2, asteroid_field_ref = reset_game(updatable, p1_input, p2_input, speed_mult, player_cnt)
                    game_over = False
                    player1_dead = False
                    player2_dead = False
                    game_over_retry_delay = 0
                    show_high_scores = False
                    p1_highscore_rank = None
                    p2_highscore_rank = None
                    combo_count = 0
                    combo_timer = 0.0
                    last_streak_milestone = 0
                    active_streak_notification = None
                    slow_motion_active = False
                    slow_motion_timer = 0
                    screen_shake = 0.0
                    screen_shake_cooldown = 0.0
                    particles = []
                    taunt_animation = None
                    game_time = 0.0
                    difficulty_timer = 0.0
                    asteroid_speed_multiplier = 1.0
                    laser_beams = []
                    current_wave = 1
                    wave_break_active = False
                    wave_break_timer = 0.0
                    wave_duration_timer = 0.0
                    if music_sped_up:
                        reset_music_speed()
                        music_sped_up = False

        screen.fill((0, 0, 0))  # Fill the screen with black

        # Show control config screen first
        if config_phase:
            control_config.draw(screen)
        # Show start screen if game hasn't started
        elif not game_started:
            # Draw the game in the background (frozen)
            shake_offset = (0, 0)

            # Draw starfield
            if starfield:
                starfield.draw(screen)

            for sprite in drawable:
                sprite.draw(screen, shake_offset)

            # Draw start screen overlay
            draw_start_screen(screen)
        elif not game_over:
            # Only update game logic if not paused
            if not paused:
                # Update game time and difficulty
                game_time += dt
                difficulty_timer += dt

                # Increase asteroid speed every DIFFICULTY_INCREASE_INTERVAL seconds
                if difficulty_timer >= DIFFICULTY_INCREASE_INTERVAL:
                    difficulty_timer = 0.0
                    asteroid_speed_multiplier += DIFFICULTY_SPEED_INCREMENT
                    print(f"Difficulty increased! Asteroid speed multiplier: {asteroid_speed_multiplier:.2f}x")
                # Handle MEGA POWER music speed - ensure music state matches power-up state
                if MEGA_POWER_MUSIC_SPEEDUP_ENABLED:
                    should_have_fast_music = player1.mega_power_active or player2.mega_power_active
                    if should_have_fast_music != music_sped_up:
                        if should_have_fast_music:
                            set_music_speed(MEGA_POWER_MUSIC_SPEED)
                            music_sped_up = True
                        else:
                            reset_music_speed()
                            music_sped_up = False

                # Update combo timer
                if combo_timer > 0:
                    combo_timer -= dt
                    if combo_timer <= 0:
                        combo_count = 0
                        combo_timer = 0.0
                        last_streak_milestone = 0  # Reset streak milestone tracking

                # Update kill streak notification
                if active_streak_notification:
                    if not active_streak_notification.update(dt):
                        active_streak_notification = None

                # Update slow motion timer
                if slow_motion_active:
                    slow_motion_timer -= dt
                    if slow_motion_timer <= 0:
                        slow_motion_active = False

                # Update screen shake (decay over time)
                if screen_shake > 0:
                    screen_shake -= SCREEN_SHAKE_DECAY * dt
                    if screen_shake < 0:
                        screen_shake = 0

                # Update screen shake cooldown
                if screen_shake_cooldown > 0:
                    screen_shake_cooldown -= dt

                # Update starfield based on player movement
                if starfield:
                    starfield.update(player1, player2)

                # Update asteroid field (spawns new asteroids)
                for field in updatable:
                    if isinstance(field, AsteroidField):
                        field.update(dt)

                # Wave system management
                if WAVE_SYSTEM_ENABLED and asteroid_field_ref:
                    # Check if we're in a wave break
                    if wave_break_active:
                        wave_break_timer -= dt
                        if wave_break_timer <= 0:
                            # Start the next wave
                            current_wave += 1
                            asteroid_field_ref.start_wave(current_wave)
                            wave_break_active = False
                            wave_duration_timer = 0.0  # Reset wave timer
                    else:
                        # Track wave duration
                        wave_duration_timer += dt

                        # Check if all asteroids are cleared and wave spawning is done
                        # OR if maximum wave duration exceeded (keeps pace fast!)
                        wave_complete = asteroid_field_ref.asteroids_to_spawn == 0 and len(asteroids) == 0
                        wave_timeout = wave_duration_timer >= WAVE_MAX_DURATION

                        if (wave_complete or wave_timeout) and not wave_break_active:
                            # Start wave break
                            wave_break_active = True
                            wave_break_timer = WAVE_BREAK_DURATION
                            if wave_complete:
                                print(f"Wave {current_wave} cleared! Next wave in {WAVE_BREAK_DURATION} seconds...")
                            else:
                                print(f"Wave {current_wave} time limit reached! ({len(asteroids)} asteroids remaining)")
                                print(f"Next wave in {WAVE_BREAK_DURATION} seconds...")
                                # Destroy remaining asteroids (no points) to avoid overlap
                                for asteroid in list(asteroids):
                                    asteroid.kill()
                            wave_duration_timer = 0.0  # Reset timer

                # Check if UFO should spawn (wave system scheduled spawn)
                if UFO_ENABLED and asteroid_field_ref.ufo_spawn_scheduled:
                    if asteroid_field_ref.ufo_spawn_timer >= asteroid_field_ref.ufo_spawn_delay:
                        asteroid_field_ref.spawn_ufo(ufos)
                        asteroid_field_ref.ufo_spawn_scheduled = False

                # Update both players at normal speed (only if alive or shared lives)
                if not player1_dead or (shared_lives_enabled and player1.lives > 0):
                    player1.update(dt)
                if not player2_dead or (shared_lives_enabled and player1.lives > 0):
                    player2.update(dt)

                # Check for new laser beams from players
                if player1.pending_laser:
                    laser_beams.append(player1.pending_laser)
                    player1.pending_laser = None
                if player2.pending_laser:
                    laser_beams.append(player2.pending_laser)
                    player2.pending_laser = None

                # Check for boundary bounce effects for player 1
                if player1.bounce_info:
                    # Add screen shake for wall bounce only if cooldown expired
                    if screen_shake_cooldown <= 0:
                        screen_shake = min(screen_shake + BOUNDARY_SHAKE_AMOUNT, SCREEN_SHAKE_MAX)
                        screen_shake_cooldown = SCREEN_SHAKE_COOLDOWN

                    # Spawn particles in the bounce direction
                    for i in range(BOUNDARY_PARTICLE_COUNT):
                        # Create particles spreading out from the collision point
                        base_angle = player1.bounce_info['direction'].angle_to(pygame.Vector2(0, 1))
                        angle_spread = 60  # degrees of spread
                        angle = base_angle + random.uniform(-angle_spread/2, angle_spread/2)
                        velocity = pygame.Vector2(0, 1).rotate(angle) * PARTICLE_SPEED * 0.8
                        particle = Particle(player1.bounce_info['position'].x,
                                          player1.bounce_info['position'].y,
                                          velocity)
                        particles.append(particle)

                    # Clear bounce info after processing
                    player1.bounce_info = None

                # Check for boundary bounce effects for player 2
                if player2.bounce_info:
                    # Add screen shake for wall bounce only if cooldown expired
                    if screen_shake_cooldown <= 0:
                        screen_shake = min(screen_shake + BOUNDARY_SHAKE_AMOUNT, SCREEN_SHAKE_MAX)
                        screen_shake_cooldown = SCREEN_SHAKE_COOLDOWN

                    # Spawn particles in the bounce direction
                    for i in range(BOUNDARY_PARTICLE_COUNT):
                        base_angle = player2.bounce_info['direction'].angle_to(pygame.Vector2(0, 1))
                        angle_spread = 60
                        angle = base_angle + random.uniform(-angle_spread/2, angle_spread/2)
                        velocity = pygame.Vector2(0, 1).rotate(angle) * PARTICLE_SPEED * 0.8
                        particle = Particle(player2.bounce_info['position'].x,
                                          player2.bounce_info['position'].y,
                                          velocity)
                        particles.append(particle)

                    player2.bounce_info = None

                # Generate exhaust particles for player 1
                exhaust_info = player1.get_exhaust_info()
                if exhaust_info:
                    base_angle = exhaust_info['direction'].angle_to(pygame.Vector2(0, 1))
                    angle = base_angle + random.uniform(-EXHAUST_PARTICLE_SPREAD/2, EXHAUST_PARTICLE_SPREAD/2)
                    velocity = pygame.Vector2(0, 1).rotate(angle) * EXHAUST_PARTICLE_SPEED
                    particle = Particle(exhaust_info['position'].x,
                                      exhaust_info['position'].y,
                                      velocity)
                    particles.append(particle)

                # Generate exhaust particles for player 2
                exhaust_info = player2.get_exhaust_info()
                if exhaust_info:
                    base_angle = exhaust_info['direction'].angle_to(pygame.Vector2(0, 1))
                    angle = base_angle + random.uniform(-EXHAUST_PARTICLE_SPREAD/2, EXHAUST_PARTICLE_SPREAD/2)
                    velocity = pygame.Vector2(0, 1).rotate(angle) * EXHAUST_PARTICLE_SPEED
                    particle = Particle(exhaust_info['position'].x,
                                      exhaust_info['position'].y,
                                      velocity)
                    particles.append(particle)

                for shot in shots:
                    shot.update(dt)

                # Apply slow motion effect and difficulty multiplier to dt for asteroids
                base_dt = dt * asteroid_speed_multiplier
                asteroid_dt = base_dt * SLOW_MOTION_FACTOR if slow_motion_active else base_dt

                # Update asteroids at potentially slowed speed with difficulty
                for asteroid in asteroids:
                    asteroid.update(asteroid_dt, dt)

                # Update power-ups at normal speed
                for powerup in powerups:
                    powerup.update(dt)

                # Check collisions for both players
                for asteroid in asteroids:
                    # Skip collision check if asteroid is dying (playing death animation)
                    if asteroid.dying:
                        continue

                    # Player 1 collision (skip if dead)
                    if not player1_dead and player1.lives > 0 and player1.check_collision(asteroid):
                        # If player is boosting, ram through the asteroid
                        if player1.boost_active:
                            # Increase combo and check for kill streak
                            combo_count, last_streak_milestone, active_streak_notification = increment_combo_and_check_streak(
                                combo_count, last_streak_milestone, active_streak_notification
                            )
                            combo_timer = COMBO_TIMEOUT

                            # Calculate points with combo multiplier
                            base_points = asteroid.get_points()
                            multiplier = COMBO_MULTIPLIERS.get(combo_count, COMBO_MULTIPLIERS[5])
                            points_earned = int(base_points * multiplier)

                            # Award points
                            player1.score += points_earned

                            # Visual feedback
                            if combo_count > 1:
                                print(f"Player 1: +{points_earned} points! ({combo_count}x COMBO) [BOOST RAM]")
                            else:
                                print(f"Player 1: +{points_earned} points [BOOST RAM]")

                            # Destroy the asteroid
                            effect_info = asteroid.split()
                            if effect_info:
                                if screen_shake_cooldown <= 0:
                                    screen_shake = min(screen_shake + effect_info['shake_amount'], SCREEN_SHAKE_MAX)
                                    screen_shake_cooldown = SCREEN_SHAKE_COOLDOWN

                                # Spawn particles
                                for i in range(effect_info['particle_count']):
                                    angle = (360 / effect_info['particle_count']) * i + random.uniform(-15, 15)
                                    velocity = pygame.Vector2(0, 1).rotate(angle) * PARTICLE_SPEED
                                    particle = Particle(effect_info['position'].x, effect_info['position'].y, velocity)
                                    particles.append(particle)

                            # Chance to spawn power-up (if enabled)
                            if POWERUP_SPAWN_ENABLED:
                                if random.random() < MEGA_POWER_SPAWN_CHANCE:
                                    PowerUp(asteroid.position.x, asteroid.position.y, PowerUp.MEGA_POWER)
                                elif random.random() < POWERUP_SPAWN_CHANCE:
                                    powerup_types = [PowerUp.RAPID_FIRE, PowerUp.SHIELD, PowerUp.MULTI_SHOT, PowerUp.SLOW_MOTION]
                                    chosen_type = random.choice(powerup_types)
                                    PowerUp(asteroid.position.x, asteroid.position.y, chosen_type)
                        else:
                            # Normal collision - take damage
                            # Use take_damage to check if shield absorbed hit
                            if player1.take_damage():
                                if shared_lives_enabled:
                                    # Shared lives mode - deduct from pool
                                    player1.lives -= 1
                                    print(f"Player 1 hit! Shared lives remaining: {player1.lives}")

                                    if player1.lives > 0:
                                        # Respawn player 1
                                        player1.respawn(p1_spawn_x, p1_spawn_y)
                                    else:
                                        # Out of shared lives - mark both as dead
                                        print("Out of shared lives! Game over!")
                                        player1_dead = True
                                        player2_dead = True
                                        game_over = True
                                        game_over_retry_delay = 1.5
                                        taunt_animation = TauntAnimation()

                                        # Save high scores
                                        p1_is_high = is_high_score(player1.score) if player1.score > 0 else False
                                        p2_is_high = is_high_score(player2.score) if player2.score > 0 else False

                                        if player1.score > 0:
                                            p1_highscore_rank = add_score("Player 1", player1.score)
                                            if p1_highscore_rank:
                                                print(f"Player 1 achieved high score rank #{p1_highscore_rank}!")
                                        else:
                                            p1_highscore_rank = None

                                        if player2.score > 0:
                                            p2_highscore_rank = add_score("Player 2", player2.score)
                                            if p2_highscore_rank:
                                                print(f"Player 2 achieved high score rank #{p2_highscore_rank}!")
                                        else:
                                            p2_highscore_rank = None

                                        show_high_scores = (p1_is_high or p2_is_high)
                                        break
                                else:
                                    # Individual lives mode
                                    print(f"Player 1 hit! Lives remaining: {player1.lives}")
                                    if player1.lives > 0:
                                        # Respawn player 1
                                        player1.respawn(p1_spawn_x, p1_spawn_y)
                                    else:
                                        print("Player 1 eliminated!")
                                        player1_dead = True

                                        # Spawn revive power-up
                                        handle_player_death(player1, 1, player1.position.x, player1.position.y, shared_lives_enabled)

                                        # Check if both players are dead
                                        if player2.lives <= 0:
                                            print("Game over!")
                                            print(f"Player 1 Final Score: {player1.score}")
                                            print(f"Player 2 Final Score: {player2.score}")
                                            game_over = True
                                            game_over_retry_delay = 1.5
                                            taunt_animation = TauntAnimation()

                                            # Check if scores qualify for high score board BEFORE saving
                                            p1_is_high = is_high_score(player1.score) if player1.score > 0 else False
                                            p2_is_high = is_high_score(player2.score) if player2.score > 0 else False

                                            # Save high scores and store ranks
                                            if player1.score > 0:
                                                p1_highscore_rank = add_score("Player 1", player1.score)
                                                if p1_highscore_rank:
                                                    print(f"Player 1 achieved high score rank #{p1_highscore_rank}!")
                                            else:
                                                p1_highscore_rank = None

                                            if player2.score > 0:
                                                p2_highscore_rank = add_score("Player 2", player2.score)
                                                if p2_highscore_rank:
                                                    print(f"Player 2 achieved high score rank #{p2_highscore_rank}!")
                                            else:
                                                p2_highscore_rank = None

                                            # Show high scores if either player got one
                                            show_high_scores = (p1_is_high or p2_is_high)
                                            break
                            else:
                                print("Player 1 shield absorbed hit!")

                            # Destroy the asteroid that hit the player
                            effect_info = asteroid.split()
                            if effect_info:
                                if screen_shake_cooldown <= 0:
                                    screen_shake = min(screen_shake + effect_info['shake_amount'] * 0.5, SCREEN_SHAKE_MAX)
                                    screen_shake_cooldown = SCREEN_SHAKE_COOLDOWN

                                # Spawn particles
                                for i in range(effect_info['particle_count']):
                                    angle = (360 / effect_info['particle_count']) * i + random.uniform(-15, 15)
                                    velocity = pygame.Vector2(0, 1).rotate(angle) * PARTICLE_SPEED
                                    particle = Particle(effect_info['position'].x, effect_info['position'].y, velocity)
                                    particles.append(particle)
                        continue

                    # Player 2 collision (skip if dead)
                    if not player2_dead and player2.lives > 0 and player2.check_collision(asteroid):
                        # If player is boosting, ram through the asteroid
                        if player2.boost_active:
                            # Increase combo and check for kill streak
                            combo_count, last_streak_milestone, active_streak_notification = increment_combo_and_check_streak(
                                combo_count, last_streak_milestone, active_streak_notification
                            )
                            combo_timer = COMBO_TIMEOUT

                            # Calculate points with combo multiplier
                            base_points = asteroid.get_points()
                            multiplier = COMBO_MULTIPLIERS.get(combo_count, COMBO_MULTIPLIERS[5])
                            points_earned = int(base_points * multiplier)

                            # Award points
                            player2.score += points_earned

                            # Visual feedback
                            if combo_count > 1:
                                print(f"Player 2: +{points_earned} points! ({combo_count}x COMBO) [BOOST RAM]")
                            else:
                                print(f"Player 2: +{points_earned} points [BOOST RAM]")

                            # Destroy the asteroid
                            effect_info = asteroid.split()
                            if effect_info:
                                if screen_shake_cooldown <= 0:
                                    screen_shake = min(screen_shake + effect_info['shake_amount'], SCREEN_SHAKE_MAX)
                                    screen_shake_cooldown = SCREEN_SHAKE_COOLDOWN

                                # Spawn particles
                                for i in range(effect_info['particle_count']):
                                    angle = (360 / effect_info['particle_count']) * i + random.uniform(-15, 15)
                                    velocity = pygame.Vector2(0, 1).rotate(angle) * PARTICLE_SPEED
                                    particle = Particle(effect_info['position'].x, effect_info['position'].y, velocity)
                                    particles.append(particle)

                            # Chance to spawn power-up (if enabled)
                            if POWERUP_SPAWN_ENABLED:
                                if random.random() < MEGA_POWER_SPAWN_CHANCE:
                                    PowerUp(asteroid.position.x, asteroid.position.y, PowerUp.MEGA_POWER)
                                elif random.random() < POWERUP_SPAWN_CHANCE:
                                    powerup_types = [PowerUp.RAPID_FIRE, PowerUp.SHIELD, PowerUp.MULTI_SHOT, PowerUp.SLOW_MOTION]
                                    chosen_type = random.choice(powerup_types)
                                    PowerUp(asteroid.position.x, asteroid.position.y, chosen_type)
                        else:
                            # Normal collision - take damage
                            # Use take_damage to check if shield absorbed hit
                            if player2.take_damage():
                                if shared_lives_enabled:
                                    # Shared lives mode - deduct from pool
                                    player1.lives -= 1
                                    print(f"Player 2 hit! Shared lives remaining: {player1.lives}")

                                    if player1.lives > 0:
                                        # Respawn player 2
                                        player2.respawn(p2_spawn_x, p2_spawn_y)
                                    else:
                                        # Out of shared lives - mark both as dead
                                        print("Out of shared lives! Game over!")
                                        player1_dead = True
                                        player2_dead = True
                                        game_over = True
                                        game_over_retry_delay = 1.5
                                        taunt_animation = TauntAnimation()

                                        # Save high scores
                                        p1_is_high = is_high_score(player1.score) if player1.score > 0 else False
                                        p2_is_high = is_high_score(player2.score) if player2.score > 0 else False

                                        if player1.score > 0:
                                            p1_highscore_rank = add_score("Player 1", player1.score)
                                            if p1_highscore_rank:
                                                print(f"Player 1 achieved high score rank #{p1_highscore_rank}!")
                                        else:
                                            p1_highscore_rank = None

                                        if player2.score > 0:
                                            p2_highscore_rank = add_score("Player 2", player2.score)
                                            if p2_highscore_rank:
                                                print(f"Player 2 achieved high score rank #{p2_highscore_rank}!")
                                        else:
                                            p2_highscore_rank = None

                                        show_high_scores = (p1_is_high or p2_is_high)
                                        break
                                else:
                                    # Individual lives mode
                                    print(f"Player 2 hit! Lives remaining: {player2.lives}")
                                    if player2.lives > 0:
                                        # Respawn player 2
                                        player2.respawn(p2_spawn_x, p2_spawn_y)
                                    else:
                                        print("Player 2 eliminated!")
                                        player2_dead = True

                                        # Spawn revive power-up
                                        handle_player_death(player2, 2, player2.position.x, player2.position.y, shared_lives_enabled)

                                        # Check if both players are dead
                                        if player1.lives <= 0:
                                            print("Game over!")
                                            print(f"Player 1 Final Score: {player1.score}")
                                            print(f"Player 2 Final Score: {player2.score}")
                                            game_over = True
                                            game_over_retry_delay = 1.5
                                            taunt_animation = TauntAnimation()

                                            # Check if scores qualify for high score board BEFORE saving
                                            p1_is_high = is_high_score(player1.score) if player1.score > 0 else False
                                            p2_is_high = is_high_score(player2.score) if player2.score > 0 else False

                                            # Save high scores and store ranks
                                            if player1.score > 0:
                                                p1_highscore_rank = add_score("Player 1", player1.score)
                                                if p1_highscore_rank:
                                                    print(f"Player 1 achieved high score rank #{p1_highscore_rank}!")
                                            else:
                                                p1_highscore_rank = None

                                            if player2.score > 0:
                                                p2_highscore_rank = add_score("Player 2", player2.score)
                                                if p2_highscore_rank:
                                                    print(f"Player 2 achieved high score rank #{p2_highscore_rank}!")
                                            else:
                                                p2_highscore_rank = None

                                            # Show high scores if either player got one
                                            show_high_scores = (p1_is_high or p2_is_high)
                                            break
                            else:
                                print("Player 2 shield absorbed hit!")

                            # Destroy the asteroid that hit the player
                            effect_info = asteroid.split()
                            if effect_info:
                                if screen_shake_cooldown <= 0:
                                    screen_shake = min(screen_shake + effect_info['shake_amount'] * 0.5, SCREEN_SHAKE_MAX)
                                    screen_shake_cooldown = SCREEN_SHAKE_COOLDOWN

                                # Spawn particles
                                for i in range(effect_info['particle_count']):
                                    angle = (360 / effect_info['particle_count']) * i + random.uniform(-15, 15)
                                    velocity = pygame.Vector2(0, 1).rotate(angle) * PARTICLE_SPEED
                                    particle = Particle(effect_info['position'].x, effect_info['position'].y, velocity)
                                    particles.append(particle)
                        continue

                # Update particles
                particles = [p for p in particles if p.update(dt)]

                for asteroid in asteroids:
                    # Skip collision check if asteroid is dying (playing death animation)
                    if asteroid.dying:
                        continue
                    for shot in shots:
                        if asteroid.check_collision(shot):
                            # Increase combo and check for kill streak
                            combo_count, last_streak_milestone, active_streak_notification = increment_combo_and_check_streak(
                                combo_count, last_streak_milestone, active_streak_notification
                            )
                            combo_timer = COMBO_TIMEOUT

                            # Calculate points with combo multiplier
                            base_points = asteroid.get_points()
                            multiplier = COMBO_MULTIPLIERS.get(combo_count, COMBO_MULTIPLIERS[5])
                            points_earned = int(base_points * multiplier)

                            # Award points to the player who shot it
                            if shot.owner:
                                shot.owner.score += points_earned
                                player_name = f"Player {shot.owner.player_number}"
                            else:
                                player_name = "Unknown"

                            # Visual feedback for point value
                            if combo_count > 1:
                                print(f"{player_name}: +{points_earned} points! ({combo_count}x COMBO)")
                            else:
                                print(f"{player_name}: +{points_earned} points")

                            # Split the asteroid and get effect info
                            effect_info = asteroid.split()
                            if effect_info:
                                # Add screen shake only if cooldown expired (capped at max)
                                if screen_shake_cooldown <= 0:
                                    screen_shake = min(screen_shake + effect_info['shake_amount'], SCREEN_SHAKE_MAX)
                                    screen_shake_cooldown = SCREEN_SHAKE_COOLDOWN

                                # Spawn particles
                                for i in range(effect_info['particle_count']):
                                    angle = (360 / effect_info['particle_count']) * i + random.uniform(-15, 15)
                                    velocity = pygame.Vector2(0, 1).rotate(angle) * PARTICLE_SPEED
                                    particle = Particle(effect_info['position'].x, effect_info['position'].y, velocity)
                                    particles.append(particle)

                            shot.kill()

                            # Chance to spawn power-up (if enabled)
                            if POWERUP_SPAWN_ENABLED:
                                # First check for rare MEGA POWER
                                if random.random() < MEGA_POWER_SPAWN_CHANCE:
                                    PowerUp(asteroid.position.x, asteroid.position.y, PowerUp.MEGA_POWER)
                                elif random.random() < POWERUP_SPAWN_CHANCE:
                                    # Randomly choose a normal power-up type
                                    powerup_types = [PowerUp.RAPID_FIRE, PowerUp.SHIELD, PowerUp.MULTI_SHOT, PowerUp.SLOW_MOTION]
                                    chosen_type = random.choice(powerup_types)
                                    PowerUp(asteroid.position.x, asteroid.position.y, chosen_type)

                            break

                # Update and check laser beam collisions
                laser_beams_to_remove = []
                for laser in laser_beams:
                    if not laser.update(dt):
                        laser_beams_to_remove.append(laser)
                        continue

                    # Check collisions with all asteroids
                    for asteroid in asteroids:
                        if asteroid.dying:
                            continue

                        if laser.check_hit(asteroid):
                            # Increase combo and check for kill streak
                            combo_count, last_streak_milestone, active_streak_notification = increment_combo_and_check_streak(
                                combo_count, last_streak_milestone, active_streak_notification
                            )
                            combo_timer = COMBO_TIMEOUT

                            # Calculate points with combo multiplier
                            base_points = asteroid.get_points()
                            multiplier = COMBO_MULTIPLIERS.get(combo_count, COMBO_MULTIPLIERS[5])
                            points_earned = int(base_points * multiplier)

                            # Award points to the player who shot the laser
                            if laser.owner:
                                laser.owner.score += points_earned
                                player_name = f"Player {laser.owner.player_number}"
                            else:
                                player_name = "Unknown"

                            # Visual feedback
                            if combo_count > 1:
                                print(f"{player_name}: +{points_earned} points! ({combo_count}x COMBO)")
                            else:
                                print(f"{player_name}: +{points_earned} points")

                            # Split the asteroid
                            effect_info = asteroid.split()
                            if effect_info:
                                if screen_shake_cooldown <= 0:
                                    screen_shake = min(screen_shake + effect_info['shake_amount'], SCREEN_SHAKE_MAX)
                                    screen_shake_cooldown = SCREEN_SHAKE_COOLDOWN

                                # Spawn particles
                                for i in range(effect_info['particle_count']):
                                    angle = (360 / effect_info['particle_count']) * i + random.uniform(-15, 15)
                                    velocity = pygame.Vector2(0, 1).rotate(angle) * PARTICLE_SPEED
                                    particle = Particle(effect_info['position'].x, effect_info['position'].y, velocity)
                                    particles.append(particle)

                            # Chance to spawn power-up (if enabled)
                            if POWERUP_SPAWN_ENABLED:
                                if random.random() < MEGA_POWER_SPAWN_CHANCE:
                                    PowerUp(asteroid.position.x, asteroid.position.y, PowerUp.MEGA_POWER)
                                elif random.random() < POWERUP_SPAWN_CHANCE:
                                    powerup_types = [PowerUp.RAPID_FIRE, PowerUp.SHIELD, PowerUp.MULTI_SHOT, PowerUp.SLOW_MOTION]
                                    chosen_type = random.choice(powerup_types)
                                    PowerUp(asteroid.position.x, asteroid.position.y, chosen_type)

                # Remove expired laser beams
                for laser in laser_beams_to_remove:
                    laser_beams.remove(laser)

                # === UFO COLLISIONS ===
                # Check UFO collisions with player shots
                for ufo in list(ufos):  # Use list() to avoid modification during iteration
                    for shot in shots:
                        # Skip UFO shots (they shouldn't destroy UFOs)
                        if isinstance(shot.owner, UFO):
                            continue

                        if ufo.check_collision(shot):
                            # Determine points based on UFO type
                            points = UFO_LARGE_POINTS if ufo.ufo_type == "large" else UFO_SMALL_POINTS

                            # Award points to shooter
                            if shot.owner:
                                shot.owner.score += points
                                player_name = f"Player {shot.owner.player_number}"
                                print(f"{player_name}: UFO destroyed! +{points} points")

                            # Screen shake effect
                            if screen_shake_cooldown <= 0:
                                screen_shake = min(screen_shake + 6, SCREEN_SHAKE_MAX)
                                screen_shake_cooldown = SCREEN_SHAKE_COOLDOWN

                            # Spawn particles at UFO position
                            particle_count = 10
                            for i in range(particle_count):
                                angle = (360 / particle_count) * i + random.uniform(-15, 15)
                                velocity = pygame.Vector2(0, 1).rotate(angle) * PARTICLE_SPEED
                                particle = Particle(ufo.position.x, ufo.position.y, velocity)
                                particles.append(particle)

                            # Always spawn a power-up (guaranteed drop from UFOs)
                            powerup_types = [PowerUp.RAPID_FIRE, PowerUp.SHIELD, PowerUp.MULTI_SHOT, PowerUp.SLOW_MOTION]
                            chosen_type = random.choice(powerup_types)
                            PowerUp(ufo.position.x, ufo.position.y, chosen_type)

                            # Destroy UFO and shot
                            ufo.kill()
                            shot.kill()
                            break

                # Check UFO collisions with players
                for ufo in ufos:
                    # Player 1 collision
                    if not player1_dead and player1.lives > 0 and player1.check_collision(ufo):
                        # If player is boosting, destroy the UFO
                        if player1.boost_active:
                            points = UFO_LARGE_POINTS if ufo.ufo_type == "large" else UFO_SMALL_POINTS
                            player1.score += points
                            print(f"Player 1: UFO destroyed by boost! +{points} points")

                            # Effects
                            if screen_shake_cooldown <= 0:
                                screen_shake = min(screen_shake + 6, SCREEN_SHAKE_MAX)
                                screen_shake_cooldown = SCREEN_SHAKE_COOLDOWN

                            # Particles
                            for i in range(10):
                                angle = (360 / 10) * i + random.uniform(-15, 15)
                                velocity = pygame.Vector2(0, 1).rotate(angle) * PARTICLE_SPEED
                                particle = Particle(ufo.position.x, ufo.position.y, velocity)
                                particles.append(particle)

                            # Guaranteed power-up
                            powerup_types = [PowerUp.RAPID_FIRE, PowerUp.SHIELD, PowerUp.MULTI_SHOT, PowerUp.SLOW_MOTION]
                            chosen_type = random.choice(powerup_types)
                            PowerUp(ufo.position.x, ufo.position.y, chosen_type)

                            ufo.kill()
                        else:
                            # Normal collision - take damage
                            if player1.take_damage():
                                if shared_lives_enabled:
                                    player1.lives -= 1
                                    print(f"Player 1 hit by UFO! Shared lives remaining: {player1.lives}")
                                    if player1.lives > 0:
                                        player1.respawn(p1_spawn_x, p1_spawn_y)
                                    else:
                                        print("Out of shared lives! Game over!")
                                        player1_dead = True
                                        player2_dead = True
                                        game_over = True
                                        game_over_retry_delay = 1.5
                                        taunt_animation = TauntAnimation()
                                else:
                                    player1.lives -= 1
                                    print(f"Player 1 hit by UFO! Lives remaining: {player1.lives}")
                                    if player1.lives > 0:
                                        player1.respawn(p1_spawn_x, p1_spawn_y)
                                    else:
                                        player1_dead = True
                                        # Check if both players dead for game over
                                        if player1_dead and player2_dead:
                                            game_over = True
                                            game_over_retry_delay = 1.5
                                            taunt_animation = TauntAnimation()

                    # Player 2 collision
                    if not player2_dead and player2.lives > 0 and player2.check_collision(ufo):
                        if player2.boost_active:
                            points = UFO_LARGE_POINTS if ufo.ufo_type == "large" else UFO_SMALL_POINTS
                            player2.score += points
                            print(f"Player 2: UFO destroyed by boost! +{points} points")

                            if screen_shake_cooldown <= 0:
                                screen_shake = min(screen_shake + 6, SCREEN_SHAKE_MAX)
                                screen_shake_cooldown = SCREEN_SHAKE_COOLDOWN

                            for i in range(10):
                                angle = (360 / 10) * i + random.uniform(-15, 15)
                                velocity = pygame.Vector2(0, 1).rotate(angle) * PARTICLE_SPEED
                                particle = Particle(ufo.position.x, ufo.position.y, velocity)
                                particles.append(particle)

                            powerup_types = [PowerUp.RAPID_FIRE, PowerUp.SHIELD, PowerUp.MULTI_SHOT, PowerUp.SLOW_MOTION]
                            chosen_type = random.choice(powerup_types)
                            PowerUp(ufo.position.x, ufo.position.y, chosen_type)

                            ufo.kill()
                        else:
                            if player2.take_damage():
                                if shared_lives_enabled:
                                    player1.lives -= 1  # Shared lives use player1.lives
                                    print(f"Player 2 hit by UFO! Shared lives remaining: {player1.lives}")
                                    if player1.lives > 0:
                                        player2.respawn(p2_spawn_x, p2_spawn_y)
                                    else:
                                        print("Out of shared lives! Game over!")
                                        player1_dead = True
                                        player2_dead = True
                                        game_over = True
                                        game_over_retry_delay = 1.5
                                        taunt_animation = TauntAnimation()
                                else:
                                    player2.lives -= 1
                                    print(f"Player 2 hit by UFO! Lives remaining: {player2.lives}")
                                    if player2.lives > 0:
                                        player2.respawn(p2_spawn_x, p2_spawn_y)
                                    else:
                                        player2_dead = True
                                        if player1_dead and player2_dead:
                                            game_over = True
                                            game_over_retry_delay = 1.5
                                            taunt_animation = TauntAnimation()

                # Check UFO shots hitting players
                for shot in list(shots):
                    # Only check UFO shots (owner is a UFO)
                    if not isinstance(shot.owner, UFO):
                        continue

                    # Check Player 1
                    if not player1_dead and player1.lives > 0 and player1.check_collision(shot):
                        if player1.take_damage():
                            if shared_lives_enabled:
                                player1.lives -= 1
                                print(f"Player 1 hit by UFO shot! Shared lives remaining: {player1.lives}")
                                if player1.lives > 0:
                                    player1.respawn(p1_spawn_x, p1_spawn_y)
                                else:
                                    print("Out of shared lives! Game over!")
                                    player1_dead = True
                                    player2_dead = True
                                    game_over = True
                                    game_over_retry_delay = 1.5
                                    taunt_animation = TauntAnimation()
                            else:
                                player1.lives -= 1
                                print(f"Player 1 hit by UFO shot! Lives remaining: {player1.lives}")
                                if player1.lives > 0:
                                    player1.respawn(p1_spawn_x, p1_spawn_y)
                                else:
                                    player1_dead = True
                                    if player1_dead and player2_dead:
                                        game_over = True
                                        game_over_retry_delay = 1.5
                                        taunt_animation = TauntAnimation()
                        shot.kill()

                    # Check Player 2
                    if not player2_dead and player2.lives > 0 and player2.check_collision(shot):
                        if player2.take_damage():
                            if shared_lives_enabled:
                                player1.lives -= 1
                                print(f"Player 2 hit by UFO shot! Shared lives remaining: {player1.lives}")
                                if player1.lives > 0:
                                    player2.respawn(p2_spawn_x, p2_spawn_y)
                                else:
                                    print("Out of shared lives! Game over!")
                                    player1_dead = True
                                    player2_dead = True
                                    game_over = True
                                    game_over_retry_delay = 1.5
                                    taunt_animation = TauntAnimation()
                            else:
                                player2.lives -= 1
                                print(f"Player 2 hit by UFO shot! Lives remaining: {player2.lives}")
                                if player2.lives > 0:
                                    player2.respawn(p2_spawn_x, p2_spawn_y)
                                else:
                                    player2_dead = True
                                    if player1_dead and player2_dead:
                                        game_over = True
                                        game_over_retry_delay = 1.5
                                        taunt_animation = TauntAnimation()
                        shot.kill()

                # Check for power-up collection for both players
                for powerup in powerups:
                    collected = False

                    # Player 1 collection (only if alive)
                    if not player1_dead and player1.lives > 0 and player1.check_collision(powerup):
                        if powerup.powerup_type == PowerUp.MEGA_POWER:
                            player1.activate_mega_power()
                            slow_motion_active = True
                            slow_motion_timer = MEGA_POWER_DURATION
                            print("Player 1: MEGA POWER ACTIVATED!")
                        elif powerup.powerup_type == PowerUp.RAPID_FIRE:
                            player1.activate_rapid_fire()
                            print("Player 1: Rapid Fire!")
                        elif powerup.powerup_type == PowerUp.SHIELD:
                            player1.activate_shield()
                            print("Player 1: Shield!")
                        elif powerup.powerup_type == PowerUp.MULTI_SHOT:
                            player1.activate_multi_shot()
                            print("Player 1: Multi-Shot!")
                        elif powerup.powerup_type == PowerUp.SLOW_MOTION:
                            slow_motion_active = True
                            slow_motion_timer = SLOW_MOTION_DURATION
                            print("Player 1: Slow Motion!")
                        elif powerup.powerup_type == PowerUp.REVIVE:
                            # Revive dead player
                            if player2_dead and player2.lives == 0:
                                player2.lives = 3  # Revive with 3 lives
                                player2.respawn(p2_spawn_x, p2_spawn_y)
                                player2_dead = False
                                print("Player 1 revived Player 2!")
                            elif player1_dead:
                                print("Player 1 can't revive themselves!")
                            else:
                                print("Player 1: No one to revive!")
                        collected = True

                    # Player 2 collection (only if alive)
                    if not collected and not player2_dead and player2.lives > 0 and player2.check_collision(powerup):
                        if powerup.powerup_type == PowerUp.MEGA_POWER:
                            player2.activate_mega_power()
                            slow_motion_active = True
                            slow_motion_timer = MEGA_POWER_DURATION
                            print("Player 2: MEGA POWER ACTIVATED!")
                        elif powerup.powerup_type == PowerUp.RAPID_FIRE:
                            player2.activate_rapid_fire()
                            print("Player 2: Rapid Fire!")
                        elif powerup.powerup_type == PowerUp.SHIELD:
                            player2.activate_shield()
                            print("Player 2: Shield!")
                        elif powerup.powerup_type == PowerUp.MULTI_SHOT:
                            player2.activate_multi_shot()
                            print("Player 2: Multi-Shot!")
                        elif powerup.powerup_type == PowerUp.SLOW_MOTION:
                            slow_motion_active = True
                            slow_motion_timer = SLOW_MOTION_DURATION
                            print("Player 2: Slow Motion!")
                        elif powerup.powerup_type == PowerUp.REVIVE:
                            # Revive dead player
                            if player1_dead and player1.lives == 0:
                                player1.lives = 3  # Revive with 3 lives
                                player1.respawn(p1_spawn_x, p1_spawn_y)
                                player1_dead = False
                                print("Player 2 revived Player 1!")
                            elif player2_dead:
                                print("Player 2 can't revive themselves!")
                            else:
                                print("Player 2: No one to revive!")
                        collected = True

                    if collected:
                        powerup.kill()

                # Friendly fire - check if shots hit players
                if friendly_fire_enabled:
                    for shot in shots.copy():  # Use copy to avoid modification during iteration
                        # Check if shot hits Player 1 (skip if dead)
                        if shot.owner != player1 and not player1_dead and player1.lives > 0 and player1.check_collision(shot):
                            # Use take_damage to check if shield absorbed hit
                            if player1.take_damage():
                                print(f"Player 1 hit by Player {shot.owner.player_number}'s shot! Lives remaining: {player1.lives}")
                                if player1.lives > 0:
                                    # Respawn player 1
                                    player1.respawn(p1_spawn_x, p1_spawn_y)
                                else:
                                    print("Player 1 eliminated by friendly fire!")
                                    # Check if both players are dead
                                    if player2.lives <= 0:
                                        print("Game over!")
                                        print(f"Player 1 Final Score: {player1.score}")
                                        print(f"Player 2 Final Score: {player2.score}")
                                        game_over = True
                                        game_over_retry_delay = 1.5
                                        taunt_animation = TauntAnimation()

                                        # Check if scores qualify for high score board BEFORE saving
                                        p1_is_high = is_high_score(player1.score) if player1.score > 0 else False
                                        p2_is_high = is_high_score(player2.score) if player2.score > 0 else False

                                        # Save high scores and store ranks
                                        if player1.score > 0:
                                            p1_highscore_rank = add_score("Player 1", player1.score)
                                            if p1_highscore_rank:
                                                print(f"Player 1 achieved high score rank #{p1_highscore_rank}!")
                                        else:
                                            p1_highscore_rank = None

                                        if player2.score > 0:
                                            p2_highscore_rank = add_score("Player 2", player2.score)
                                            if p2_highscore_rank:
                                                print(f"Player 2 achieved high score rank #{p2_highscore_rank}!")
                                        else:
                                            p2_highscore_rank = None

                                        # Show high scores if either player got one
                                        show_high_scores = (p1_is_high or p2_is_high)
                            else:
                                print("Player 1 shield absorbed friendly fire!")
                            shot.kill()
                            continue

                        # Check if shot hits Player 2 (skip if dead)
                        if shot.owner != player2 and not player2_dead and player2.lives > 0 and player2.check_collision(shot):
                            # Use take_damage to check if shield absorbed hit
                            if player2.take_damage():
                                print(f"Player 2 hit by Player {shot.owner.player_number}'s shot! Lives remaining: {player2.lives}")
                                if player2.lives > 0:
                                    # Respawn player 2
                                    player2.respawn(p2_spawn_x, p2_spawn_y)
                                else:
                                    print("Player 2 eliminated by friendly fire!")
                                    # Check if both players are dead
                                    if player1.lives <= 0:
                                        print("Game over!")
                                        print(f"Player 1 Final Score: {player1.score}")
                                        print(f"Player 2 Final Score: {player2.score}")
                                        game_over = True
                                        game_over_retry_delay = 1.5
                                        taunt_animation = TauntAnimation()

                                        # Check if scores qualify for high score board BEFORE saving
                                        p1_is_high = is_high_score(player1.score) if player1.score > 0 else False
                                        p2_is_high = is_high_score(player2.score) if player2.score > 0 else False

                                        # Save high scores and store ranks
                                        if player1.score > 0:
                                            p1_highscore_rank = add_score("Player 1", player1.score)
                                            if p1_highscore_rank:
                                                print(f"Player 1 achieved high score rank #{p1_highscore_rank}!")
                                        else:
                                            p1_highscore_rank = None

                                        if player2.score > 0:
                                            p2_highscore_rank = add_score("Player 2", player2.score)
                                            if p2_highscore_rank:
                                                print(f"Player 2 achieved high score rank #{p2_highscore_rank}!")
                                        else:
                                            p2_highscore_rank = None

                                        # Show high scores if either player got one
                                        show_high_scores = (p1_is_high or p2_is_high)
                            else:
                                print("Player 2 shield absorbed friendly fire!")
                            shot.kill()
                            continue

                # Friendly fire - check if laser beams hit players
                if friendly_fire_enabled:
                    for laser in laser_beams.copy():  # Use copy to avoid modification during iteration
                        # Check if laser hits Player 1 (skip if dead)
                        if laser.owner != player1 and not player1_dead and player1.lives > 0 and laser.check_hit(player1):
                            # Use take_damage to check if shield absorbed hit
                            if player1.take_damage():
                                print(f"Player 1 hit by Player {laser.owner.player_number}'s laser! Lives remaining: {player1.lives}")
                                if player1.lives > 0:
                                    # Respawn player 1
                                    player1.respawn(p1_spawn_x, p1_spawn_y)
                                else:
                                    print("Player 1 eliminated by laser!")
                                    # Check if both players are dead
                                    if player2.lives <= 0:
                                        print("Game over!")
                                        print(f"Player 1 Final Score: {player1.score}")
                                        print(f"Player 2 Final Score: {player2.score}")
                                        game_over = True
                                        game_over_retry_delay = 1.5
                                        taunt_animation = TauntAnimation()

                                        # Check if scores qualify for high score board BEFORE saving
                                        p1_is_high = is_high_score(player1.score) if player1.score > 0 else False
                                        p2_is_high = is_high_score(player2.score) if player2.score > 0 else False

                                        # Save high scores and store ranks
                                        if player1.score > 0:
                                            p1_highscore_rank = add_score("Player 1", player1.score)
                                            if p1_highscore_rank:
                                                print(f"Player 1 achieved high score rank #{p1_highscore_rank}!")
                                        else:
                                            p1_highscore_rank = None

                                        if player2.score > 0:
                                            p2_highscore_rank = add_score("Player 2", player2.score)
                                            if p2_highscore_rank:
                                                print(f"Player 2 achieved high score rank #{p2_highscore_rank}!")
                                        else:
                                            p2_highscore_rank = None

                                        # Show high scores if either player got one
                                        show_high_scores = (p1_is_high or p2_is_high)
                            else:
                                print("Player 1 shield absorbed laser!")
                            # Don't remove laser, it continues through
                            continue

                        # Check if laser hits Player 2 (skip if dead)
                        if laser.owner != player2 and not player2_dead and player2.lives > 0 and laser.check_hit(player2):
                            # Use take_damage to check if shield absorbed hit
                            if player2.take_damage():
                                print(f"Player 2 hit by Player {laser.owner.player_number}'s laser! Lives remaining: {player2.lives}")
                                if player2.lives > 0:
                                    # Respawn player 2
                                    player2.respawn(p2_spawn_x, p2_spawn_y)
                                else:
                                    print("Player 2 eliminated by laser!")
                                    # Check if both players are dead
                                    if player1.lives <= 0:
                                        print("Game over!")
                                        print(f"Player 1 Final Score: {player1.score}")
                                        print(f"Player 2 Final Score: {player2.score}")
                                        game_over = True
                                        game_over_retry_delay = 1.5
                                        taunt_animation = TauntAnimation()

                                        # Check if scores qualify for high score board BEFORE saving
                                        p1_is_high = is_high_score(player1.score) if player1.score > 0 else False
                                        p2_is_high = is_high_score(player2.score) if player2.score > 0 else False

                                        # Save high scores and store ranks
                                        if player1.score > 0:
                                            p1_highscore_rank = add_score("Player 1", player1.score)
                                            if p1_highscore_rank:
                                                print(f"Player 1 achieved high score rank #{p1_highscore_rank}!")
                                        else:
                                            p1_highscore_rank = None

                                        if player2.score > 0:
                                            p2_highscore_rank = add_score("Player 2", player2.score)
                                            if p2_highscore_rank:
                                                print(f"Player 2 achieved high score rank #{p2_highscore_rank}!")
                                        else:
                                            p2_highscore_rank = None

                                        # Show high scores if either player got one
                                        show_high_scores = (p1_is_high or p2_is_high)
                            else:
                                print("Player 2 shield absorbed laser!")
                            # Don't remove laser, it continues through
                            continue

            # Calculate screen shake offset (regardless of pause state for drawing)
            shake_offset = (0, 0)
            if screen_shake > 0:
                shake_offset = (
                    random.uniform(-screen_shake, screen_shake),
                    random.uniform(-screen_shake, screen_shake)
                )

            # Draw starfield first (background layer)
            if starfield:
                starfield.draw(screen)

            # Draw all sprites with shake offset
            for sprite in drawable:
                sprite.draw(screen, shake_offset)

            # Draw particles with shake offset
            for particle in particles:
                particle.draw(screen, shake_offset)

            # Draw laser beams with shake offset
            for laser in laser_beams:
                laser.draw(screen, shake_offset)

            # Draw scores and lives for both players
            draw_scores(screen, player1, player2, shared_lives_enabled)
            # Draw combo
            draw_combo(screen, combo_count, combo_timer)
            # Draw wave info if wave system is enabled
            if WAVE_SYSTEM_ENABLED:
                draw_wave_info(screen, current_wave, wave_break_active, wave_break_timer,
                             wave_duration_timer, WAVE_MAX_DURATION)
            # Draw kill streak notification if active
            if active_streak_notification:
                active_streak_notification.draw(screen)
            # Draw power-up indicators for player 1 (left side)
            draw_powerup_indicator(screen, player1, slow_motion_active, slow_motion_timer)

            # Draw pause overlay if paused
            if paused:
                draw_pause_screen(screen)
        else:
            # Update game over retry delay timer
            if game_over_retry_delay > 0:
                game_over_retry_delay -= dt
                if game_over_retry_delay < 0:
                    game_over_retry_delay = 0

            # Draw frozen game state (no shake on game over)
            shake_offset = (0, 0)

            # Draw starfield
            if starfield:
                starfield.draw(screen)

            for sprite in drawable:
                sprite.draw(screen, shake_offset)

            # Draw particles even when game is over
            particles = [p for p in particles if p.update(dt)]
            for particle in particles:
                particle.draw(screen, shake_offset)

            # Draw scores on frozen game
            draw_scores(screen, player1, player2, shared_lives_enabled)
            # Draw power-up indicators on frozen game
            draw_powerup_indicator(screen, player1, slow_motion_active, slow_motion_timer)

            # Draw game over screen (pass retry delay and high scores flag)
            button_rect = draw_game_over_screen(screen, player1, player2, game_over_retry_delay, show_high_scores, p1_highscore_rank, p2_highscore_rank)

            # Update and draw taunt animation LAST (so it's on top)
            if taunt_animation:
                if not taunt_animation.update(dt):
                    taunt_animation = None
                else:
                    taunt_animation.draw(screen)

        pygame.display.flip()  # Update the display
        dt = clock.tick(60) / 1000  # Limit the frame rate to 60 FPS
        await asyncio.sleep(0)  # Allow browser to process events


if __name__ == "__main__":
    asyncio.run(main())
