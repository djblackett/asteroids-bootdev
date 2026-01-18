"""HUD and UI drawing functions for Asteroids game."""

import pygame
import sys

from constants import (
    SCREEN_WIDTH, SCREEN_HEIGHT,
    COMBO_MULTIPLIERS,
    LASER_BEAM_MAX_SHOTS,
)
from highscores import get_top_scores
import frametime
import colorutils

IS_WEB = sys.platform == "emscripten"

# Font references - will be set by init_fonts()
FONT_24 = None
FONT_28 = None
FONT_32 = None
FONT_36 = None
FONT_40 = None
FONT_48 = None
FONT_74 = None
FONT_80 = None
FONT_100 = None


def init_fonts():
    """Initialize font objects. Must be called after pygame.init()."""
    global FONT_24, FONT_28, FONT_32, FONT_36, FONT_40, FONT_48, FONT_74, FONT_80, FONT_100
    FONT_24 = pygame.font.Font(None, 24)
    FONT_28 = pygame.font.Font(None, 28)
    FONT_32 = pygame.font.Font(None, 32)
    FONT_36 = pygame.font.Font(None, 36)
    FONT_40 = pygame.font.Font(None, 40)
    FONT_48 = pygame.font.Font(None, 48)
    FONT_74 = pygame.font.Font(None, 74)
    FONT_80 = pygame.font.Font(None, 80)
    FONT_100 = pygame.font.Font(None, 100)


def draw_scores(screen, player1, player2, shared_lives_enabled=False, player_count=2):
    """Draw scores and lives for players."""
    # Player 1 - Top left
    p1_color = (100, 200, 255) if player1.lives > 0 or (
        shared_lives_enabled and player1.lives > 0) else (100, 100, 100)
    p1_score_text = FONT_28.render(f"P1: {player1.score}", True, p1_color)
    p1_score_rect = p1_score_text.get_rect(topleft=(10, 10))
    screen.blit(p1_score_text, p1_score_rect)

    # Player 2 - Top right (only in 2-player mode)
    if player_count == 2:
        p2_color = (255, 200, 100) if player2.lives > 0 or (
            shared_lives_enabled and player1.lives > 0) else (100, 100, 100)
        p2_score_text = FONT_28.render(f"P2: {player2.score}", True, p2_color)
        p2_score_rect = p2_score_text.get_rect(
            topright=(SCREEN_WIDTH - 10, 10))
        screen.blit(p2_score_text, p2_score_rect)

    # Lives display
    if player_count == 1:
        # Single player - just show lives for player 1
        lives_text = FONT_28.render(f"Lives: {player1.lives}", True, p1_color)
        lives_rect = lives_text.get_rect(topleft=(10, 45))
        screen.blit(lives_text, lives_rect)
    elif shared_lives_enabled and player2.lives == 0:
        # Shared lives - show in center
        lives_color = (100, 255, 255)
        lives_text = FONT_28.render(
            f"SHARED LIVES: {player1.lives}", True, lives_color)
        lives_rect = lives_text.get_rect(midtop=(SCREEN_WIDTH // 2, 10))
        screen.blit(lives_text, lives_rect)
    else:
        # Individual lives - show separately
        p2_color = (255, 200, 100) if player2.lives > 0 else (100, 100, 100)
        # Player 1 lives
        lives_text = FONT_28.render(f"Lives: {player1.lives}", True, p1_color)
        lives_rect = lives_text.get_rect(topleft=(10, 45))
        screen.blit(lives_text, lives_rect)

        # Player 2 lives
        lives_text = FONT_28.render(f"Lives: {player2.lives}", True, p2_color)
        lives_rect = lives_text.get_rect(topright=(SCREEN_WIDTH - 10, 45))
        screen.blit(lives_text, lives_rect)


def draw_combo(screen, combo_count, combo_timer):
    """Draw the combo counter with animations."""
    if combo_count <= 1:
        return  # Don't show for 1x

    # Get multiplier
    multiplier = COMBO_MULTIPLIERS.get(combo_count, COMBO_MULTIPLIERS[5])

    # Position in center-right of screen
    x_pos = SCREEN_WIDTH - 250
    y_pos = 100

    # Color intensity based on combo level
    if combo_count >= 5:
        color = (255, 100, 255)  # Purple for high combos
    elif combo_count >= 3:
        color = (255, 165, 0)  # Orange
    else:
        color = (255, 255, 0)  # Yellow

    # Large combo text
    combo_text = FONT_80.render(f"{combo_count}x COMBO", True, color)
    combo_rect = combo_text.get_rect(center=(x_pos, y_pos))
    screen.blit(combo_text, combo_rect)

    # Multiplier text
    multiplier_text = FONT_32.render(f"{multiplier}x Points!", True, color)
    multiplier_rect = multiplier_text.get_rect(center=(x_pos, y_pos + 50))
    screen.blit(multiplier_text, multiplier_rect)


def draw_timer(screen, elapsed_time):
    """Draw the game timer at the top center of the screen."""
    # Format time as MM:SS
    minutes = int(elapsed_time // 60)
    seconds = int(elapsed_time % 60)
    timer_text = f"{minutes:02d}:{seconds:02d}"

    # White color for the timer
    timer_color = (255, 255, 255)

    text_surface = FONT_48.render(timer_text, True, timer_color)
    text_rect = text_surface.get_rect(midtop=(SCREEN_WIDTH // 2, 10))
    screen.blit(text_surface, text_rect)


def draw_wave_info(screen, wave_number, wave_break_active, wave_break_timer, wave_duration=None, wave_max_duration=None):
    """Draw wave number and break countdown."""
    # Always show current wave number in top center
    wave_color = (100, 255, 255)
    wave_text = FONT_48.render(f"WAVE {wave_number}", True, wave_color)
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

        timer_text = FONT_32.render(
            f"{minutes}:{seconds:02d}", True, timer_color)
        timer_rect = timer_text.get_rect(midtop=(SCREEN_WIDTH // 2, 58))
        screen.blit(timer_text, timer_rect)

    # Show "GET READY" message during wave break
    if wave_break_active:
        # Large "GET READY" text
        ready_color = (255, 255, 100)
        ready_text = FONT_80.render("GET READY!", True, ready_color)
        ready_rect = ready_text.get_rect(
            center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 - 40))
        screen.blit(ready_text, ready_rect)

        # Countdown timer
        countdown = int(wave_break_timer) + 1
        timer_text = FONT_80.render(str(countdown), True, ready_color)
        timer_rect = timer_text.get_rect(
            center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 + 40))
        screen.blit(timer_text, timer_rect)


def draw_powerup_indicator(screen, player, slow_motion_active, slow_motion_timer):
    """Draw power-up status indicators."""
    y_offset = 80  # Moved down to make room for lives display

    # Draw laser beam shots remaining
    laser_color = (100, 200, 255) if player.laser_shots_remaining > 0 else (
        100, 100, 100)
    laser_text = FONT_28.render(
        f"LASER: {player.laser_shots_remaining}/{LASER_BEAM_MAX_SHOTS}", True, laser_color)
    laser_rect = laser_text.get_rect(topleft=(10, y_offset))
    screen.blit(laser_text, laser_rect)
    y_offset += 30

    # Draw boost status
    if player.boost_active:
        time_left = int(player.boost_timer) + 1
        boost_text = FONT_28.render(
            f"BOOST: {time_left}s", True, (255, 100, 255))
        boost_rect = boost_text.get_rect(topleft=(10, y_offset))
        screen.blit(boost_text, boost_rect)
        y_offset += 30
    elif player.boost_cooldown > 0:
        cooldown_left = int(player.boost_cooldown) + 1
        boost_text = FONT_28.render(
            f"BOOST: {cooldown_left}s CD", True, (150, 150, 150))
        boost_rect = boost_text.get_rect(topleft=(10, y_offset))
        screen.blit(boost_text, boost_rect)
        y_offset += 30
    else:
        boost_text = FONT_28.render("BOOST: READY", True, (100, 255, 100))
        boost_rect = boost_text.get_rect(topleft=(10, y_offset))
        screen.blit(boost_text, boost_rect)
        y_offset += 30

    # MEGA POWER gets special treatment - larger, rainbow text
    if player.mega_power_active:
        time_left = int(player.mega_power_timer) + 1
        # Rainbow color cycling
        mega_color = colorutils.get_rainbow_color(
            frametime.get_ticks(), speed=100)
        powerup_text = FONT_40.render(
            f"*** MEGA POWER: {time_left}s ***", True, mega_color)
        powerup_rect = powerup_text.get_rect(topleft=(10, y_offset))
        screen.blit(powerup_text, powerup_rect)
        y_offset += 45
    else:
        # Show individual power-ups only if MEGA POWER is not active
        if player.rapid_fire_active:
            time_left = int(player.rapid_fire_timer) + 1
            powerup_text = FONT_28.render(
                f"RAPID FIRE: {time_left}s", True, (255, 255, 0))
            powerup_rect = powerup_text.get_rect(topleft=(10, y_offset))
            screen.blit(powerup_text, powerup_rect)
            y_offset += 30

        if player.multi_shot_active:
            time_left = int(player.multi_shot_timer) + 1
            powerup_text = FONT_28.render(
                f"MULTI-SHOT: {time_left}s", True, (255, 165, 0))
            powerup_rect = powerup_text.get_rect(topleft=(10, y_offset))
            screen.blit(powerup_text, powerup_rect)
            y_offset += 30

        if player.shield_active:
            powerup_text = FONT_28.render(
                "SHIELD: ACTIVE", True, (0, 255, 255))
            powerup_rect = powerup_text.get_rect(topleft=(10, y_offset))
            screen.blit(powerup_text, powerup_rect)
            y_offset += 30

        if slow_motion_active:
            time_left = int(slow_motion_timer) + 1
            powerup_text = FONT_28.render(
                f"SLOW MOTION: {time_left}s", True, (255, 0, 255))
            powerup_rect = powerup_text.get_rect(topleft=(10, y_offset))
            screen.blit(powerup_text, powerup_rect)


def draw_pause_screen(screen, music_muted):
    """Draw the pause screen overlay."""
    # Semi-transparent overlay
    overlay = pygame.Surface((SCREEN_WIDTH, SCREEN_HEIGHT))
    overlay.set_alpha(150)
    overlay.fill((0, 0, 0))
    screen.blit(overlay, (0, 0))

    # Pause text
    pause_text = FONT_100.render("PAUSED", True, (255, 255, 255))
    pause_rect = pause_text.get_rect(
        center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 - 80))
    screen.blit(pause_text, pause_rect)

    # Instructions
    instruction_text = FONT_40.render(
        "Press P to Resume", True, (200, 200, 200))
    instruction_rect = instruction_text.get_rect(
        center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 + 10))
    screen.blit(instruction_text, instruction_rect)

    # Music toggle instruction
    music_status = "Muted" if music_muted else "On"
    music_text = FONT_32.render(
        f"Press M to Toggle Music ({music_status})", True, (180, 180, 180))
    music_rect = music_text.get_rect(
        center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 + 60))
    screen.blit(music_text, music_rect)

    # Back to menu instruction
    menu_text = FONT_32.render(
        "Press ESC for Main Menu", True, (180, 180, 180))
    menu_rect = menu_text.get_rect(
        center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 + 100))
    screen.blit(menu_text, menu_rect)

    # Quit instruction (only show on desktop, not web)
    if not IS_WEB:
        quit_text = FONT_32.render("Press Q to Quit", True, (180, 180, 180))
        quit_rect = quit_text.get_rect(
            center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 + 140))
        screen.blit(quit_text, quit_rect)


def draw_game_over_screen(screen, player1, player2, retry_delay=0, show_high_scores=False, p1_rank=None, p2_rank=None):
    """Draw the game over screen with retry button and optional high scores."""
    # Semi-transparent overlay
    overlay = pygame.Surface((SCREEN_WIDTH, SCREEN_HEIGHT))
    overlay.set_alpha(180)
    overlay.fill((0, 0, 0))
    screen.blit(overlay, (0, 0))

    # Game Over text
    game_over_text = FONT_74.render("GAME OVER", True, (255, 255, 255))
    game_over_rect = game_over_text.get_rect(
        center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 - 250))
    screen.blit(game_over_text, game_over_rect)

    # Final scores
    p1_score_text = FONT_36.render(
        f"Player 1: {player1.score}", True, (100, 200, 255))
    p1_score_rect = p1_score_text.get_rect(
        center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 - 190))
    screen.blit(p1_score_text, p1_score_rect)

    p2_score_text = FONT_36.render(
        f"Player 2: {player2.score}", True, (255, 200, 100))
    p2_score_rect = p2_score_text.get_rect(
        center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 - 150))
    screen.blit(p2_score_text, p2_score_rect)

    # Show high scores if requested
    if show_high_scores:
        high_scores = get_top_scores(5)

        # High scores title
        hs_title = FONT_36.render("HIGH SCORES", True, (255, 215, 0))
        hs_title_rect = hs_title.get_rect(
            center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 - 100))
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

            score_text = FONT_24.render(
                f"{rank}. {entry['player']}: {entry['score']}",
                True,
                rank_color
            )
            score_rect = score_text.get_rect(
                center=(SCREEN_WIDTH // 2, y_offset))
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

    retry_text = FONT_36.render("RETRY", True, text_color)
    retry_text_rect = retry_text.get_rect(center=button_rect.center)
    screen.blit(retry_text, retry_text_rect)

    # Instructions - show countdown if delay is active
    if retry_delay > 0:
        countdown = int(retry_delay) + 1
        instruction_text = FONT_36.render(
            f"Wait {countdown}...", True, (150, 150, 150))
    else:
        instruction_text = FONT_36.render(
            "Press R or click RETRY", True, (200, 200, 200))
    instruction_rect = instruction_text.get_rect(
        center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 + 220))
    screen.blit(instruction_text, instruction_rect)

    # Menu instruction
    menu_text = FONT_24.render(
        "Press ESC for Main Menu", True, (180, 180, 180))
    menu_rect = menu_text.get_rect(
        center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 + 260))
    screen.blit(menu_text, menu_rect)

    # Quit instruction
    quit_text = FONT_24.render("Press Q to Quit", True, (180, 180, 180))
    quit_rect = quit_text.get_rect(
        center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 + 290))
    screen.blit(quit_text, quit_rect)

    return button_rect
