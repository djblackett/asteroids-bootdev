import pygame
import pytest

import player as player_module
from player import Player
from constants import (
    PLAYER_SHOOT_COOLDOWN,
    RAPID_FIRE_COOLDOWN,
    PLAYER_SPEED,
    BOUNDARY_BOUNCE_FORCE,
    SCREEN_WIDTH,
    SCREEN_HEIGHT,
    LASER_BEAM_COOLDOWN,
    LASER_BEAM_MAX_SHOTS,
    EXHAUST_PARTICLE_SPAWN_RATE,
)


@pytest.fixture(autouse=True)
def mute_player_sounds(monkeypatch):
    """Prevent pygame from trying to load audio assets during tests."""
    monkeypatch.setattr(player_module, "play_shoot_sound", lambda *args, **kwargs: None)
    monkeypatch.setattr(player_module, "play_laser_sound", lambda *args, **kwargs: None)
    monkeypatch.setattr(player_module, "play_boost_sound", lambda *args, **kwargs: None)


@pytest.fixture
def shot_spy(monkeypatch):
    """Capture shots that Player creates."""
    created = []

    class DummyShot:
        def __init__(self, x, y, radius, rotation, owner):
            self.position = pygame.Vector2(x, y)
            self.radius = radius
            self.rotation = rotation
            self.owner = owner
            self.velocity = pygame.Vector2()
            created.append(self)

    monkeypatch.setattr(player_module, "Shot", DummyShot)
    return created


def test_player_shoot_single_shot_respects_cooldown(shot_spy):
    player = Player(100, 100)
    player.rotation = 45

    player.shoot()
    assert len(shot_spy) == 1
    assert pytest.approx(shot_spy[0].velocity.length()) == player_module.PLAYER_SHOOT_SPEED
    assert player.timer == PLAYER_SHOOT_COOLDOWN

    # Trying to shoot before cooldown expires should not create another shot
    player.timer = 0.1
    player.shoot()
    assert len(shot_spy) == 1


def test_player_multi_shot_and_rapid_fire_timers(shot_spy):
    player = Player(200, 150)
    player.rotation = 10
    player.multi_shot_active = True
    player.rapid_fire_active = True
    player.timer = 0

    player.shoot()
    assert len(shot_spy) == 3  # spread shots
    angles = {shot.rotation for shot in shot_spy}
    assert angles == {player.rotation - player_module.MULTI_SHOT_ANGLE_SPREAD,
                      player.rotation,
                      player.rotation + player_module.MULTI_SHOT_ANGLE_SPREAD}
    assert player.timer == RAPID_FIRE_COOLDOWN


def test_player_shoot_blocked_when_boosting_or_disabled(shot_spy):
    player = Player(300, 250)

    player.can_shoot = False
    player.shoot()
    assert len(shot_spy) == 0

    player.can_shoot = True
    player.boost_active = True
    player.shoot()
    assert len(shot_spy) == 0


def test_player_move_and_boundary_bounce():
    player = Player(400, 350)
    player.rotation = 0
    initial_y = player.position.y

    player.move(1.0)
    assert player.position.y == pytest.approx(initial_y + PLAYER_SPEED)

    # Force player out of bounds and ensure bounce info is populated
    player.position.x = SCREEN_WIDTH + 10
    bounce_result = player.check_boundary_collision()
    assert bounce_result and bounce_result["bounced"]
    assert player.position.x == SCREEN_WIDTH - player.radius
    assert player.velocity.x == -BOUNDARY_BOUNCE_FORCE


def test_player_take_damage_and_respawn_resets_powerups():
    player = Player(500, 500)
    player.shield_active = True
    assert player.take_damage() is False
    assert player.shield_active is False

    player.take_damage()
    assert player.lives == 2

    player.rapid_fire_active = True
    player.multi_shot_active = True
    player.mega_power_active = True
    player.boost_active = True
    player.respawn(250, 250)

    assert player.is_respawning
    assert not player.rapid_fire_active
    assert not player.multi_shot_active
    assert not player.mega_power_active
    assert not player.boost_active
    assert player.position == pygame.Vector2(250, 250)


def test_player_boost_activation_and_cooldown():
    player = Player(200, 200)
    player.boost_cooldown = 0
    player.activate_boost()

    assert player.boost_active
    assert player.boost_timer == player_module.BOOST_DURATION
    assert player.boost_cooldown == player_module.BOOST_COOLDOWN

    # Cooldown prevents immediate reactivation
    player.boost_active = False
    player.activate_boost()
    assert player.boost_active is False


def test_player_shoot_laser_consumes_charge(monkeypatch):
    player = Player(100, 100)
    player.laser_shots_remaining = LASER_BEAM_MAX_SHOTS

    recorded = {}

    class DummyLaser:
        def __init__(self, x, y, direction, owner):
            recorded.update({"x": x, "y": y, "direction": direction, "owner": owner})

    monkeypatch.setattr("laserbeam.LaserBeam", DummyLaser)

    player.shoot_laser()
    assert recorded["owner"] is player
    assert player.pending_laser is not None
    assert player.laser_shots_remaining == LASER_BEAM_MAX_SHOTS - 1
    assert player.laser_cooldown == LASER_BEAM_COOLDOWN


def test_player_get_exhaust_info_sets_timer():
    player = Player(150, 150)
    player.is_moving = True
    player.exhaust_timer = 0
    player.rotation = 0

    exhaust = player.get_exhaust_info()
    assert exhaust is not None
    assert exhaust["position"].y < player.position.y  # behind the ship
    assert player.exhaust_timer == EXHAUST_PARTICLE_SPAWN_RATE


def test_player_take_damage_respects_respawn_invulnerability():
    player = Player(100, 100)
    player.is_respawning = True
    lives_before = player.lives
    assert player.take_damage() is False
    assert player.lives == lives_before


def test_player_activate_mega_power_sets_all_flags():
    player = Player(0, 0)
    player.activate_mega_power()
    assert player.mega_power_active
    assert player.rapid_fire_active
    assert player.multi_shot_active
    assert player.shield_active
