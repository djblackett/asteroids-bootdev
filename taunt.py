import pygame
import random
import math
import colorsys
from constants import DEATH_TAUNTS, TAUNT_DURATION, TAUNT_FADE_IN, TAUNT_FADE_OUT, SCREEN_WIDTH, SCREEN_HEIGHT


class TauntAnimation:
    """Animated text that appears when the player dies"""

    # Different animation types
    ANIM_BOUNCE = 0
    ANIM_WAVE = 1
    ANIM_SHAKE = 2
    ANIM_ZOOM = 3
    ANIM_RAINBOW_SPIN = 4

    def __init__(self):
        self.message = random.choice(DEATH_TAUNTS)
        self.timer = TAUNT_DURATION
        self.base_font_size = random.randint(100, 140)  # Larger, varied size
        self.font = pygame.font.Font(None, self.base_font_size)

        # Choose random animation style
        self.animation_type = random.randint(0, 4)

        # Animation state
        self.elapsed_time = 0

        # Color animation
        self.color_offset = random.random() * 360  # Random starting hue

    def update(self, dt):
        """Update the taunt animation timer"""
        self.timer -= dt
        self.elapsed_time += dt
        return self.timer > 0  # Returns False when animation is done

    def draw(self, screen):
        """Draw the taunt text with dramatic animations and effects"""
        # Calculate alpha based on timer
        if self.timer > TAUNT_DURATION - TAUNT_FADE_IN:
            # Fade in
            progress = (TAUNT_DURATION - self.timer) / TAUNT_FADE_IN
            alpha = int(255 * progress)
        elif self.timer < TAUNT_FADE_OUT:
            # Fade out
            progress = self.timer / TAUNT_FADE_OUT
            alpha = int(255 * progress)
        else:
            # Full visibility
            alpha = 255

        # Get rainbow color based on time
        hue = ((self.elapsed_time * 120 + self.color_offset) % 360) / 360.0
        r, g, b = colorsys.hsv_to_rgb(hue, 0.9, 1.0)
        color = (int(r * 255), int(g * 255), int(b * 255))

        # Calculate position and size based on animation type
        base_x = SCREEN_WIDTH // 2
        base_y = 120  # Position at top of screen
        offset_x = 0
        offset_y = 0
        scale = 1.0
        rotation = 0

        if self.animation_type == self.ANIM_BOUNCE:
            # Bouncing up and down
            bounce_height = 30
            offset_y = abs(math.sin(self.elapsed_time * 4)) * bounce_height

        elif self.animation_type == self.ANIM_WAVE:
            # Wave motion (sine wave path)
            wave_amplitude = 40
            offset_x = math.sin(self.elapsed_time * 3) * wave_amplitude
            offset_y = math.cos(self.elapsed_time * 2) * 20

        elif self.animation_type == self.ANIM_SHAKE:
            # Aggressive shaking
            shake_intensity = 8
            offset_x = random.uniform(-shake_intensity, shake_intensity)
            offset_y = random.uniform(-shake_intensity, shake_intensity)

        elif self.animation_type == self.ANIM_ZOOM:
            # Pulsing/zooming in and out
            pulse = 1.0 + math.sin(self.elapsed_time * 5) * 0.2
            scale = pulse

        elif self.animation_type == self.ANIM_RAINBOW_SPIN:
            # Gentle rotation with rainbow colors
            rotation = math.sin(self.elapsed_time * 2) * 15  # -15 to +15 degrees
            scale = 1.0 + math.sin(self.elapsed_time * 3) * 0.1

        # Apply scale to font size
        current_font_size = int(self.base_font_size * scale)
        scaled_font = pygame.font.Font(None, current_font_size)

        # Render text with rainbow color
        text_surface = scaled_font.render(self.message, True, color)

        # Apply rotation if needed
        if rotation != 0:
            text_surface = pygame.transform.rotate(text_surface, rotation)

        # Apply alpha
        text_surface.set_alpha(alpha)

        # Create outline/shadow effect for more prominence
        # Draw shadow (slightly offset dark version)
        shadow_surface = scaled_font.render(self.message, True, (0, 0, 0))
        if rotation != 0:
            shadow_surface = pygame.transform.rotate(shadow_surface, rotation)
        shadow_surface.set_alpha(alpha // 2)

        # Calculate final position
        final_x = base_x + offset_x
        final_y = base_y + offset_y

        # Draw shadow first (offset)
        shadow_rect = shadow_surface.get_rect(center=(final_x + 4, final_y + 4))
        screen.blit(shadow_surface, shadow_rect)

        # Draw main text
        text_rect = text_surface.get_rect(center=(final_x, final_y))
        screen.blit(text_surface, text_rect)

        # Add extra glow effect by drawing a slightly transparent version behind
        glow_surface = scaled_font.render(self.message, True, color)
        if rotation != 0:
            glow_surface = pygame.transform.rotate(glow_surface, rotation)
        glow_surface.set_alpha(alpha // 3)

        for glow_offset in [(0, -3), (0, 3), (-3, 0), (3, 0)]:
            glow_rect = glow_surface.get_rect(
                center=(final_x + glow_offset[0], final_y + glow_offset[1])
            )
            screen.blit(glow_surface, glow_rect)
