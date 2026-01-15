import pygame
import pytest

import powerup as powerup_module
from powerup import PowerUp
from constants import REVIVE_DURATION, SCREEN_WIDTH, SCREEN_HEIGHT


@pytest.fixture(autouse=True)
def deterministic_powerup_velocity(monkeypatch):
    monkeypatch.setattr(powerup_module.random, "uniform", lambda a, b: (a + b) / 2)


def test_powerup_lifetime_configuration():
    revive = PowerUp(0, 0, PowerUp.REVIVE)
    assert revive.lifetime == REVIVE_DURATION

    custom = PowerUp(0, 0, PowerUp.RAPID_FIRE, custom_lifetime=5.0)
    assert custom.lifetime == 5.0


def test_powerup_update_kills_when_expired(monkeypatch):
    power = PowerUp(10, 10, PowerUp.SHIELD)
    power.lifetime = 0.1
    power.velocity = pygame.Vector2(0, 0)

    killed = {}

    def fake_kill(self):
        killed["called"] = True

    monkeypatch.setattr(PowerUp, "kill", fake_kill, raising=False)

    power.update(0.2)
    assert killed.get("called") is True


def test_powerup_wraps_around_screen_edges():
    power = PowerUp(SCREEN_WIDTH + 5, SCREEN_HEIGHT + 5, PowerUp.MULTI_SHOT)
    power.velocity = pygame.Vector2(0, 0)
    initial_lifetime = power.lifetime

    power.update(0.0)
    assert 0 <= power.position.x <= SCREEN_WIDTH
    assert 0 <= power.position.y <= SCREEN_HEIGHT
    assert power.lifetime == initial_lifetime
