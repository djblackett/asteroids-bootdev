# this allows us to use code from
# the open-source pygame library
# throughout this file
from asteroid import Asteroid
from constants import (ASTEROID_MAX_RADIUS, ASTEROID_MIN_RADIUS, ASTEROID_SPAWN_RATE,
                      SCREEN_HEIGHT, SCREEN_WIDTH, MEGA_POWER_MUSIC_SPEEDUP_ENABLED,
                      BOUNDARY_PARTICLE_COUNT, BOUNDARY_SHAKE_AMOUNT, PARTICLE_SPEED,
                      EXHAUST_PARTICLE_SPEED, EXHAUST_PARTICLE_SPREAD)
from player import Player
import pygame
from constants import *
from asteroidfield import AsteroidField
from shot import Shot
from soundeffects import start_background_music, init_sounds, set_music_speed, reset_music_speed
from powerup import PowerUp
from particle import Particle
from taunt import TauntAnimation
from startscreen import draw_start_screen
from controlconfig import ControlConfig
from highscores import add_score, is_high_score, get_top_scores
import random


def draw_scores(screen, player1, player2):
    """Draw scores and lives for both players"""
    font = pygame.font.Font(None, 36)

    # Player 1 - Top left
    p1_color = (100, 200, 255) if player1.lives > 0 else (100, 100, 100)
    p1_score_text = font.render(f"P1: {player1.score}", True, p1_color)
    screen.blit(p1_score_text, (10, 10))

    # Player 1 lives
    lives_text = font.render(f"Lives: {player1.lives}", True, p1_color)
    screen.blit(lives_text, (10, 45))

    # Player 2 - Top right
    p2_color = (255, 200, 100) if player2.lives > 0 else (100, 100, 100)
    p2_score_text = font.render(f"P2: {player2.score}", True, p2_color)
    p2_score_rect = p2_score_text.get_rect(topright=(SCREEN_WIDTH - 10, 10))
    screen.blit(p2_score_text, p2_score_rect)

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


def draw_powerup_indicator(screen, player, slow_motion_active, slow_motion_timer):
    """Draw power-up status indicators"""
    font = pygame.font.Font(None, 28)
    font_large = pygame.font.Font(None, 40)
    y_offset = 80  # Moved down to make room for lives display

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
        screen.blit(powerup_text, (10, y_offset))
        y_offset += 45
    else:
        # Show individual power-ups only if MEGA POWER is not active
        if player.rapid_fire_active:
            time_left = int(player.rapid_fire_timer) + 1
            powerup_text = font.render(f"RAPID FIRE: {time_left}s", True, (255, 255, 0))
            screen.blit(powerup_text, (10, y_offset))
            y_offset += 30

        if player.multi_shot_active:
            time_left = int(player.multi_shot_timer) + 1
            powerup_text = font.render(f"MULTI-SHOT: {time_left}s", True, (255, 165, 0))
            screen.blit(powerup_text, (10, y_offset))
            y_offset += 30

        if player.shield_active:
            powerup_text = font.render("SHIELD: ACTIVE", True, (0, 255, 255))
            screen.blit(powerup_text, (10, y_offset))
            y_offset += 30

        if slow_motion_active:
            time_left = int(slow_motion_timer) + 1
            powerup_text = font.render(f"SLOW MOTION: {time_left}s", True, (255, 0, 255))
            screen.blit(powerup_text, (10, y_offset))


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


def draw_game_over_screen(screen, player1, player2, retry_delay=0, show_high_scores=False):
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
            rank_color = (255, 215, 0) if i == 0 else (200, 200, 200)
            score_text = font_tiny.render(
                f"{i+1}. {entry['player']}: {entry['score']}",
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
    AsteroidField()

    return player1, player2


def main():
    print("Starting Asteroids!")
    print("Screen width:", SCREEN_WIDTH)
    print("Screen height:", SCREEN_HEIGHT)

    # Initialize mixer BEFORE pygame.init() with very low latency settings
    pygame.mixer.pre_init(frequency=22050, size=-16, channels=2, buffer=128)
    pygame.init()

    # Initialize joystick/gamepad support
    pygame.joystick.init()
    joysticks = [pygame.joystick.Joystick(i) for i in range(pygame.joystick.get_count())]
    for joystick in joysticks:
        joystick.init()
        print(f"Gamepad detected: {joystick.get_name()}")

    if not joysticks:
        print("No gamepad detected - using keyboard controls only")

    # Pre-load and process all sound effects at startup
    init_sounds()

    screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
    pygame.display.set_caption("Asteroids Game")

    # Start background music
    start_background_music()

    clock = pygame.time.Clock()  # Create a clock to control the frame rate
    dt = 0

    updatable = pygame.sprite.Group()
    drawable = pygame.sprite.Group()
    asteroids = pygame.sprite.Group()
    shots = pygame.sprite.Group()
    powerups = pygame.sprite.Group()

    Player.containers = (updatable, drawable)
    Asteroid.containers = (asteroids, updatable, drawable)
    AsteroidField.containers = (updatable,)
    Shot.containers = (shots, updatable, drawable)
    PowerUp.containers = (powerups, updatable, drawable)

    # Control configuration
    control_config = ControlConfig()
    config_phase = True  # Start with config screen

    # Create two players (will be recreated after config)
    player1, player2 = reset_game(updatable)

    # Game state
    game_started = False  # Track if game has started (start screen)
    game_over = False
    game_over_retry_delay = 0  # Delay before accepting retry input
    show_high_scores = False  # Whether to show high scores on game over screen
    paused = False  # Track if game is paused
    button_rect = None
    slow_motion_active = False
    slow_motion_timer = 0
    music_sped_up = False

    # Combo system state (shared between players)
    combo_count = 0
    combo_timer = 0.0

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
                    player1, player2 = reset_game(updatable, p1_input, p2_input, speed_mult, player_cnt)
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
                    player1, player2 = reset_game(updatable, p1_input, p2_input, speed_mult, player_cnt)
                    game_over = False
                    game_over_retry_delay = 0
                    show_high_scores = False
                    combo_count = 0
                    combo_timer = 0.0
                    slow_motion_active = False
                    slow_motion_timer = 0
                    screen_shake = 0.0
                    screen_shake_cooldown = 0.0
                    particles = []
                    taunt_animation = None
                    if music_sped_up:
                        reset_music_speed()
                        music_sped_up = False

            # Handle retry key press (only if delay has expired)
            if game_over and game_over_retry_delay <= 0 and event.type == pygame.KEYDOWN:
                if event.key == pygame.K_r:
                    p1_input, p2_input = control_config.get_player_inputs()
                    speed_mult = control_config.get_speed_multiplier()
                    player_cnt = control_config.get_player_count()
                    player1, player2 = reset_game(updatable, p1_input, p2_input, speed_mult, player_cnt)
                    game_over = False
                    game_over_retry_delay = 0
                    show_high_scores = False
                    combo_count = 0
                    combo_timer = 0.0
                    slow_motion_active = False
                    slow_motion_timer = 0
                    screen_shake = 0.0
                    screen_shake_cooldown = 0.0
                    particles = []
                    taunt_animation = None
                    if music_sped_up:
                        reset_music_speed()
                        music_sped_up = False

            # Handle retry - gamepad button (A button, only if delay has expired)
            if game_over and game_over_retry_delay <= 0 and event.type == pygame.JOYBUTTONDOWN:
                if event.button == 0:  # A button / X button
                    p1_input, p2_input = control_config.get_player_inputs()
                    speed_mult = control_config.get_speed_multiplier()
                    player_cnt = control_config.get_player_count()
                    player1, player2 = reset_game(updatable, p1_input, p2_input, speed_mult, player_cnt)
                    game_over = False
                    game_over_retry_delay = 0
                    show_high_scores = False
                    combo_count = 0
                    combo_timer = 0.0
                    slow_motion_active = False
                    slow_motion_timer = 0
                    screen_shake = 0.0
                    screen_shake_cooldown = 0.0
                    particles = []
                    taunt_animation = None
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
            for sprite in drawable:
                sprite.draw(screen, shake_offset)

            # Draw start screen overlay
            draw_start_screen(screen)
        elif not game_over:
            # Only update game logic if not paused
            if not paused:
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

                # Update asteroid field (spawns new asteroids)
                for field in updatable:
                    if isinstance(field, AsteroidField):
                        field.update(dt)

                # Update both players at normal speed
                player1.update(dt)
                player2.update(dt)

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

                # Apply slow motion effect to dt for asteroids only
                asteroid_dt = dt * SLOW_MOTION_FACTOR if slow_motion_active else dt

                # Update asteroids at potentially slowed speed
                for asteroid in asteroids:
                    asteroid.update(asteroid_dt)

                # Update power-ups at normal speed
                for powerup in powerups:
                    powerup.update(dt)

                # Check collisions for both players
                for asteroid in asteroids:
                    # Skip collision check if asteroid is dying (playing death animation)
                    if asteroid.dying:
                        continue

                    # Player 1 collision
                    if player1.lives > 0 and player1.check_collision(asteroid):
                        # Use take_damage to check if shield absorbed hit
                        if player1.take_damage():
                            print(f"Player 1 hit! Lives remaining: {player1.lives}")
                            if player1.lives > 0:
                                # Respawn player 1
                                player1.respawn(p1_spawn_x, p1_spawn_y)
                            else:
                                print("Player 1 eliminated!")
                                # Check if both players are dead
                                if player2.lives <= 0:
                                    print("Game over!")
                                    print(f"Player 1 Final Score: {player1.score}")
                                    print(f"Player 2 Final Score: {player2.score}")
                                    game_over = True
                                    game_over_retry_delay = 1.5  # 1.5 second delay
                                    taunt_animation = TauntAnimation()

                                    # Check if scores qualify for high score board BEFORE saving
                                    p1_is_high = is_high_score(player1.score) if player1.score > 0 else False
                                    p2_is_high = is_high_score(player2.score) if player2.score > 0 else False

                                    # Save high scores
                                    if player1.score > 0:
                                        rank = add_score("Player 1", player1.score)
                                        if rank:
                                            print(f"Player 1 achieved high score rank #{rank}!")
                                    if player2.score > 0:
                                        rank = add_score("Player 2", player2.score)
                                        if rank:
                                            print(f"Player 2 achieved high score rank #{rank}!")

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

                    # Player 2 collision
                    if player2.lives > 0 and player2.check_collision(asteroid):
                        # Use take_damage to check if shield absorbed hit
                        if player2.take_damage():
                            print(f"Player 2 hit! Lives remaining: {player2.lives}")
                            if player2.lives > 0:
                                # Respawn player 2
                                player2.respawn(p2_spawn_x, p2_spawn_y)
                            else:
                                print("Player 2 eliminated!")
                                # Check if both players are dead
                                if player1.lives <= 0:
                                    print("Game over!")
                                    print(f"Player 1 Final Score: {player1.score}")
                                    print(f"Player 2 Final Score: {player2.score}")
                                    game_over = True
                                    game_over_retry_delay = 1.5  # 1.5 second delay
                                    taunt_animation = TauntAnimation()

                                    # Check if scores qualify for high score board BEFORE saving
                                    p1_is_high = is_high_score(player1.score) if player1.score > 0 else False
                                    p2_is_high = is_high_score(player2.score) if player2.score > 0 else False

                                    # Save high scores
                                    if player1.score > 0:
                                        rank = add_score("Player 1", player1.score)
                                        if rank:
                                            print(f"Player 1 achieved high score rank #{rank}!")
                                    if player2.score > 0:
                                        rank = add_score("Player 2", player2.score)
                                        if rank:
                                            print(f"Player 2 achieved high score rank #{rank}!")

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
                            # Increase combo
                            combo_count += 1
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

                            # Chance to spawn power-up
                            # First check for rare MEGA POWER
                            if random.random() < MEGA_POWER_SPAWN_CHANCE:
                                PowerUp(asteroid.position.x, asteroid.position.y, PowerUp.MEGA_POWER)
                            elif random.random() < POWERUP_SPAWN_CHANCE:
                                # Randomly choose a normal power-up type
                                powerup_types = [PowerUp.RAPID_FIRE, PowerUp.SHIELD, PowerUp.MULTI_SHOT, PowerUp.SLOW_MOTION]
                                chosen_type = random.choice(powerup_types)
                                PowerUp(asteroid.position.x, asteroid.position.y, chosen_type)

                            break

                # Check for power-up collection for both players
                for powerup in powerups:
                    collected = False

                    # Player 1 collection
                    if player1.lives > 0 and player1.check_collision(powerup):
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
                        collected = True

                    # Player 2 collection
                    if not collected and player2.lives > 0 and player2.check_collision(powerup):
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
                        collected = True

                    if collected:
                        powerup.kill()

            # Calculate screen shake offset (regardless of pause state for drawing)
            shake_offset = (0, 0)
            if screen_shake > 0:
                shake_offset = (
                    random.uniform(-screen_shake, screen_shake),
                    random.uniform(-screen_shake, screen_shake)
                )

            # Draw all sprites with shake offset
            for sprite in drawable:
                sprite.draw(screen, shake_offset)

            # Draw particles with shake offset
            for particle in particles:
                particle.draw(screen, shake_offset)

            # Draw scores and lives for both players
            draw_scores(screen, player1, player2)
            # Draw combo
            draw_combo(screen, combo_count, combo_timer)
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
            for sprite in drawable:
                sprite.draw(screen, shake_offset)

            # Draw particles even when game is over
            particles = [p for p in particles if p.update(dt)]
            for particle in particles:
                particle.draw(screen, shake_offset)

            # Draw scores on frozen game
            draw_scores(screen, player1, player2)
            # Draw power-up indicators on frozen game
            draw_powerup_indicator(screen, player1, slow_motion_active, slow_motion_timer)

            # Draw game over screen (pass retry delay and high scores flag)
            button_rect = draw_game_over_screen(screen, player1, player2, game_over_retry_delay, show_high_scores)

            # Update and draw taunt animation LAST (so it's on top)
            if taunt_animation:
                if not taunt_animation.update(dt):
                    taunt_animation = None
                else:
                    taunt_animation.draw(screen)

        pygame.display.flip()  # Update the display
        dt = clock.tick(60) / 1000  # Limit the frame rate to 60 FPS


if __name__ == "__main__":
    main()
