import pygame
import random
import math
from circleshape import CircleShape
from shot import Shot
from constants import (
    UFO_LARGE_RADIUS, UFO_LARGE_SPEED, UFO_LARGE_SHOOT_COOLDOWN, UFO_LARGE_SHOOT_ACCURACY,
    UFO_SMALL_RADIUS, UFO_SMALL_SPEED, UFO_SMALL_SHOOT_COOLDOWN, UFO_SMALL_SHOOT_ACCURACY,
    UFO_SHOT_SPEED, UFO_SHOT_RADIUS,
    SCREEN_WIDTH, SCREEN_HEIGHT
)


class UFO(CircleShape):
    """Enemy UFO that flies across the screen and shoots at players"""

    # Will be set in main.py
    containers = None

    # OPTIMIZATION: Cache unit vector for rotation calculations
    _UNIT_VECTOR = pygame.Vector2(0, 1)

    # OPTIMIZATION: Pre-computed light offset directions for each UFO type
    # These are unit vectors that get scaled by radius at draw time
    _LARGE_LIGHT_OFFSETS = None
    _SMALL_LIGHT_OFFSETS = None

    @classmethod
    def _init_light_offsets(cls):
        """Pre-compute light offset unit vectors (called once)"""
        if cls._LARGE_LIGHT_OFFSETS is None:
            # Large UFO has 3 lights
            cls._LARGE_LIGHT_OFFSETS = [
                cls._UNIT_VECTOR.rotate((360 / 3) * i) for i in range(3)
            ]
            # Small UFO has 2 lights
            cls._SMALL_LIGHT_OFFSETS = [
                cls._UNIT_VECTOR.rotate((360 / 2) * i) for i in range(2)
            ]

    def __init__(self, x, y, ufo_type="large", players=None):
        """
        Initialize a UFO

        Args:
            x, y: Starting position
            ufo_type: "large" or "small"
            players: List of player objects to target
        """
        # Set radius based on type
        radius = UFO_LARGE_RADIUS if ufo_type == "large" else UFO_SMALL_RADIUS
        super().__init__(x, y, radius)

        self.ufo_type = ufo_type
        self.players = players or []

        # Set properties based on type
        if ufo_type == "large":
            self.speed = UFO_LARGE_SPEED
            self.shoot_cooldown = UFO_LARGE_SHOOT_COOLDOWN
            self.accuracy = UFO_LARGE_SHOOT_ACCURACY
        else:  # small
            self.speed = UFO_SMALL_SPEED
            self.shoot_cooldown = UFO_SMALL_SHOOT_COOLDOWN
            self.accuracy = UFO_SMALL_SHOOT_ACCURACY

        # Movement state
        self.movement_timer = 0
        self.direction_change_interval = random.uniform(2.0, 4.0)  # Change direction every 2-4 seconds
        self.target_velocity = pygame.Vector2(0, 0)
        self._set_random_movement()

        # Shooting state
        self.shoot_timer = random.uniform(0.5, 1.5)  # Random initial delay before first shot

        # Visual state
        self.blink_timer = 0
        self.blink_state = False

        # OPTIMIZATION: Initialize light offsets if not already done
        self._init_light_offsets()

        # OPTIMIZATION: Pre-compute scaled light offsets for this UFO's radius
        light_dist = self.radius * 0.6
        if ufo_type == "large":
            self._light_offsets = [v * light_dist for v in self._LARGE_LIGHT_OFFSETS]
        else:
            self._light_offsets = [v * light_dist for v in self._SMALL_LIGHT_OFFSETS]

    def _set_random_movement(self):
        """Set a random movement direction"""
        # Random angle for movement
        # OPTIMIZATION: Use cached unit vector
        angle = random.uniform(0, 360)
        self.target_velocity = self._UNIT_VECTOR.rotate(angle) * self.speed

        # Small UFOs have more erratic movement
        if self.ufo_type == "small":
            # Sometimes move horizontally across screen
            if random.random() < 0.4:
                direction = random.choice([-1, 1])
                self.target_velocity = pygame.Vector2(direction * self.speed, 0)

    def _get_nearest_player(self):
        """Find the nearest living player"""
        living_players = [p for p in self.players if p.lives > 0 and not p.is_respawning]
        if not living_players:
            return None

        # Find closest player
        nearest = min(living_players, key=lambda p: self.position.distance_to(p.position))
        return nearest

    def _shoot_at_target(self, target_pos):
        """
        Shoot a projectile, potentially aimed at target position

        Args:
            target_pos: pygame.Vector2 position to aim at (or near)
        """
        # Calculate direction to target
        to_target = target_pos - self.position
        if to_target.length() == 0:
            # If somehow at same position, shoot random direction
            angle = random.uniform(0, 360)
        else:
            # Get angle to target
            angle = math.degrees(math.atan2(to_target.y, to_target.x)) - 90

            # Apply accuracy - add random deviation based on accuracy level
            # accuracy 0.0 = completely random (±180 degrees)
            # accuracy 1.0 = perfect aim (±0 degrees)
            max_deviation = 180 * (1 - self.accuracy)
            angle += random.uniform(-max_deviation, max_deviation)

        # Create the shot
        shot = Shot(self.position.x, self.position.y, UFO_SHOT_RADIUS, angle, owner=self)
        shot_direction = pygame.Vector2(0, 1).rotate(angle)
        shot.velocity = shot_direction * UFO_SHOT_SPEED

        # Color UFO shots differently (red/orange)
        shot.color = (255, 100, 100)  # Reddish color to distinguish from player shots

    def update(self, dt):
        """Update UFO state"""
        # Update movement
        self.movement_timer += dt
        if self.movement_timer >= self.direction_change_interval:
            self.movement_timer = 0
            self.direction_change_interval = random.uniform(2.0, 4.0)
            self._set_random_movement()

        # Smoothly interpolate towards target velocity
        self.velocity = self.velocity.lerp(self.target_velocity, min(1.0, dt * 2))

        # Move UFO
        self.position += self.velocity * dt

        # Wrap around screen edges
        if self.position.x < -self.radius:
            self.position.x = SCREEN_WIDTH + self.radius
        elif self.position.x > SCREEN_WIDTH + self.radius:
            self.position.x = -self.radius

        if self.position.y < -self.radius:
            self.position.y = SCREEN_HEIGHT + self.radius
        elif self.position.y > SCREEN_HEIGHT + self.radius:
            self.position.y = -self.radius

        # Update shooting
        self.shoot_timer -= dt
        if self.shoot_timer <= 0:
            self.shoot_timer = self.shoot_cooldown

            # Find target
            target = self._get_nearest_player()
            if target:
                self._shoot_at_target(target.position)
            else:
                # No players alive, shoot random direction
                random_pos = pygame.Vector2(random.uniform(0, SCREEN_WIDTH),
                                           random.uniform(0, SCREEN_HEIGHT))
                self._shoot_at_target(random_pos)

        # Update visual blink effect
        self.blink_timer += dt
        if self.blink_timer >= 0.3:
            self.blink_timer = 0
            self.blink_state = not self.blink_state

    def draw(self, screen, offset=(0, 0)):
        """Draw the UFO"""
        draw_pos = self.position + pygame.Vector2(offset[0], offset[1])

        # Choose color based on type and blink state
        if self.ufo_type == "large":
            # Large UFO - green color
            color = (100, 255, 100) if self.blink_state else (50, 200, 50)
        else:
            # Small UFO - purple/magenta color (more dangerous looking)
            color = (255, 100, 255) if self.blink_state else (200, 50, 200)

        # Draw UFO body (filled circle)
        pygame.draw.circle(screen, color, draw_pos, self.radius)

        # Draw dome (top half circle, lighter color)
        dome_color = tuple(min(255, c + 50) for c in color)
        dome_rect = pygame.Rect(draw_pos.x - self.radius,
                                draw_pos.y - self.radius,
                                self.radius * 2,
                                self.radius)
        pygame.draw.arc(screen, dome_color, dome_rect, 0, math.pi, 3)

        # Draw outline
        pygame.draw.circle(screen, "white", draw_pos, self.radius, 2)

        # Draw lights/windows (small dots)
        # OPTIMIZATION: Use pre-computed light offsets instead of creating Vector2 each frame
        light_color = (255, 255, 0) if self.blink_state else (100, 100, 0)
        for light_offset in self._light_offsets:
            light_pos = draw_pos + light_offset
            pygame.draw.circle(screen, light_color, light_pos, 2)
