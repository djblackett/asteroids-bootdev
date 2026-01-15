from constants import ASTEROID_KINDS, ASTEROID_MAX_RADIUS, ASTEROID_MIN_RADIUS, ASTEROID_SPAWN_RATE, SCREEN_HEIGHT, SCREEN_WIDTH
import pygame
import random
from asteroid import Asteroid
from constants import *
from ufo import UFO


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
        # UFO spawn state
        self.ufo_spawn_timer = 0.0
        self.ufo_spawn_scheduled = False
        self.ufo_spawn_delay = 0.0
        self.players = []  # Will be set by main.py

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

        # Schedule UFO spawn if conditions are met
        if UFO_ENABLED and wave_number >= UFO_SPAWN_WAVE_START:
            if random.random() < UFO_SPAWN_CHANCE:
                self.ufo_spawn_scheduled = True
                self.ufo_spawn_delay = random.uniform(UFO_SPAWN_MIN_DELAY, UFO_SPAWN_MAX_DELAY)
                self.ufo_spawn_timer = 0.0

    def spawn_ufo(self, ufo_group):
        """Spawn a UFO at a random edge"""
        # Check if we've hit the max active UFOs
        if len(ufo_group) >= UFO_MAX_ACTIVE:
            return

        # Determine UFO type based on wave number
        if self.current_wave >= UFO_SMALL_WAVE_START and random.random() < 0.4:
            ufo_type = "small"
        else:
            ufo_type = "large"

        # Spawn at a random edge
        edge = random.choice(self.edges)
        position = edge[1](random.uniform(0.2, 0.8))  # Spawn somewhere in middle 60% of edge

        # Create UFO
        ufo = UFO(position.x, position.y, ufo_type, self.players)
        print(f"UFO spawned! Type: {ufo_type}")

    def update(self, dt, spawn_rate=None):
        # Update UFO spawn timer if scheduled
        if self.ufo_spawn_scheduled:
            self.ufo_spawn_timer += dt
            # Timer is checked in main.py, flag is cleared there after spawning

        # Use provided spawn_rate or fall back to constant
        current_spawn_rate = spawn_rate if spawn_rate is not None else ASTEROID_SPAWN_RATE

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
                    # print(f"[DEBUG] Spawned asteroid, {self.asteroids_to_spawn} remaining in wave {self.current_wave}")
        else:
            # Original continuous spawning with dynamic spawn rate
            self.spawn_timer += dt
            if self.spawn_timer > current_spawn_rate:
                self.spawn_timer = 0

                # spawn a new asteroid at a random edge
                edge = random.choice(self.edges)
                speed = random.randint(40, 100)
                velocity = edge[0] * speed
                velocity = velocity.rotate(random.randint(-30, 30))
                position = edge[1](random.uniform(0, 1))
                kind = random.randint(1, ASTEROID_KINDS)
                self.spawn(ASTEROID_MIN_RADIUS * kind, position, velocity)