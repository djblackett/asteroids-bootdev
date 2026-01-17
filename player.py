import pygame
from circleshape import CircleShape
from constants import (PLAYER_RADIUS, PLAYER_SHOOT_COOLDOWN, PLAYER_SHOOT_SPEED,
                       PLAYER_SPEED, PLAYER_TURN_SPEED, SHOT_RADIUS,
                       RAPID_FIRE_COOLDOWN, RAPID_FIRE_DURATION,
                       MULTI_SHOT_DURATION, MULTI_SHOT_ANGLE_SPREAD,
                       MEGA_POWER_DURATION, SCREEN_WIDTH, SCREEN_HEIGHT,
                       BOUNDARY_BOUNCE_FORCE, EXHAUST_PARTICLE_SPAWN_RATE,
                       LASER_BEAM_MAX_SHOTS, LASER_BEAM_COOLDOWN,
                       BOOST_DURATION, BOOST_SPEED_MULTIPLIER, BOOST_COOLDOWN)
from shot import Shot
from soundeffects import play_shoot_sound, play_laser_sound, play_boost_sound
import frametime  # OPTIMIZATION: Use cached get_ticks() per frame
import colorutils  # OPTIMIZATION: Pre-computed rainbow colors


class Player(CircleShape):
    # OPTIMIZATION: Cache unit vectors to avoid repeated Vector2 creation
    # These are used frequently in triangle(), move(), and draw()
    _UNIT_FORWARD = pygame.Vector2(0, 1)
    _UNIT_BACKWARD = pygame.Vector2(0, -1)

    def __init__(self, x, y, input_source="keyboard", player_number=1, speed_multiplier=1.0):
        super().__init__(x, y, PLAYER_RADIUS)
        self.rotation = 0
        self.timer = 0
        self.can_shoot = True  # Flag to prevent shooting during game start
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
        self.input_source = input_source  # "keyboard", "gamepad_0", "gamepad_1"
        self.player_number = player_number  # 1 or 2
        self.lives = 3  # Start with 3 lives
        self.respawn_timer = 0  # Timer for respawn invulnerability
        self.is_respawning = False  # Flag for respawn state
        self.score = 0  # Player's score
        self.speed_multiplier = speed_multiplier  # Speed multiplier from config

        self.position: pygame.Vector2 = pygame.Vector2(x, y)
        self.velocity: pygame.Vector2 = pygame.Vector2(0, 0)

        # Laser beam
        self.laser_shots_remaining = LASER_BEAM_MAX_SHOTS
        self.laser_cooldown = 0
        self.laser_key_pressed = False  # Track if laser key was already pressed

        # Boost
        self.boost_active = False
        self.boost_timer = 0
        self.boost_cooldown = 0
        self.boost_key_pressed = False  # Track if boost key was already pressed

        # Laser beam pending (to be picked up by main loop)
        self.pending_laser = None

    # in the player class
    def triangle(self, offset=(0, 0)):
        # OPTIMIZATION: Use cached unit vectors instead of creating new ones
        forward = self._UNIT_FORWARD.rotate(self.rotation)
        right = self._UNIT_FORWARD.rotate(
            self.rotation + 90) * self.radius / 1.5  # type: ignore
        offset_vec = pygame.Vector2(float(offset[0]), float(offset[1]))
        base_pos = self.position + offset_vec
        forward_scaled = forward * self.radius  # type: ignore
        a = base_pos + forward_scaled  # type: ignore
        b = base_pos - forward_scaled - right  # type: ignore
        c = base_pos - forward_scaled + right  # type: ignore
        return [a, b, c]

    def draw(self, screen, offset=(0, 0)):
        # Don't draw if dead
        if self.lives <= 0:
            return

        # Change color based on active power-ups or respawn state
        # OPTIMIZATION: Use cached get_ticks() instead of calling pygame.time.get_ticks()
        ticks = frametime.get_ticks()
        if self.is_respawning:
            # Flashing effect during respawn invulnerability
            if (ticks // 100) % 2 == 0:
                color = (100, 100, 100)  # Dim gray when flashing
            else:
                color = (255, 255, 255)  # White
        elif self.mega_power_active:
            # Rainbow effect for MEGA POWER
            # OPTIMIZATION: Use pre-computed rainbow lookup table instead of colorsys
            color = colorutils.get_rainbow_color(ticks, speed=100)
        elif self.boost_active:
            color = (255, 100, 255)  # Magenta for boost
        elif self.rapid_fire_active:
            color = (255, 255, 0)  # Yellow for rapid fire
        elif self.multi_shot_active:
            color = (255, 165, 0)  # Orange for multi-shot
        else:
            color = (255, 255, 255)  # White default

        pygame.draw.polygon(screen, color, self.triangle(offset), 2)

        # Draw boost trail effect
        if self.boost_active:
            # OPTIMIZATION: Use cached unit vector
            backward = self._UNIT_BACKWARD.rotate(self.rotation)
            for i in range(1, 4):
                trail_pos = self.position + backward * (self.radius * i * 0.5)
                trail_alpha = 255 - (i * 60)
                trail_radius = int(self.radius * (1 - i * 0.2))
                trail_offset = pygame.Vector2(offset[0], offset[1])
                draw_pos = trail_pos + trail_offset
                pygame.draw.circle(screen, (255, 100, 255), (int(
                    draw_pos.x), int(draw_pos.y)), trail_radius, 1)

            # Draw warning indicator when boost is about to wear off (last 1 second)
            if self.boost_timer <= 1.0:
                # Create a pulsing ring effect
                pulse_speed = 8.0  # pulses per second
                # OPTIMIZATION: Reuse cached ticks from earlier in draw()
                pulse = abs((ticks / 1000.0 *
                            pulse_speed) % 2 - 1)  # 0 to 1 and back

                # Warning ring around player
                warning_radius = int(self.radius * (1.8 + 0.4 * pulse))
                warning_color = (255, 255, 0)  # Yellow warning
                warning_thickness = 2 if pulse > 0.5 else 3  # Pulsing thickness
                warning_pos = self.position + \
                    pygame.Vector2(offset[0], offset[1])
                pygame.draw.circle(screen, warning_color, (int(warning_pos.x), int(
                    warning_pos.y)), warning_radius, warning_thickness)

        # Draw shield if active
        if self.shield_active:
            shield_color = (0, 255, 255)  # Cyan
            # Pulsing shield effect
            # OPTIMIZATION: Reuse cached ticks from earlier in draw()
            pulse = abs(ticks % 1000 - 500) / 500
            shield_radius = int(self.radius * (1.5 + 0.3 * pulse))
            shield_pos = self.position + pygame.Vector2(offset[0], offset[1])
            pygame.draw.circle(screen, shield_color, (int(
                shield_pos.x), int(shield_pos.y)), shield_radius, 2)

    def rotate(self, dt):
        self.rotation += dt * PLAYER_TURN_SPEED

    def update(self, dt):
        # Don't update if dead
        if self.lives <= 0:
            return

        keys = pygame.key.get_pressed()
        self.timer -= dt
        self.exhaust_timer -= dt

        # Update laser cooldown
        if self.laser_cooldown > 0:
            self.laser_cooldown -= dt

        # Update boost timers
        if self.boost_active:
            self.boost_timer -= dt
            if self.boost_timer <= 0:
                self.boost_active = False
        if self.boost_cooldown > 0:
            self.boost_cooldown -= dt

        # Update respawn timer
        if self.is_respawning:
            self.respawn_timer -= dt
            if self.respawn_timer <= 0:
                self.is_respawning = False

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
                # Deactivate timed power-ups when mega power ends
                self.rapid_fire_active = False
                self.multi_shot_active = False
                # Note: shield_active is NOT deactivated here because shields last until hit

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

        # Get input based on input source
        rotate_input = 0
        move_input = 0
        shoot_input = False
        laser_input = False
        boost_input = False

        if self.input_source == "keyboard":
            # Player 1 keyboard controls (WASD + Space)
            if keys[pygame.K_a]:
                rotate_input = -1
            if keys[pygame.K_d]:
                rotate_input = 1
            if keys[pygame.K_w]:
                move_input = 1
            if keys[pygame.K_s]:
                move_input = -1
            if keys[pygame.K_SPACE]:
                shoot_input = True
            if keys[pygame.K_e]:
                laser_input = True
            if keys[pygame.K_LSHIFT]:
                boost_input = True
        elif self.input_source == "keyboard_2":
            # Player 2 keyboard controls (Arrow keys + Enter)
            if keys[pygame.K_LEFT]:
                rotate_input = -1
            if keys[pygame.K_RIGHT]:
                rotate_input = 1
            if keys[pygame.K_UP]:
                move_input = 1
            if keys[pygame.K_DOWN]:
                move_input = -1
            if keys[pygame.K_RETURN]:
                shoot_input = True
            if keys[pygame.K_RSHIFT]:
                laser_input = True
            if keys[pygame.K_RCTRL]:
                boost_input = True
        elif self.input_source.startswith("gamepad"):
            # Get gamepad index from input_source (e.g., "gamepad_0" -> 0)
            gamepad_index = int(self.input_source.split("_")[1])
            if pygame.joystick.get_count() > gamepad_index:
                joystick = pygame.joystick.Joystick(gamepad_index)

                # Left stick horizontal for rotation (axis 0)
                left_stick_x = joystick.get_axis(0)
                if abs(left_stick_x) > 0.15:
                    rotate_input = left_stick_x

                # Left stick vertical for movement (axis 1)
                left_stick_y = joystick.get_axis(1)
                if abs(left_stick_y) > 0.15:
                    move_input = -left_stick_y

                # Right trigger for shooting (axis 5, or button 0 as fallback)
                try:
                    right_trigger = joystick.get_axis(5)
                    shoot_input = right_trigger > 0.5
                except:
                    pass

                # Also check A button (button 0) for shooting
                if joystick.get_button(0):
                    shoot_input = True

                # X button (button 2) for laser
                if joystick.get_button(2):
                    laser_input = True

                # B button (button 1) for boost
                if joystick.get_button(1):
                    boost_input = True

        # Handle rotation
        if rotate_input != 0:
            self.rotate(rotate_input * dt)

        # Handle movement
        if move_input != 0:
            self.move(move_input * dt)
            self.is_moving = True

        # Handle shooting
        if shoot_input:
            self.shoot()

        # Handle laser beam (only trigger once per key press)
        if laser_input and not self.laser_key_pressed:
            self.shoot_laser()
            self.laser_key_pressed = True
        elif not laser_input:
            self.laser_key_pressed = False

        # Handle boost (only trigger once per key press)
        if boost_input and not self.boost_key_pressed:
            self.activate_boost()
            self.boost_key_pressed = True
        elif not boost_input:
            self.boost_key_pressed = False

    def move(self, dt):
        # OPTIMIZATION: Use cached unit vector instead of creating new one
        forward = self._UNIT_FORWARD.rotate(self.rotation)
        # Apply boost speed multiplier if boost is active
        speed_mult = self.speed_multiplier * \
            (BOOST_SPEED_MULTIPLIER if self.boost_active else 1.0)
        self.position += forward * PLAYER_SPEED * speed_mult * dt

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
            # OPTIMIZATION: Use cached unit vector
            backward = self._UNIT_BACKWARD.rotate(self.rotation)
            exhaust_pos = self.position + backward * float(self.radius)

            # Return exhaust info for particle creation
            return {
                'position': exhaust_pos,
                'direction': backward  # Particles go backward from ship
            }

        return None

    def shoot(self):
        if self.timer > 0:
            return None  # Prevent shooting if cooldown is active

        # Can't shoot if disabled (e.g., during game start)
        if not self.can_shoot:
            return None

        # Can't shoot while boosting
        if self.boost_active:
            return None

        if self.multi_shot_active:
            # Shoot 3 bullets in a spread pattern
            for angle_offset in [-MULTI_SHOT_ANGLE_SPREAD, 0, MULTI_SHOT_ANGLE_SPREAD]:
                shot = Shot(self.position.x, self.position.y,
                            SHOT_RADIUS, self.rotation + angle_offset, self)
                # OPTIMIZATION: Use cached unit vector
                shot.velocity = self._UNIT_FORWARD.rotate(
                    self.rotation + angle_offset) * PLAYER_SHOOT_SPEED
        else:
            # Shoot single bullet
            shot = Shot(self.position.x, self.position.y,
                        SHOT_RADIUS, self.rotation, self)
            # OPTIMIZATION: Use cached unit vector
            shot.velocity = self._UNIT_FORWARD.rotate(
                self.rotation) * PLAYER_SHOOT_SPEED

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
        """Handle taking damage - returns True if player loses a life, False if shield absorbed it"""
        # Invulnerable during respawn
        if self.is_respawning:
            return False

        if self.shield_active:
            self.shield_active = False
            return False  # Shield absorbed the hit

        # Lose a life
        self.lives -= 1
        return True  # Player took damage

    def respawn(self, x, y):
        """Respawn the player at the given position with temporary invulnerability"""
        if self.lives <= 0:
            return  # Can't respawn if no lives left

        self.position.x = x
        self.position.y = y
        self.rotation = 0
        self.velocity = pygame.Vector2(0, 0)
        self.is_respawning = True
        self.respawn_timer = 2.0  # 2 seconds of invulnerability

        # Clear all power-ups on respawn
        self.rapid_fire_active = False
        self.multi_shot_active = False
        self.mega_power_active = False
        self.shield_active = False

        # Clear boost on respawn
        self.boost_active = False
        self.boost_timer = 0

    def shoot_laser(self):
        """Shoot a laser beam that penetrates all asteroids in a line"""
        if self.laser_cooldown > 0 or self.laser_shots_remaining <= 0:
            return

        # Import here to avoid circular dependency
        from laserbeam import LaserBeam

        # Calculate laser starting position at the tip of the ship
        # OPTIMIZATION: Use cached unit vector
        forward = self._UNIT_FORWARD.rotate(self.rotation)
        laser_start = self.position + forward * float(self.radius)

        # Create laser beam from the tip of the ship
        self.pending_laser = LaserBeam(
            laser_start.x, laser_start.y, self.rotation, self)

        # Update cooldown and shots remaining
        self.laser_cooldown = LASER_BEAM_COOLDOWN
        self.laser_shots_remaining -= 1

        play_laser_sound()

    def activate_boost(self):
        """Activate the boost ability"""
        if self.boost_cooldown > 0 or self.boost_active:
            return

        self.boost_active = True
        self.boost_timer = BOOST_DURATION
        self.boost_cooldown = BOOST_COOLDOWN

        play_boost_sound()
