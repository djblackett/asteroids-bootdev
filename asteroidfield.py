from constants import ASTEROID_KINDS, ASTEROID_MAX_RADIUS, ASTEROID_MIN_RADIUS, ASTEROID_SPAWN_RATE, SCREEN_HEIGHT, SCREEN_WIDTH
import pygame
import random
from asteroid import Asteroid
from constants import *


class AsteroidField(pygame.sprite.Sprite):
    edges = [
        [
            pygame.Vector2(1, 0),
            lambda y: pygame.Vector2(-ASTEROID_MAX_RADIUS, y * SCREEN_HEIGHT),
        ],
        [
            pygame.Vector2(-1, 0),
            lambda y: pygame.Vector2(
                SCREEN_WIDTH + ASTEROID_MAX_RADIUS, y * SCREEN_HEIGHT
            ),
        ],
        [
            pygame.Vector2(0, 1),
            lambda x: pygame.Vector2(x * SCREEN_WIDTH, -ASTEROID_MAX_RADIUS),
        ],
        [
            pygame.Vector2(0, -1),
            lambda x: pygame.Vector2(
                x * SCREEN_WIDTH, SCREEN_HEIGHT + ASTEROID_MAX_RADIUS
            ),
        ],
    ]

    def __init__(self):
        pygame.sprite.Sprite.__init__(self, self.containers)
        self.spawn_timer = 0.0
        # Wave system state
        self.wave_mode = WAVE_SYSTEM_ENABLED
        self.current_wave = 1
        self.asteroids_to_spawn = 0
        self.wave_active = False
        self.break_timer = 0.0

    def spawn(self, radius, position, velocity):
        asteroid = Asteroid(position.x, position.y, radius)
        asteroid.velocity = velocity

    def start_wave(self, wave_number):
        """Initialize a new wave"""
        self.current_wave = wave_number
        self.asteroids_to_spawn = WAVE_BASE_ASTEROIDS + (wave_number - 1) * WAVE_ASTEROID_INCREMENT
        self.wave_active = True
        self.spawn_timer = 0.0
        print(f"Wave {wave_number} starting with {self.asteroids_to_spawn} asteroids!")

    def update(self, dt):
        if self.wave_mode:
            # Wave-based spawning
            if self.wave_active and self.asteroids_to_spawn > 0:
                self.spawn_timer += dt
                if self.spawn_timer > WAVE_SPAWN_DELAY:
                    self.spawn_timer = 0
                    self.asteroids_to_spawn -= 1

                    # spawn a new asteroid at a random edge
                    edge = random.choice(self.edges)
                    speed = random.randint(40, 100)
                    velocity = edge[0] * speed
                    velocity = velocity.rotate(random.randint(-30, 30))
                    position = edge[1](random.uniform(0, 1))
                    kind = random.randint(1, ASTEROID_KINDS)
                    self.spawn(ASTEROID_MIN_RADIUS * kind, position, velocity)
        else:
            # Original continuous spawning
            self.spawn_timer += dt
            if self.spawn_timer > ASTEROID_SPAWN_RATE:
                self.spawn_timer = 0

                # spawn a new asteroid at a random edge
                edge = random.choice(self.edges)
                speed = random.randint(40, 100)
                velocity = edge[0] * speed
                velocity = velocity.rotate(random.randint(-30, 30))
                position = edge[1](random.uniform(0, 1))
                kind = random.randint(1, ASTEROID_KINDS)
                self.spawn(ASTEROID_MIN_RADIUS * kind, position, velocity)