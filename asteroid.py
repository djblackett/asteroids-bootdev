
import pygame
from circleshape import CircleShape
import random
from constants import (ASTEROID_MIN_RADIUS, POINTS_LARGE_ASTEROID, POINTS_MEDIUM_ASTEROID,
                      POINTS_SMALL_ASTEROID, ASTEROID_DEATH_DURATION, ASTEROID_DEATH_DURATION_MAX,
                      ASTEROID_SHAKE_INTENSITY, PARTICLE_COUNT_LARGE, PARTICLE_COUNT_MEDIUM,
                      PARTICLE_COUNT_SMALL, PARTICLE_SPEED, ASTEROID_ARCHETYPE_CONFIG,
                      ASTEROID_ARCHETYPE_STANDARD, ASTEROID_ARCHETYPE_ARMORED,
                      ASTEROID_ARMORED_HIT_FLASH_DURATION, ASTEROID_ARMORED_HIT_PARTICLES,
                      ASTEROID_ARMORED_HIT_SHAKE)
from soundeffects import play_explosion_sound


class Asteroid(CircleShape):
    def __init__(self, x, y, radius, archetype=ASTEROID_ARCHETYPE_STANDARD):
        super().__init__(x, y, radius)
        if archetype not in ASTEROID_ARCHETYPE_CONFIG:
            archetype = ASTEROID_ARCHETYPE_STANDARD
        self.archetype = archetype
        self.size_category = self.get_size_category()
        self.max_hit_points = self.get_archetype_config()["hit_points"]
        self.hit_points = self.max_hit_points
        self.dying = False
        self.death_timer = 0
        self.death_timer_real = 0  # Real-world time for capping duration
        self.shake_offset = pygame.Vector2(0, 0)
        self.hit_flash_timer = 0.0

    def get_archetype_config(self):
        """Return the config for this asteroid archetype."""
        return ASTEROID_ARCHETYPE_CONFIG[self.archetype]

    def get_size_category(self):
        """Determine the size category and point value of this asteroid"""
        if self.radius >= 50:
            return "large"
        elif self.radius >= 30:
            return "medium"
        else:
            return "small"

    def get_points(self):
        """Get the point value for destroying this asteroid"""
        if self.size_category == "large":
            base_points = POINTS_LARGE_ASTEROID
        elif self.size_category == "medium":
            base_points = POINTS_MEDIUM_ASTEROID
        else:
            base_points = POINTS_SMALL_ASTEROID

        config = self.get_archetype_config()
        return int(base_points * config["points_multiplier"] + config["points_bonus"])

    def is_armored(self):
        """Return True when this asteroid uses the armored archetype."""
        return self.archetype == ASTEROID_ARCHETYPE_ARMORED

    def get_hit_effect_info(self):
        """Return effect info for a non-lethal hit."""
        return {
            "position": self.position.copy(),
            "particle_count": ASTEROID_ARMORED_HIT_PARTICLES,
            "shake_amount": ASTEROID_ARMORED_HIT_SHAKE,
        }

    def take_hit(self):
        """Apply a hit and return a result describing whether the asteroid was destroyed."""
        if self.dying:
            return {"destroyed": False, "effect_info": None}

        self.hit_points -= 1
        if self.hit_points <= 0:
            return {"destroyed": True, "effect_info": None}

        self.hit_flash_timer = ASTEROID_ARMORED_HIT_FLASH_DURATION
        return {"destroyed": False, "effect_info": self.get_hit_effect_info()}
    
    def draw(self, screen, offset=(0, 0)):
        # Apply screen shake offset and death shake
        draw_pos = self.position + self.shake_offset + pygame.Vector2(offset[0], offset[1])

        # Flash effect when dying
        if self.dying:
            # Alternate between white and darker color
            flash = int(self.death_timer * 30) % 2
            color = (255, 255, 255) if flash else (150, 150, 150)
        else:
            color = self.get_archetype_config()["color"]
            if self.hit_flash_timer > 0:
                color = (255, 255, 255)

        pygame.draw.circle(
            screen,
            color,
            draw_pos,
            self.radius,
            self.get_archetype_config()["outline_width"],
        )

        if self.is_armored():
            inner_radius = max(self.radius - 8, 6)
            inner_width = 2 if self.hit_points < self.max_hit_points else 1
            pygame.draw.circle(screen, color, draw_pos, inner_radius, inner_width)
    
    def update(self, dt, real_dt=None):
        if self.hit_flash_timer > 0:
            self.hit_flash_timer = max(0.0, self.hit_flash_timer - dt)

        if self.dying:
            # Update death animation using scaled time
            self.death_timer += dt

            # Update real-world timer (if provided, otherwise use scaled dt)
            if real_dt is not None:
                self.death_timer_real += real_dt
            else:
                self.death_timer_real += dt

            # Random shake effect
            self.shake_offset = pygame.Vector2(
                random.uniform(-ASTEROID_SHAKE_INTENSITY, ASTEROID_SHAKE_INTENSITY),
                random.uniform(-ASTEROID_SHAKE_INTENSITY, ASTEROID_SHAKE_INTENSITY)
            )

            # End death animation if either condition is met:
            # 1. Normal death duration reached, OR
            # 2. Maximum real-world duration reached (prevents indefinite shaking in slow games)
            if self.death_timer >= ASTEROID_DEATH_DURATION or self.death_timer_real >= ASTEROID_DEATH_DURATION_MAX:
                # Actually destroy the asteroid now
                self.kill()
                self.spawn_children()
                return
        else:
            self.position += self.velocity * dt

            # Despawn asteroids that go off screen
            from constants import SCREEN_WIDTH, SCREEN_HEIGHT

            if (self.position.x < -self.radius or
                self.position.x > SCREEN_WIDTH + self.radius or
                self.position.y < -self.radius or
                self.position.y > SCREEN_HEIGHT + self.radius):
                self.kill()  # Remove asteroid when it goes off-screen

    def get_particle_count(self):
        """Get number of particles to spawn based on size"""
        if self.size_category == "large":
            return PARTICLE_COUNT_LARGE
        elif self.size_category == "medium":
            return PARTICLE_COUNT_MEDIUM
        else:
            return PARTICLE_COUNT_SMALL

    def get_screen_shake_amount(self):
        """Get screen shake intensity based on asteroid size"""
        from constants import SCREEN_SHAKE_LARGE, SCREEN_SHAKE_MEDIUM, SCREEN_SHAKE_SMALL
        if self.size_category == "large":
            return SCREEN_SHAKE_LARGE
        elif self.size_category == "medium":
            return SCREEN_SHAKE_MEDIUM
        else:
            return SCREEN_SHAKE_SMALL

    def split(self):
        """Start the death animation instead of instant destruction"""
        if not self.dying:
            self.dying = True
            self.death_timer = 0
            play_explosion_sound(self.radius)
            # Return info for particles and screen shake
            return {
                'position': self.position.copy(),
                'velocity': self.velocity.copy(),
                'particle_count': self.get_particle_count(),
                'shake_amount': self.get_screen_shake_amount()
            }
        return None

    def spawn_children(self):
        """Spawn child asteroids (called after death animation completes)"""
        if self.radius <= ASTEROID_MIN_RADIUS:
            return
        random_rotation = random.uniform(20, 50)
        child_vector = self.velocity.rotate(random_rotation)
        child_vector2 = self.velocity.rotate(-random_rotation)

        new_radius = self.radius - ASTEROID_MIN_RADIUS
        # Spawn children offset from parent to avoid immediate collision with player
        # Use the velocity directions to push them away from the collision point
        offset_distance = new_radius * 1.5  # Offset by 1.5x the child radius
        offset1 = child_vector.normalize() * offset_distance
        offset2 = child_vector2.normalize() * offset_distance

        child_archetype = (
            ASTEROID_ARCHETYPE_STANDARD if self.is_armored() else self.archetype
        )
        child1 = Asteroid(
            self.position.x + offset1.x,
            self.position.y + offset1.y,
            new_radius,
            archetype=child_archetype,
        )
        child2 = Asteroid(
            self.position.x + offset2.x,
            self.position.y + offset2.y,
            new_radius,
            archetype=child_archetype,
        )
        child1.velocity = child_vector * 1.2
        child2.velocity = child_vector2 * 1.2
        

