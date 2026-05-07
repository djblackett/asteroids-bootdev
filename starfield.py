"""
Optimized starfield background with parallax scrolling.

OPTIMIZATION NOTES:
- Pre-compute parallax factor and color for each star at creation time
- Use __slots__ to reduce memory overhead per star
- Cache zero vector to avoid repeated Vector2 creation
- Batch draw small stars using set_at for efficiency
"""

import pygame
import random
from constants import SCREEN_WIDTH, SCREEN_HEIGHT, STARFIELD_PARALLAX_STRENGTH


class Star:
    """A single star in the starfield"""
    # OPTIMIZATION: Use __slots__ to reduce memory overhead per star instance
    __slots__ = ['x', 'y', 'size', 'color', 'parallax', 'layer']

    # Pre-computed parallax factors by layer
    PARALLAX_FACTORS = (0.1, 0.3, 0.5)  # Background, mid, foreground

    def __init__(self, x, y, size, brightness, layer):
        self.x = x
        self.y = y
        self.size = size
        self.layer = layer  # Exposed for ordering tests/debugging
        # OPTIMIZATION: Pre-compute color tuple instead of creating each frame
        self.color = (brightness, brightness, brightness)
        # OPTIMIZATION: Pre-compute parallax factor instead of list lookup each frame
        self.parallax = self.PARALLAX_FACTORS[layer]

    def draw(self, screen, camera_offset):
        # Calculate position with parallax offset
        draw_x = self.x - (camera_offset[0] * self.parallax)
        draw_y = self.y - (camera_offset[1] * self.parallax)

        # Wrap around screen edges for infinite scrolling
        draw_x = draw_x % SCREEN_WIDTH
        draw_y = draw_y % SCREEN_HEIGHT

        # Draw the star
        if self.size == 1:
            screen.set_at((int(draw_x), int(draw_y)), self.color)
        else:
            pygame.draw.circle(screen, self.color, (int(draw_x), int(draw_y)), self.size)


class Starfield:
    """Manages a multi-layer parallax starfield background"""

    # OPTIMIZATION: Cache zero vector to avoid repeated creation
    _ZERO_VECTOR = pygame.Vector2(0, 0)

    def __init__(self, star_count=200):
        """
        Initialize the starfield

        Args:
            star_count: Total number of stars (will be distributed across layers)
        """
        self.stars = []
        self.camera_offset = [0.0, 0.0]  # Accumulated camera movement

        # Layer configuration: (count_multiplier, size_range, brightness_range)
        layer_configs = [
            (0.5, (1, 1), (80, 120)),    # Layer 0: Far background - small, dim
            (0.3, (1, 2), (140, 180)),   # Layer 1: Mid - medium brightness
            (0.2, (2, 3), (200, 255)),   # Layer 2: Foreground - bright, larger
        ]

        # Generate stars for each layer
        for layer, (multiplier, size_range, brightness_range) in enumerate(layer_configs):
            count = int(star_count * multiplier)
            for _ in range(count):
                x = random.uniform(0, SCREEN_WIDTH)
                y = random.uniform(0, SCREEN_HEIGHT)
                size = random.randint(size_range[0], size_range[1])
                brightness = random.randint(brightness_range[0], brightness_range[1])
                self.stars.append(Star(x, y, size, brightness, layer))

        # Sort stars by layer so background draws first
        self.stars.sort(key=lambda s: s.parallax)

    def update(self, player1, player2=None):
        """
        Update camera offset based on player movement

        Args:
            player1: First player object with velocity attribute
            player2: Optional second player object
        """
        # OPTIMIZATION: Use cached zero vector and inline the velocity check
        # to avoid nested function call overhead

        def get_velocity_safe(player):
            """Get player velocity, filtering out bounce-back effects"""
            if player.lives <= 0:
                return self._ZERO_VECTOR
            # If player just bounced, ignore their velocity
            if hasattr(player, 'bounce_info') and player.bounce_info is not None:
                return self._ZERO_VECTOR
            # Filter out very high velocities (edge case)
            vel = player.velocity
            if vel.length() > 400:
                return self._ZERO_VECTOR
            return vel

        if player2 and player2.lives > 0 and player1.lives > 0:
            v1 = get_velocity_safe(player1)
            v2 = get_velocity_safe(player2)
            avg_velocity = (v1 + v2) / 2
        elif player1.lives > 0:
            avg_velocity = get_velocity_safe(player1)
        elif player2 and player2.lives > 0:
            avg_velocity = get_velocity_safe(player2)
        else:
            avg_velocity = self._ZERO_VECTOR

        # Update camera offset (accumulate movement for parallax)
        self.camera_offset[0] += avg_velocity.x * STARFIELD_PARALLAX_STRENGTH
        self.camera_offset[1] += avg_velocity.y * STARFIELD_PARALLAX_STRENGTH

    def draw(self, screen):
        """Draw all stars to the screen"""
        # OPTIMIZATION: Local variable lookup is faster than attribute lookup
        camera_offset = self.camera_offset
        for star in self.stars:
            star.draw(screen, camera_offset)
