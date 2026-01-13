import pygame
from constants import SCREEN_WIDTH, SCREEN_HEIGHT


class LaserBeam:
    """
    A laser beam that extends from the player to the edge of the screen.
    It destroys all asteroids in its path.
    """
    def __init__(self, x, y, direction, owner=None):
        self.start_pos = pygame.Vector2(x, y)
        self.direction = direction  # Angle in degrees
        self.owner = owner
        self.lifetime = 0.3  # Laser beam lasts for 0.3 seconds (visual effect)
        self.timer = 0
        self.width = 3  # Width of the laser beam

        # Calculate the end position (edge of screen)
        self.end_pos = self._calculate_end_position()

        # Track which asteroids we've already hit (to award points only once)
        self.hit_asteroids = set()

    def _calculate_end_position(self):
        """Calculate where the laser beam hits the edge of the screen"""
        # Direction vector
        direction_vec = pygame.Vector2(0, 1).rotate(self.direction)

        # Start from player position and extend to screen edge
        # We need to find the intersection with screen boundaries
        # Use a large multiplier to ensure we reach the edge
        max_distance = max(SCREEN_WIDTH, SCREEN_HEIGHT) * 2
        end = self.start_pos + direction_vec * max_distance

        # Clamp to screen boundaries
        end.x = max(0, min(SCREEN_WIDTH, end.x))
        end.y = max(0, min(SCREEN_HEIGHT, end.y))

        return end

    def update(self, dt):
        """Update the laser beam"""
        self.timer += dt
        return self.timer < self.lifetime  # Return False when expired

    def draw(self, screen, offset=(0, 0)):
        """Draw the laser beam"""
        # Calculate alpha based on remaining lifetime (fade out)
        alpha = int(255 * (1 - self.timer / self.lifetime))

        # Create a surface for the laser with alpha
        laser_surface = pygame.Surface((SCREEN_WIDTH, SCREEN_HEIGHT), pygame.SRCALPHA)

        # Draw the laser beam (bright cyan/blue color)
        start = self.start_pos + pygame.Vector2(offset[0], offset[1])
        end = self.end_pos + pygame.Vector2(offset[0], offset[1])

        # Draw outer glow (thicker, more transparent)
        glow_color = (100, 200, 255, alpha // 3)
        pygame.draw.line(laser_surface, glow_color, start, end, self.width * 3)

        # Draw main beam (brighter, thinner)
        beam_color = (200, 240, 255, alpha)
        pygame.draw.line(laser_surface, beam_color, start, end, self.width)

        # Draw core (brightest, thinnest)
        core_color = (255, 255, 255, alpha)
        pygame.draw.line(laser_surface, core_color, start, end, 1)

        screen.blit(laser_surface, (0, 0))

    def check_hit(self, asteroid):
        """Check if the laser beam hits an asteroid"""
        if id(asteroid) in self.hit_asteroids:
            return False  # Already hit this asteroid

        # Check if asteroid intersects with the laser line
        # Use point-to-line distance calculation
        if self._point_to_line_distance(asteroid.position) <= asteroid.radius:
            self.hit_asteroids.add(id(asteroid))
            return True

        return False

    def _point_to_line_distance(self, point):
        """Calculate the perpendicular distance from a point to the laser line"""
        # Vector from start to end
        line_vec = self.end_pos - self.start_pos
        line_length = line_vec.length()

        if line_length == 0:
            return (point - self.start_pos).length()

        # Normalized line vector
        line_norm = line_vec / line_length

        # Vector from start to point
        point_vec = point - self.start_pos

        # Project point onto line
        projection = point_vec.dot(line_norm)

        # Clamp projection to line segment
        projection = max(0, min(line_length, projection))

        # Find closest point on line
        closest = self.start_pos + line_norm * projection

        # Return distance from point to closest point on line
        return (point - closest).length()
