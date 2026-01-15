import pygame

from laserbeam import LaserBeam
from constants import SCREEN_HEIGHT


def test_laserbeam_end_position_clamped_to_screen():
    beam = LaserBeam(100, 100, 0)
    assert beam.end_pos.x == 100
    assert beam.end_pos.y == SCREEN_HEIGHT


def test_laserbeam_update_expires_after_lifetime():
    beam = LaserBeam(0, 0, 45)
    assert beam.update(0.1)
    assert beam.update(0.2) is False  # lifetime is 0.3 seconds


def test_laserbeam_hits_asteroid_only_once():
    beam = LaserBeam(200, 200, 0)
    asteroid = type("AsteroidStub", (), {})()
    asteroid.position = pygame.Vector2(200, 300)
    asteroid.radius = 15

    assert beam.check_hit(asteroid)
    assert beam.check_hit(asteroid) is False  # second hit ignored
