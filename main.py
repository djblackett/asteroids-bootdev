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
import random


def draw_score(screen, score):
    """Draw the score in the top-left corner"""
    font = pygame.font.Font(None, 36)
    score_text = font.render(f"Score: {score}", True, (255, 255, 255))
    screen.blit(score_text, (10, 10))


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
    y_offset = 45

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

    pause_text = font_large.render("PAUSED", True, (255, 255, 255))
    pause_rect = pause_text.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 - 50))
    screen.blit(pause_text, pause_rect)

    # Instructions
    instruction_text = font_small.render("Press P to Resume", True, (200, 200, 200))
    instruction_rect = instruction_text.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 + 30))
    screen.blit(instruction_text, instruction_rect)


def draw_game_over_screen(screen, score):
    """Draw the game over screen with retry button"""
    # Semi-transparent overlay
    overlay = pygame.Surface((SCREEN_WIDTH, SCREEN_HEIGHT))
    overlay.set_alpha(180)
    overlay.fill((0, 0, 0))
    screen.blit(overlay, (0, 0))

    # Game Over text
    font_large = pygame.font.Font(None, 74)
    font_small = pygame.font.Font(None, 36)

    game_over_text = font_large.render("GAME OVER", True, (255, 255, 255))
    game_over_rect = game_over_text.get_rect(
        center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 - 80))
    screen.blit(game_over_text, game_over_rect)

    # Final score
    final_score_text = font_small.render(
        f"Final Score: {score}", True, (255, 255, 255))
    final_score_rect = final_score_text.get_rect(
        center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 - 20))
    screen.blit(final_score_text, final_score_rect)

    # Retry button
    button_width = 200
    button_height = 60
    button_x = SCREEN_WIDTH // 2 - button_width // 2
    button_y = SCREEN_HEIGHT // 2 + 30
    button_rect = pygame.Rect(button_x, button_y, button_width, button_height)

    # Draw button
    pygame.draw.rect(screen, (100, 100, 100), button_rect)
    pygame.draw.rect(screen, (255, 255, 255), button_rect, 3)

    retry_text = font_small.render("RETRY", True, (255, 255, 255))
    retry_text_rect = retry_text.get_rect(center=button_rect.center)
    screen.blit(retry_text, retry_text_rect)

    # Instructions
    instruction_text = font_small.render(
        "Press R or click RETRY", True, (200, 200, 200))
    instruction_rect = instruction_text.get_rect(
        center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 + 110))
    screen.blit(instruction_text, instruction_rect)

    return button_rect


def reset_game(updatable):
    """Reset all game objects for a new game"""
    # Clear all sprite groups
    for sprite in updatable:
        sprite.kill()

    # Recreate player and asteroid field
    player = Player(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2)
    AsteroidField()

    return player


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

    Player.containers = (updatable, drawable, shots)
    Asteroid.containers = (asteroids, updatable, drawable)
    AsteroidField.containers = (updatable,)
    Shot.containers = (shots, updatable, drawable)
    PowerUp.containers = (powerups, updatable, drawable)

    player = Player(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2)
    field = AsteroidField()

    # Game state
    game_started = False  # Track if game has started (start screen)
    game_over = False
    paused = False  # Track if game is paused
    button_rect = None
    score = 0
    slow_motion_active = False
    slow_motion_timer = 0
    music_sped_up = False

    # Combo system state
    combo_count = 0
    combo_timer = 0.0

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

            # Handle pause toggle - gamepad (Start button)
            if game_started and not game_over and event.type == pygame.JOYBUTTONDOWN:
                if event.button == 7:  # Start button on most controllers
                    paused = not paused

            # Handle retry button click
            if game_over and event.type == pygame.MOUSEBUTTONDOWN:
                if button_rect and button_rect.collidepoint(event.pos):
                    player = reset_game(updatable)
                    game_over = False
                    score = 0
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

            # Handle retry key press
            if game_over and event.type == pygame.KEYDOWN:
                if event.key == pygame.K_r:
                    player = reset_game(updatable)
                    game_over = False
                    score = 0
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

            # Handle retry - gamepad button (A button)
            if game_over and event.type == pygame.JOYBUTTONDOWN:
                if event.button == 0:  # A button / X button
                    player = reset_game(updatable)
                    game_over = False
                    score = 0
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

        # Show start screen if game hasn't started
        if not game_started:
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
                    should_have_fast_music = player.mega_power_active
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
                field.update(dt)

                # Update player and shots at normal speed
                player.update(dt)

                # Check for boundary bounce effects
                if player.bounce_info:
                    # Add screen shake for wall bounce only if cooldown expired
                    if screen_shake_cooldown <= 0:
                        screen_shake = min(screen_shake + BOUNDARY_SHAKE_AMOUNT, SCREEN_SHAKE_MAX)
                        screen_shake_cooldown = SCREEN_SHAKE_COOLDOWN

                    # Spawn particles in the bounce direction
                    for i in range(BOUNDARY_PARTICLE_COUNT):
                        # Create particles spreading out from the collision point
                        base_angle = player.bounce_info['direction'].angle_to(pygame.Vector2(0, 1))
                        angle_spread = 60  # degrees of spread
                        angle = base_angle + random.uniform(-angle_spread/2, angle_spread/2)
                        velocity = pygame.Vector2(0, 1).rotate(angle) * PARTICLE_SPEED * 0.8
                        particle = Particle(player.bounce_info['position'].x,
                                          player.bounce_info['position'].y,
                                          velocity)
                        particles.append(particle)

                    # Clear bounce info after processing
                    player.bounce_info = None

                # Generate exhaust particles when player is moving
                exhaust_info = player.get_exhaust_info()
                if exhaust_info:
                    # Create a single exhaust particle with some spread
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

                for asteroid in asteroids:
                    # Skip collision check if asteroid is dying (playing death animation)
                    if asteroid.dying:
                        continue
                    if player.check_collision(asteroid):
                        # Use take_damage to check if shield absorbed hit
                        if player.take_damage():
                            print("Game over!")
                            print(f"Final score: {score}")
                            game_over = True
                            # Create taunt animation
                            taunt_animation = TauntAnimation()
                            # Break out of loop after death
                            break
                        else:
                            print("Shield absorbed hit!")
                            # Destroy the asteroid that hit the shield
                            effect_info = asteroid.split()
                            if effect_info:
                                # Add screen shake for shield hits only if cooldown expired (capped at max)
                                if screen_shake_cooldown <= 0:
                                    screen_shake = min(screen_shake + effect_info['shake_amount'] * 0.5, SCREEN_SHAKE_MAX)
                                    screen_shake_cooldown = SCREEN_SHAKE_COOLDOWN

                                # Spawn particles
                                for i in range(effect_info['particle_count']):
                                    angle = (360 / effect_info['particle_count']) * i + random.uniform(-15, 15)
                                    velocity = pygame.Vector2(0, 1).rotate(angle) * PARTICLE_SPEED
                                    particle = Particle(effect_info['position'].x, effect_info['position'].y, velocity)
                                    particles.append(particle)
                            # Break out of loop after shield absorbs hit to prevent checking more asteroids
                            break

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
                            score += points_earned

                            # Visual feedback for point value
                            if combo_count > 1:
                                print(f"+{points_earned} points! ({combo_count}x COMBO)")
                            else:
                                print(f"+{points_earned} points")

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

                # Check for power-up collection
                for powerup in powerups:
                    if player.check_collision(powerup):
                        if powerup.powerup_type == PowerUp.MEGA_POWER:
                            player.activate_mega_power()
                            slow_motion_active = True
                            slow_motion_timer = MEGA_POWER_DURATION
                            print("MEGA POWER ACTIVATED!")
                        elif powerup.powerup_type == PowerUp.RAPID_FIRE:
                            player.activate_rapid_fire()
                        elif powerup.powerup_type == PowerUp.SHIELD:
                            player.activate_shield()
                        elif powerup.powerup_type == PowerUp.MULTI_SHOT:
                            player.activate_multi_shot()
                        elif powerup.powerup_type == PowerUp.SLOW_MOTION:
                            slow_motion_active = True
                            slow_motion_timer = SLOW_MOTION_DURATION
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

            # Draw score
            draw_score(screen, score)
            # Draw combo
            draw_combo(screen, combo_count, combo_timer)
            # Draw power-up indicators
            draw_powerup_indicator(screen, player, slow_motion_active, slow_motion_timer)

            # Draw pause overlay if paused
            if paused:
                draw_pause_screen(screen)
        else:
            # Draw frozen game state (no shake on game over)
            shake_offset = (0, 0)
            for sprite in drawable:
                sprite.draw(screen, shake_offset)

            # Draw particles even when game is over
            particles = [p for p in particles if p.update(dt)]
            for particle in particles:
                particle.draw(screen, shake_offset)

            # Draw score on frozen game
            draw_score(screen, score)
            # Draw power-up indicators on frozen game
            draw_powerup_indicator(screen, player, slow_motion_active, slow_motion_timer)

            # Draw game over screen
            button_rect = draw_game_over_screen(screen, score)

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
