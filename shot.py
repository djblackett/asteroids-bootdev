from circleshape import CircleShape
import pygame

class Shot(CircleShape):
    def __init__(self, x, y, radius, direction, owner=None):
        super().__init__(x, y, radius)
        self.direction = direction
        self.owner = owner  # Reference to the player who shot this
        self.color = "white"  # Default color, can be changed (e.g., for UFO shots)
        
    def draw(self, screen, offset=(0, 0)):
        draw_pos = self.position + pygame.Vector2(offset[0], offset[1])
        pygame.draw.circle(screen, self.color, draw_pos, self.radius, 2)

    def update(self, dt):
        self.position += self.velocity * dt
