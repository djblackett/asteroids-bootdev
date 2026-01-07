import pygame
from pygame import Vector2
import random


class Particle:
    """Visual particle effect for asteroid breakup"""

    def __init__(self, x, y, velocity_direction):
        self.position = Vector2(x, y)
        # Add some randomness to the velocity direction
        angle_offset = random.uniform(-30, 30)
        self.velocity = velocity_direction.rotate(angle_offset)
        self.lifetime = 0
        self.max_lifetime = random.uniform(0.3, 0.5)
        self.size = random.randint(2, 4)

    def update(self, dt):
        """Update particle position and lifetime"""
        self.position += self.velocity * dt
        self.lifetime += dt
        # Slow down over time
        self.velocity *= 0.95
        return self.lifetime < self.max_lifetime

    def draw(self, screen, offset=(0, 0)):
        """Draw the particle with screen shake offset"""
        if self.lifetime >= self.max_lifetime:
            return

        # Fade out over lifetime
        alpha = 1.0 - (self.lifetime / self.max_lifetime)
        color_value = int(255 * alpha)
        color = (color_value, color_value, color_value)

        # Apply screen shake offset
        draw_pos = (
            int(self.position.x + offset[0]),
            int(self.position.y + offset[1])
        )

        pygame.draw.circle(screen, color, draw_pos, int(self.size * alpha), 0)
