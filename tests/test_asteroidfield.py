import pygame
import pytest

import asteroidfield as field_module
from asteroidfield import AsteroidField
from constants import (
    ASTEROID_MIN_RADIUS,
    ASTEROID_SPAWN_RATE,
    WAVE_BASE_ASTEROIDS,
    WAVE_ASTEROID_INCREMENT,
    WAVE_SPAWN_DELAY,
    UFO_MAX_ACTIVE,
    UFO_SPAWN_MIN_DELAY,
)


def test_start_wave_initializes_state_and_schedules_ufo(monkeypatch):
    field = AsteroidField()
    field.wave_mode = True

    monkeypatch.setattr(field_module.random, "random", lambda: 0.0)
    monkeypatch.setattr(field_module.random, "uniform", lambda a, b: UFO_SPAWN_MIN_DELAY)

    field.start_wave(3)
    assert field.wave_active
    expected = WAVE_BASE_ASTEROIDS + (3 - 1) * WAVE_ASTEROID_INCREMENT
    assert field.asteroids_to_spawn == expected
    assert field.ufo_spawn_scheduled is True
    assert field.ufo_spawn_delay == UFO_SPAWN_MIN_DELAY


def test_update_wave_mode_spawns_asteroids(monkeypatch):
    field = AsteroidField()
    field.wave_mode = True
    field.wave_active = True
    field.asteroids_to_spawn = 2
    field.spawn_timer = WAVE_SPAWN_DELAY + 0.01

    spawned = []

    def fake_spawn(self, radius, position, velocity):
        spawned.append((radius, position, velocity))

    monkeypatch.setattr(AsteroidField, "spawn", fake_spawn, raising=False)
    monkeypatch.setattr(field_module.random, "choice", lambda seq: seq[0])
    monkeypatch.setattr(field_module.random, "randint", lambda a, b: a)

    field.update(0.1)
    assert len(spawned) == 1
    radius, position, velocity = spawned[0]
    assert radius == ASTEROID_MIN_RADIUS
    assert isinstance(position, pygame.Vector2)
    assert isinstance(velocity, pygame.Vector2)
    assert field.asteroids_to_spawn == 1


def test_update_continuous_spawning_when_wave_mode_disabled(monkeypatch):
    field = AsteroidField()
    field.wave_mode = False
    field.spawn_timer = ASTEROID_SPAWN_RATE + 0.01

    spawned = []

    def fake_spawn(self, radius, position, velocity):
        spawned.append((radius, position, velocity))

    monkeypatch.setattr(AsteroidField, "spawn", fake_spawn, raising=False)
    monkeypatch.setattr(field_module.random, "choice", lambda seq: seq[0])
    monkeypatch.setattr(field_module.random, "randint", lambda a, b: a)

    field.update(0.2)
    assert len(spawned) == 1


def test_spawn_ufo_respects_limits_and_type_selection(monkeypatch):
    field = AsteroidField()
    field.current_wave = 6  # allow small UFOs
    field.players = []

    created = []

    class DummyUFO:
        def __init__(self, x, y, ufo_type, players):
            created.append({"x": x, "y": y, "type": ufo_type, "players": players})

    monkeypatch.setattr(field_module, "UFO", DummyUFO)
    monkeypatch.setattr(field_module.random, "choice", lambda seq: seq[0])
    monkeypatch.setattr(field_module.random, "uniform", lambda a, b: (a + b) / 2)
    monkeypatch.setattr(field_module.random, "random", lambda: 0.0)

    # Too many active UFOs prevents spawn
    field.spawn_ufo([object()] * UFO_MAX_ACTIVE)
    assert created == []

    field.spawn_ufo([])
    assert len(created) == 1
    assert created[0]["type"] == "small"


def test_update_increments_ufo_spawn_timer_when_scheduled():
    field = AsteroidField()
    field.ufo_spawn_scheduled = True

    field.update(0.5)
    assert field.ufo_spawn_timer == pytest.approx(0.5)
