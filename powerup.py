import pygame
from circleshape import CircleShape
import random


class PowerUp(CircleShape):
    RAPID_FIRE = "rapid_fire"
    SHIELD = "shield"
    MULTI_SHOT = "multi_shot"
    SLOW_MOTION = "slow_motion"
    MEGA_POWER = "mega_power"
    containers = None

    def __init__(self, x, y, powerup_type):
        super().__init__(x, y, 15)  # Power-ups have radius of 15
        self.powerup_type = powerup_type
        self.lifetime = 12.0  # Power-up disappears after 12 seconds if not collected

        # Slow floating movement
        angle = random.uniform(0, 360)
        speed = 30
        self.velocity = pygame.Vector2(0, 1).rotate(angle) * speed

    def draw(self, screen, offset=(0, 0)):
        pos = self.position + pygame.Vector2(offset[0], offset[1])
        center = (int(pos.x), int(pos.y))
        pulse = abs(pygame.time.get_ticks() % 1000 - 500) / 500
        radius = int(self.radius * (0.8 + 0.4 * pulse))

        if self.powerup_type == self.RAPID_FIRE:
            # Yellow star/cross for rapid fire
            color = (255, 255, 0)

            # Draw cross/star shape
            pygame.draw.line(screen, color,
                           (center[0], center[1] - radius),
                           (center[0], center[1] + radius), 3)
            pygame.draw.line(screen, color,
                           (center[0] - radius, center[1]),
                           (center[0] + radius, center[1]), 3)

            # Draw diagonal lines for star effect
            offset = int(radius * 0.7)
            pygame.draw.line(screen, color,
                           (center[0] - offset, center[1] - offset),
                           (center[0] + offset, center[1] + offset), 2)
            pygame.draw.line(screen, color,
                           (center[0] + offset, center[1] - offset),
                           (center[0] - offset, center[1] + offset), 2)

            # Draw outer circle
            pygame.draw.circle(screen, color, center, radius, 2)

        elif self.powerup_type == self.SHIELD:
            # Cyan hexagon for shield
            color = (0, 255, 255)

            # Draw hexagon
            points = []
            for i in range(6):
                angle = 60 * i
                x = center[0] + radius * pygame.math.Vector2(0, 1).rotate(angle).x
                y = center[1] + radius * pygame.math.Vector2(0, 1).rotate(angle).y
                points.append((x, y))
            pygame.draw.polygon(screen, color, points, 3)

            # Draw inner circle
            pygame.draw.circle(screen, color, center, int(radius * 0.5), 2)

        elif self.powerup_type == self.MULTI_SHOT:
            # Orange triple arrows for multi-shot
            color = (255, 165, 0)

            # Draw three arrows
            arrow_length = radius
            for offset in [-20, 0, 20]:
                tip_x = center[0] + pygame.math.Vector2(0, 1).rotate(90 + offset).x * arrow_length
                tip_y = center[1] + pygame.math.Vector2(0, 1).rotate(90 + offset).y * arrow_length

                # Arrow shaft
                pygame.draw.line(screen, color, center, (tip_x, tip_y), 2)

                # Arrow head
                head_size = radius * 0.4
                left_x = tip_x + pygame.math.Vector2(0, 1).rotate(90 + offset - 150).x * head_size
                left_y = tip_y + pygame.math.Vector2(0, 1).rotate(90 + offset - 150).y * head_size
                right_x = tip_x + pygame.math.Vector2(0, 1).rotate(90 + offset + 150).x * head_size
                right_y = tip_y + pygame.math.Vector2(0, 1).rotate(90 + offset + 150).y * head_size

                pygame.draw.line(screen, color, (tip_x, tip_y), (left_x, left_y), 2)
                pygame.draw.line(screen, color, (tip_x, tip_y), (right_x, right_y), 2)

        elif self.powerup_type == self.SLOW_MOTION:
            # Purple/magenta clock for slow motion
            color = (255, 0, 255)

            # Draw clock circle
            pygame.draw.circle(screen, color, center, radius, 3)

            # Draw clock hands
            # Hour hand (short)
            hand_angle = (pygame.time.get_ticks() / 20) % 360
            hand_x = center[0] + pygame.math.Vector2(0, 1).rotate(hand_angle).x * (radius * 0.5)
            hand_y = center[1] + pygame.math.Vector2(0, 1).rotate(hand_angle).y * (radius * 0.5)
            pygame.draw.line(screen, color, center, (hand_x, hand_y), 3)

            # Minute hand (long)
            hand_angle2 = (pygame.time.get_ticks() / 5) % 360
            hand_x2 = center[0] + pygame.math.Vector2(0, 1).rotate(hand_angle2).x * (radius * 0.8)
            hand_y2 = center[1] + pygame.math.Vector2(0, 1).rotate(hand_angle2).y * (radius * 0.8)
            pygame.draw.line(screen, color, center, (hand_x2, hand_y2), 2)

        elif self.powerup_type == self.MEGA_POWER:
            # Rainbow spinning star for MEGA POWER
            # Create rainbow effect with cycling colors
            time = pygame.time.get_ticks() / 100
            hue = (time % 360) / 360.0

            # Convert HSV to RGB for rainbow effect
            def hsv_to_rgb(h, s, v):
                import colorsys
                r, g, b = colorsys.hsv_to_rgb(h, s, v)
                return (int(r * 255), int(g * 255), int(b * 255))

            color1 = hsv_to_rgb(hue, 1.0, 1.0)
            color2 = hsv_to_rgb((hue + 0.33) % 1.0, 1.0, 1.0)
            color3 = hsv_to_rgb((hue + 0.66) % 1.0, 1.0, 1.0)

            # Draw multiple rotating stars
            rotation = (pygame.time.get_ticks() / 10) % 360

            # Outer star (8 points)
            for i in range(8):
                angle = rotation + (i * 45)
                line_radius = radius * 1.2
                x = center[0] + pygame.math.Vector2(0, 1).rotate(angle).x * line_radius
                y = center[1] + pygame.math.Vector2(0, 1).rotate(angle).y * line_radius
                color = [color1, color2, color3][i % 3]
                pygame.draw.line(screen, color, center, (x, y), 3)

            # Draw pulsing circles
            circle_radius = int(radius * (1.0 + 0.5 * pulse))
            pygame.draw.circle(screen, color1, center, circle_radius, 3)
            pygame.draw.circle(screen, color2, center, int(circle_radius * 0.7), 2)
            pygame.draw.circle(screen, color3, center, int(circle_radius * 0.4), 2)

    def update(self, dt):
        # Move the power-up
        self.position += self.velocity * dt

        # Decrease lifetime
        self.lifetime -= dt

        # Remove if lifetime expired
        if self.lifetime <= 0:
            self.kill()

        # Wrap around screen edges
        from constants import SCREEN_WIDTH, SCREEN_HEIGHT
        if self.position.x < 0:
            self.position.x = SCREEN_WIDTH
        elif self.position.x > SCREEN_WIDTH:
            self.position.x = 0
        if self.position.y < 0:
            self.position.y = SCREEN_HEIGHT
        elif self.position.y > SCREEN_HEIGHT:
            self.position.y = 0
