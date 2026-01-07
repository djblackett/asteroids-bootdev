
import pygame
from circleshape import CircleShape
from constants import (PLAYER_RADIUS, PLAYER_SHOOT_COOLDOWN, PLAYER_SHOOT_SPEED,
                      PLAYER_SPEED, PLAYER_TURN_SPEED, SHOT_RADIUS,
                      RAPID_FIRE_COOLDOWN, RAPID_FIRE_DURATION,
                      MULTI_SHOT_DURATION, MULTI_SHOT_ANGLE_SPREAD,
                      MEGA_POWER_DURATION, SCREEN_WIDTH, SCREEN_HEIGHT,
                      BOUNDARY_BOUNCE_FORCE, EXHAUST_PARTICLE_SPAWN_RATE)
from shot import Shot
from soundeffects import play_shoot_sound


class Player(CircleShape):
    def __init__(self, x, y):
        super().__init__(x, y, PLAYER_RADIUS)
        self.rotation = 0
        self.timer = 0
        self.rapid_fire_active = False
        self.rapid_fire_timer = 0
        self.shield_active = False
        self.multi_shot_active = False
        self.multi_shot_timer = 0
        self.mega_power_active = False
        self.mega_power_timer = 0
        self.bounce_info = None  # Store bounce collision info for visual effects
        self.exhaust_timer = 0  # Timer for spawning exhaust particles
        self.is_moving = False  # Track if player is currently moving
    
    # in the player class
    def triangle(self, offset=(0, 0)):
        forward = pygame.Vector2(0, 1).rotate(self.rotation)
        right = pygame.Vector2(0, 1).rotate(self.rotation + 90) * self.radius / 1.5  # type: ignore
        offset_vec = pygame.Vector2(float(offset[0]), float(offset[1]))
        base_pos = self.position + offset_vec
        forward_scaled = forward * self.radius  # type: ignore
        a = base_pos + forward_scaled  # type: ignore
        b = base_pos - forward_scaled - right  # type: ignore
        c = base_pos - forward_scaled + right  # type: ignore
        return [a, b, c]

    def draw(self, screen, offset=(0, 0)):
        # Change color based on active power-ups
        if self.mega_power_active:
            # Rainbow effect for MEGA POWER
            time = pygame.time.get_ticks() / 100
            hue = (time % 360) / 360.0
            import colorsys
            r, g, b = colorsys.hsv_to_rgb(hue, 1.0, 1.0)
            color = (int(r * 255), int(g * 255), int(b * 255))
        elif self.rapid_fire_active:
            color = (255, 255, 0)  # Yellow for rapid fire
        elif self.multi_shot_active:
            color = (255, 165, 0)  # Orange for multi-shot
        else:
            color = (255, 255, 255)  # White default

        pygame.draw.polygon(screen, color, self.triangle(offset), 2)

        # Draw shield if active
        if self.shield_active:
            shield_color = (0, 255, 255)  # Cyan
            # Pulsing shield effect
            pulse = abs(pygame.time.get_ticks() % 1000 - 500) / 500
            shield_radius = int(self.radius * (1.5 + 0.3 * pulse))
            shield_pos = self.position + pygame.Vector2(offset[0], offset[1])
            pygame.draw.circle(screen, shield_color, (int(shield_pos.x), int(shield_pos.y)), shield_radius, 2)
    
    def rotate(self, dt):
        self.rotation += dt * PLAYER_TURN_SPEED

    def update(self, dt):
        keys = pygame.key.get_pressed()
        self.timer -= dt
        self.exhaust_timer -= dt

        # Apply bounce velocity with decay
        if self.velocity.length() > 0:
            self.position += self.velocity * dt
            # Decay the bounce velocity over time
            self.velocity *= 0.85

        # Update mega power timer
        if self.mega_power_active:
            self.mega_power_timer -= dt
            if self.mega_power_timer <= 0:
                self.mega_power_active = False
                # Deactivate all power-ups when mega power ends
                self.rapid_fire_active = False
                self.multi_shot_active = False

        # Update rapid fire timer (unless mega power is active)
        if self.rapid_fire_active and not self.mega_power_active:
            self.rapid_fire_timer -= dt
            if self.rapid_fire_timer <= 0:
                self.rapid_fire_active = False

        # Update multi-shot timer (unless mega power is active)
        if self.multi_shot_active and not self.mega_power_active:
            self.multi_shot_timer -= dt
            if self.multi_shot_timer <= 0:
                self.multi_shot_active = False

        # Track if player is moving this frame
        self.is_moving = False

        if keys[pygame.K_a]:
            self.rotate(-dt)
        if keys[pygame.K_d]:
            self.rotate(dt)
        if keys[pygame.K_w]:
            self.move(dt)
            self.is_moving = True
        if keys[pygame.K_s]:
            self.move(-dt)
            self.is_moving = True
        if keys[pygame.K_SPACE]:
            self.shoot()

    def move(self, dt):
        forward = pygame.Vector2(0, 1).rotate(self.rotation)
        self.position += forward * PLAYER_SPEED * dt

        # Check for boundary collisions and apply bounce
        self.bounce_info = self.check_boundary_collision()

    def check_boundary_collision(self):
        """Check for wall collisions and apply bounce-back effect"""
        bounced = False
        bounce_direction = pygame.Vector2(0, 0)

        # Check left wall
        if self.position.x - self.radius < 0:
            self.position.x = self.radius
            bounce_direction.x = 1
            bounced = True

        # Check right wall
        if self.position.x + self.radius > SCREEN_WIDTH:
            self.position.x = SCREEN_WIDTH - self.radius
            bounce_direction.x = -1
            bounced = True

        # Check top wall
        if self.position.y - self.radius < 0:
            self.position.y = self.radius
            bounce_direction.y = 1
            bounced = True

        # Check bottom wall
        if self.position.y + self.radius > SCREEN_HEIGHT:
            self.position.y = SCREEN_HEIGHT - self.radius
            bounce_direction.y = -1
            bounced = True

        # Apply bounce-back velocity if we hit a wall
        if bounced:
            # Normalize the bounce direction and apply bounce force
            if bounce_direction.length() > 0:
                bounce_direction = bounce_direction.normalize()
                self.velocity = bounce_direction * BOUNDARY_BOUNCE_FORCE
                # Return collision info for particle effects and screen shake
                return {
                    'bounced': True,
                    'position': self.position.copy(),
                    'direction': bounce_direction
                }

        return None

    def get_exhaust_info(self):
        """Generate exhaust particle info if player is moving and timer expired"""
        if self.is_moving and self.exhaust_timer <= 0:
            # Reset timer
            self.exhaust_timer = EXHAUST_PARTICLE_SPAWN_RATE

            # Calculate exhaust spawn position (behind the ship)
            backward = pygame.Vector2(0, -1).rotate(self.rotation)
            exhaust_pos = self.position + backward * self.radius

            # Return exhaust info for particle creation
            return {
                'position': exhaust_pos,
                'direction': backward  # Particles go backward from ship
            }

        return None

    def shoot(self):
        if self.timer > 0:
            return None  # Prevent shooting if cooldown is active

        if self.multi_shot_active:
            # Shoot 3 bullets in a spread pattern
            for angle_offset in [-MULTI_SHOT_ANGLE_SPREAD, 0, MULTI_SHOT_ANGLE_SPREAD]:
                shot = Shot(self.position.x, self.position.y, SHOT_RADIUS, self.rotation + angle_offset)
                shot.velocity = pygame.Vector2(0, 1).rotate(self.rotation + angle_offset) * PLAYER_SHOOT_SPEED
        else:
            # Shoot single bullet
            shot = Shot(self.position.x, self.position.y, SHOT_RADIUS, self.rotation)
            shot.velocity = pygame.Vector2(0, 1).rotate(self.rotation) * PLAYER_SHOOT_SPEED

        play_shoot_sound()

        # Use rapid fire cooldown if active, otherwise normal cooldown
        if self.rapid_fire_active:
            self.timer = RAPID_FIRE_COOLDOWN
        else:
            self.timer = PLAYER_SHOOT_COOLDOWN

    def activate_rapid_fire(self):
        """Activate the rapid fire power-up"""
        self.rapid_fire_active = True
        self.rapid_fire_timer = RAPID_FIRE_DURATION

    def activate_shield(self):
        """Activate the shield power-up (one-hit protection)"""
        self.shield_active = True

    def activate_multi_shot(self):
        """Activate the multi-shot power-up"""
        self.multi_shot_active = True
        self.multi_shot_timer = MULTI_SHOT_DURATION

    def activate_mega_power(self):
        """Activate MEGA POWER - all power-ups at once!"""
        self.mega_power_active = True
        self.mega_power_timer = MEGA_POWER_DURATION
        # Activate all power-ups
        self.rapid_fire_active = True
        self.rapid_fire_timer = MEGA_POWER_DURATION
        self.multi_shot_active = True
        self.multi_shot_timer = MEGA_POWER_DURATION
        self.shield_active = True

    def take_damage(self):
        """Handle taking damage - returns True if player dies, False if shield absorbed it"""
        if self.shield_active:
            self.shield_active = False
            return False  # Shield absorbed the hit
        return True  # Player dies
       