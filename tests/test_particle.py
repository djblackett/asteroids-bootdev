import pygame

from particle import Particle


def test_particle_update_advances_position_and_lifetime():
    particle = Particle(0, 0, pygame.Vector2(10, 0))
    initial_velocity = particle.velocity.length()
    assert particle.update(0.1)
    assert particle.position.x != 0
    assert particle.velocity.length() < initial_velocity

    # Force expiration
    particle.lifetime = particle.max_lifetime
    assert particle.update(0.1) is False
