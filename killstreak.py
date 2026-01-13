import pygame
from constants import SCREEN_WIDTH, SCREEN_HEIGHT, KILL_STREAK_NOTIFICATION_DURATION


class KillStreakNotification:
    """Visual notification for kill streak milestones"""

    def __init__(self, streak_count, streak_name, color):
        self.streak_count = streak_count
        self.streak_name = streak_name
        self.color = color
        self.timer = KILL_STREAK_NOTIFICATION_DURATION
        self.initial_duration = KILL_STREAK_NOTIFICATION_DURATION

    def update(self, dt):
        """Update the notification timer. Returns False when expired."""
        self.timer -= dt
        return self.timer > 0

    def draw(self, screen):
        """Draw the kill streak notification with animations"""
        if self.timer <= 0:
            return

        # Calculate animation values
        progress = 1.0 - (self.timer / self.initial_duration)

        # Fade in/out effect
        if progress < 0.15:  # First 15% - fade in
            alpha = progress / 0.15
        elif progress > 0.85:  # Last 15% - fade out
            alpha = (1.0 - progress) / 0.15
        else:
            alpha = 1.0

        # Pulse effect
        pulse_scale = 1.0 + (0.15 * abs((self.timer * 2) % 1.0 - 0.5))

        # Slide in from top
        if progress < 0.2:
            y_offset = -100 * (1.0 - (progress / 0.2))
        else:
            y_offset = 0

        # Position - center of screen, slightly above middle
        base_y = SCREEN_HEIGHT // 2 - 120
        y_pos = base_y + y_offset

        # Create fonts
        font_large = pygame.font.Font(None, int(100 * pulse_scale))
        font_medium = pygame.font.Font(None, int(60 * pulse_scale))

        # Apply alpha to color
        display_color = (
            int(self.color[0] * alpha),
            int(self.color[1] * alpha),
            int(self.color[2] * alpha)
        )

        # Draw streak count
        count_text = font_medium.render(f"{self.streak_count} KILLS", True, display_color)
        count_rect = count_text.get_rect(center=(SCREEN_WIDTH // 2, y_pos - 40))

        # Create glow effect by drawing multiple times with offset
        glow_color = (
            min(255, int(self.color[0] * alpha * 0.5)),
            min(255, int(self.color[1] * alpha * 0.5)),
            min(255, int(self.color[2] * alpha * 0.5))
        )

        # Draw glow (multiple offset copies)
        for offset in [(0, -2), (0, 2), (-2, 0), (2, 0)]:
            glow_rect = count_rect.copy()
            glow_rect.x += offset[0]
            glow_rect.y += offset[1]
            glow_text = font_medium.render(f"{self.streak_count} KILLS", True, glow_color)
            screen.blit(glow_text, glow_rect)

        # Draw main text on top
        screen.blit(count_text, count_rect)

        # Draw streak name
        name_text = font_large.render(self.streak_name, True, display_color)
        name_rect = name_text.get_rect(center=(SCREEN_WIDTH // 2, y_pos + 40))

        # Draw glow for name
        for offset in [(0, -3), (0, 3), (-3, 0), (3, 0), (-2, -2), (2, 2), (-2, 2), (2, -2)]:
            glow_rect = name_rect.copy()
            glow_rect.x += offset[0]
            glow_rect.y += offset[1]
            glow_text = font_large.render(self.streak_name, True, glow_color)
            screen.blit(glow_text, glow_rect)

        # Draw main text on top
        screen.blit(name_text, name_rect)
