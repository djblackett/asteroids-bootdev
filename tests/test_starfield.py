import pygame
import pytest

from starfield import Starfield
from constants import STARFIELD_PARALLAX_STRENGTH


class DummyPlayer:
    def __init__(self, velocity, lives=3, bounce_info=None):
        self.velocity = pygame.Vector2(velocity)
        self.lives = lives
        self.bounce_info = bounce_info


def test_starfield_generates_expected_star_count():
    field = Starfield(star_count=60)
    assert len(field.stars) == 60
    assert field.stars[0].layer <= field.stars[-1].layer  # sorted by layer


def test_starfield_update_uses_average_velocity():
    field = Starfield(star_count=10)
    p1 = DummyPlayer((100, 0))
    p2 = DummyPlayer((60, 0))

    field.update(p1, p2)
    expected = ((100 + 60) / 2) * STARFIELD_PARALLAX_STRENGTH
    assert field.camera_offset[0] == pytest.approx(expected)


def test_starfield_ignores_bounce_velocity():
    field = Starfield(star_count=10)
    player = DummyPlayer((200, 0), bounce_info={"bounced": True})
    field.update(player)
    assert field.camera_offset == [0.0, 0.0]


def test_starfield_uses_other_player_when_one_dead():
    field = Starfield(star_count=10)
    p1 = DummyPlayer((100, 0), lives=0)
    p2 = DummyPlayer((0, 50))
    field.update(p1, p2)
    assert field.camera_offset[1] == pytest.approx(50 * STARFIELD_PARALLAX_STRENGTH)
