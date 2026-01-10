import pygame
from constants import SCREEN_WIDTH, SCREEN_HEIGHT
from powerup import PowerUp


def draw_start_screen(screen):
    """Draw the start screen with instructions and power-up information"""
    # Semi-transparent overlay
    overlay = pygame.Surface((SCREEN_WIDTH, SCREEN_HEIGHT))
    overlay.set_alpha(200)
    overlay.fill((0, 0, 0))
    screen.blit(overlay, (0, 0))

    # Title
    font_title = pygame.font.Font(None, 100)
    font_header = pygame.font.Font(None, 48)
    font_text = pygame.font.Font(None, 32)
    font_small = pygame.font.Font(None, 28)

    # Draw title
    title_text = font_title.render("ASTEROIDS", True, (255, 255, 255))
    title_rect = title_text.get_rect(center=(SCREEN_WIDTH // 2, 60))
    screen.blit(title_text, title_rect)

    # Controls section
    controls_y = 130
    controls_header = font_header.render("CONTROLS", True, (255, 200, 0))
    controls_rect = controls_header.get_rect(center=(SCREEN_WIDTH // 2, controls_y))
    screen.blit(controls_header, controls_rect)

    # Control instructions
    controls = [
        "W / S - Move Forward / Backward",
        "A / D - Rotate Left / Right",
        "SPACE - Shoot",
        "P - Pause",
    ]

    y_offset = controls_y + 40
    for control in controls:
        text = font_small.render(control, True, (200, 200, 200))
        text_rect = text.get_rect(center=(SCREEN_WIDTH // 2, y_offset))
        screen.blit(text, text_rect)
        y_offset += 30

    # Power-ups section
    powerups_y = y_offset + 20
    powerups_header = font_header.render("POWER-UPS", True, (255, 200, 0))
    powerups_rect = powerups_header.get_rect(center=(SCREEN_WIDTH // 2, powerups_y))
    screen.blit(powerups_header, powerups_rect)

    # Power-up info with visual representations
    powerup_info = [
        (PowerUp.RAPID_FIRE, "Rapid Fire", "Faster shooting", (255, 255, 0)),
        (PowerUp.MULTI_SHOT, "Multi-Shot", "Shoot 3 bullets", (255, 165, 0)),
        (PowerUp.SHIELD, "Shield", "One-hit protection", (0, 255, 255)),
        (PowerUp.SLOW_MOTION, "Slow Motion", "Slows asteroids", (255, 0, 255)),
        (PowerUp.MEGA_POWER, "MEGA POWER", "ALL POWERS!", (255, 100, 255)),
    ]

    y_offset = powerups_y + 40

    # Temporarily disable powerup containers to prevent adding to game
    original_containers = PowerUp.containers
    PowerUp.containers = ()  # Empty tuple instead of None

    for powerup_type, name, description, color in powerup_info:
        # Create a temporary power-up to draw its icon
        x_icon = SCREEN_WIDTH // 2 - 180
        y_icon = y_offset

        # Draw icon background circle
        pygame.draw.circle(screen, (40, 40, 40), (x_icon, y_icon), 20)

        # Create a temporary powerup and draw it (simplified visualization)
        temp_powerup = PowerUp(x_icon, y_icon, powerup_type)
        temp_powerup.position = pygame.Vector2(x_icon, y_icon)
        temp_powerup.draw(screen, (0, 0))

        # Draw name and description
        name_text = font_text.render(name, True, color)
        screen.blit(name_text, (x_icon + 35, y_icon - 20))

        desc_text = font_small.render(description, True, (180, 180, 180))
        screen.blit(desc_text, (x_icon + 35, y_icon + 5))

        y_offset += 48

    # Restore the original containers
    PowerUp.containers = original_containers

    # Start instruction - add more space from bottom
    start_y = SCREEN_HEIGHT - 60
    start_text = font_header.render("Press SPACE to Start", True, (100, 255, 100))
    start_rect = start_text.get_rect(center=(SCREEN_WIDTH // 2, start_y))
    screen.blit(start_text, start_rect)

    # Add a pulsing effect to the start text
    pulse = abs(pygame.time.get_ticks() % 1000 - 500) / 500
    alpha = int(150 + 105 * pulse)
    start_text.set_alpha(alpha)
