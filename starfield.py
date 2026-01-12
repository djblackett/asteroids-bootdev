import pygame
import random
from constants import SCREEN_WIDTH, SCREEN_HEIGHT, STARFIELD_PARALLAX_STRENGTH


class Star:
    """A single star in the starfield"""
    def __init__(self, x, y, size, brightness, layer):
        self.x = x
        self.y = y
        self.size = size
        self.brightness = brightness
        self.layer = layer  # 0 = far (slow), 1 = mid, 2 = near (fast)

    def draw(self, screen, camera_offset):
        # Apply parallax based on layer
        parallax_factors = [0.1, 0.3, 0.5]  # Background, mid, foreground
        parallax = parallax_factors[self.layer]

        # Calculate position with parallax offset
        draw_x = self.x - (camera_offset[0] * parallax)
        draw_y = self.y - (camera_offset[1] * parallax)

        # Wrap around screen edges for infinite scrolling
        draw_x = draw_x % SCREEN_WIDTH
        draw_y = draw_y % SCREEN_HEIGHT

        # Draw the star
        color = (self.brightness, self.brightness, self.brightness)
        if self.size == 1:
            screen.set_at((int(draw_x), int(draw_y)), color)
        else:
            pygame.draw.circle(screen, color, (int(draw_x), int(draw_y)), self.size)


class Starfield:
    """Manages a multi-layer parallax starfield background"""

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
        self.stars.sort(key=lambda s: s.layer)

    def update(self, player1, player2=None):
        """
        Update camera offset based on player movement

        Args:
            player1: First player object with velocity attribute
            player2: Optional second player object
        """
        # Calculate average velocity if both players are alive
        if player2 and player2.lives > 0 and player1.lives > 0:
            avg_velocity = (player1.velocity + player2.velocity) / 2
        elif player1.lives > 0:
            avg_velocity = player1.velocity
        elif player2 and player2.lives > 0:
            avg_velocity = player2.velocity
        else:
            avg_velocity = pygame.Vector2(0, 0)

        # Update camera offset (accumulate movement for parallax)
        self.camera_offset[0] += avg_velocity.x * STARFIELD_PARALLAX_STRENGTH
        self.camera_offset[1] += avg_velocity.y * STARFIELD_PARALLAX_STRENGTH

    def draw(self, screen):
        """Draw all stars to the screen"""
        for star in self.stars:
            try:
                star.draw(screen, self.camera_offset)
            except IndexError:
                # Skip stars that are out of bounds (safety check)
                pass
