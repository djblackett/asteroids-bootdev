import pygame
import pytest

import asteroid as asteroid_module
from asteroid import Asteroid
from constants import (
    ASTEROID_MIN_RADIUS,
    ASTEROID_DEATH_DURATION,
    POINTS_LARGE_ASTEROID,
    POINTS_MEDIUM_ASTEROID,
    POINTS_SMALL_ASTEROID,
    SCREEN_WIDTH,
)


@pytest.fixture(autouse=True)
def mute_explosion_sound(monkeypatch):
    monkeypatch.setattr(asteroid_module, "play_explosion_sound", lambda *args, **kwargs: None)


def test_asteroid_size_categories_and_points():
    large = Asteroid(0, 0, 60)
    medium = Asteroid(0, 0, 35)
    small = Asteroid(0, 0, 15)

    assert large.get_size_category() == "large"
    assert medium.get_size_category() == "medium"
    assert small.get_size_category() == "small"

    assert large.get_points() == POINTS_LARGE_ASTEROID
    assert medium.get_points() == POINTS_MEDIUM_ASTEROID
    assert small.get_points() == POINTS_SMALL_ASTEROID


def test_split_starts_death_animation_and_returns_effect_info():
    asteroid = Asteroid(10, 10, 60)
    asteroid.velocity = pygame.Vector2(50, 0)

    info = asteroid.split()
    assert asteroid.dying
    assert pytest.approx(info["particle_count"]) == asteroid.get_particle_count()
    assert "shake_amount" in info


def test_update_dying_triggers_kill_and_spawn(monkeypatch):
    asteroid = Asteroid(20, 20, 50)
    asteroid.dying = True

    killed = {}
    spawned = {}

    def fake_kill(self):
        killed["called"] = True

    def fake_spawn_children(self):
        spawned["called"] = True

    monkeypatch.setattr(Asteroid, "kill", fake_kill, raising=False)
    monkeypatch.setattr(Asteroid, "spawn_children", fake_spawn_children, raising=False)

    asteroid.update(ASTEROID_DEATH_DURATION + 0.01, real_dt=ASTEROID_DEATH_DURATION + 0.01)
    assert killed.get("called") is True
    assert spawned.get("called") is True


def test_update_moves_and_kills_when_offscreen(monkeypatch):
    asteroid = Asteroid(SCREEN_WIDTH + 100, 0, 40)
    asteroid.velocity = pygame.Vector2(100, 0)

    killed = {}

    def fake_kill(self):
        killed["called"] = True

    monkeypatch.setattr(Asteroid, "kill", fake_kill, raising=False)

    asteroid.update(0.016)
    assert killed.get("called") is True


def test_spawn_children_creates_smaller_asteroids(monkeypatch):
    parent = Asteroid(100, 100, ASTEROID_MIN_RADIUS * 3)
    parent.velocity = pygame.Vector2(100, 0)

    created_children = []

    class ChildStub:
        def __init__(self, x, y, radius):
            self.position = pygame.Vector2(x, y)
            self.radius = radius
            self.velocity = pygame.Vector2()
            created_children.append(self)

    # Use deterministic rotation to make test reproducible
    monkeypatch.setattr(asteroid_module.random, "uniform", lambda a, b: (a + b) / 2)
    monkeypatch.setattr(asteroid_module, "Asteroid", ChildStub)

    parent.spawn_children()
    assert len(created_children) == 2
    assert all(child.radius == parent.radius - ASTEROID_MIN_RADIUS for child in created_children)
    assert all(child.velocity.length() > 0 for child in created_children)
