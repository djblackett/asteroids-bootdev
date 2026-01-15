import pygame
import pytest

import ufo as ufo_module
from ufo import UFO
from constants import SCREEN_WIDTH, SCREEN_HEIGHT, UFO_SHOT_SPEED


@pytest.fixture(autouse=True)
def deterministic_random(monkeypatch):
    monkeypatch.setattr(ufo_module.random, "uniform", lambda a, b: (a + b) / 2)


def test_ufo_get_nearest_player_skips_dead_and_respawning():
    alive = type("Player", (), {})()
    alive.position = pygame.Vector2(10, 0)
    alive.lives = 3
    alive.is_respawning = False

    dead = type("Player", (), {})()
    dead.position = pygame.Vector2(0, 0)
    dead.lives = 0
    dead.is_respawning = False

    respawning = type("Player", (), {})()
    respawning.position = pygame.Vector2(5, 0)
    respawning.lives = 3
    respawning.is_respawning = True

    ufo = UFO(0, 0, players=[dead, respawning, alive])
    assert ufo._get_nearest_player() is alive


def test_ufo_shoot_at_target_creates_shot(monkeypatch):
    ufo = UFO(0, 0, ufo_type="small", players=[])
    created = []

    class DummyShot:
        def __init__(self, x, y, radius, direction, owner):
            self.position = pygame.Vector2(x, y)
            self.velocity = pygame.Vector2()
            self.owner = owner
            created.append(self)

    monkeypatch.setattr(ufo_module, "Shot", DummyShot)
    monkeypatch.setattr(ufo_module.random, "uniform", lambda a, b: 0)  # no deviation

    ufo._shoot_at_target(pygame.Vector2(0, 10))
    assert len(created) == 1
    assert created[0].velocity.length() == pytest.approx(UFO_SHOT_SPEED)
    assert created[0].owner is ufo


def test_ufo_update_wraps_screen_and_fires_at_target(monkeypatch):
    target = type("Player", (), {})()
    target.position = pygame.Vector2(0, 0)
    target.lives = 3
    target.is_respawning = False

    ufo = UFO(0, 0, players=[target])
    ufo.position.x = -ufo.radius - 1
    ufo.position.y = -ufo.radius - 1
    ufo.velocity = pygame.Vector2(-50, -50)
    ufo.target_velocity = pygame.Vector2(0, 0)
    ufo.shoot_timer = 0

    shot_calls = []
    monkeypatch.setattr(UFO, "_shoot_at_target", lambda self, pos: shot_calls.append(pos), raising=False)

    ufo.update(0.1)
    assert ufo.position.x == SCREEN_WIDTH + ufo.radius
    assert ufo.position.y == SCREEN_HEIGHT + ufo.radius
    assert shot_calls  # fired at least once
