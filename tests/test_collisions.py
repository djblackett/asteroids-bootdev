import pygame
from types import SimpleNamespace

import collisions
from constants import (
    COMBO_TIMEOUT,
    KILL_STREAK_MILESTONES,
    SCREEN_SHAKE_COOLDOWN,
    SCREEN_SHAKE_MAX,
)


def test_check_kill_streak_milestone_finds_highest_new_threshold():
    info = collisions.check_kill_streak_milestone(80, 20)
    assert info["milestone"] == 75
    assert info["name"] == KILL_STREAK_MILESTONES[75]["name"]
    assert info["color"] == KILL_STREAK_MILESTONES[75]["color"]

    assert collisions.check_kill_streak_milestone(10, 0) is None
    assert collisions.check_kill_streak_milestone(90, 75) is None


def test_increment_combo_and_check_streak_sets_notification():
    state = SimpleNamespace(
        combo_count=29,
        combo_timer=0.0,
        last_streak_milestone=0,
        active_streak_notification=None,
    )

    collisions.increment_combo_and_check_streak(state)

    assert state.combo_count == 30
    assert state.combo_timer == COMBO_TIMEOUT
    assert isinstance(state.active_streak_notification, collisions.KillStreakNotification)
    assert state.active_streak_notification.streak_count == 30
    assert state.last_streak_milestone == 30


def test_handle_asteroid_destruction_awards_points_and_triggers_effects(monkeypatch):
    state = SimpleNamespace(
        combo_count=0,
        combo_timer=0.0,
        last_streak_milestone=0,
        active_streak_notification=None,
        screen_shake=0.0,
        screen_shake_cooldown=0.0,
    )
    player = SimpleNamespace(score=0)
    particle_system = object()
    effect_info = {
        "position": pygame.Vector2(50, 60),
        "particle_count": 3,
        "shake_amount": 4,
    }

    class FakeAsteroid:
        def __init__(self):
            self.position = pygame.Vector2(10, 20)

        def get_points(self):
            return 40

        def split(self):
            return effect_info

    asteroid = FakeAsteroid()
    particle_calls = []
    maybe_calls = []

    def fake_spawn_particles(ps, x, y, count):
        particle_calls.append((ps, x, y, count))

    def fake_maybe_spawn_powerup(x, y):
        maybe_calls.append((x, y))

    monkeypatch.setattr(collisions, "spawn_particles", fake_spawn_particles)
    monkeypatch.setattr(collisions, "maybe_spawn_powerup", fake_maybe_spawn_powerup)

    points = collisions.handle_asteroid_destruction(asteroid, state, particle_system, player)

    assert points == 40
    assert player.score == 40
    assert state.combo_count == 1
    assert state.combo_timer == COMBO_TIMEOUT
    assert state.screen_shake == effect_info["shake_amount"]
    assert state.screen_shake_cooldown == SCREEN_SHAKE_COOLDOWN
    assert particle_calls == [(particle_system, 50, 60, effect_info["particle_count"])]
    assert maybe_calls == [(asteroid.position.x, asteroid.position.y)]


def test_shared_lives_collision_triggers_game_over(monkeypatch):
    class DummyPlayer:
        def __init__(self, lives, player_number):
            self.lives = lives
            self.player_number = player_number
            self.respawn_calls = []
            self.boost_active = False
            self.score = 0

        def take_damage(self):
            self.lives -= 1
            return True

        def respawn(self, x, y):
            self.respawn_calls.append((x, y))

    class DummyAsteroid:
        def __init__(self):
            self.position = pygame.Vector2(0, 0)

        def split(self):
            return None

    state = SimpleNamespace(
        shared_lives_enabled=True,
        player1_dead=False,
        player2_dead=False,
        screen_shake=0.0,
        screen_shake_cooldown=0.0,
    )
    player1 = DummyPlayer(lives=1, player_number=1)
    player2 = DummyPlayer(lives=1, player_number=2)
    asteroid = DummyAsteroid()
    particle_system = object()
    game_over_calls = []

    monkeypatch.setattr(collisions, "handle_game_over", lambda s, p1, p2: game_over_calls.append((p1, p2)))
    monkeypatch.setattr(collisions, "spawn_particles", lambda *args, **kwargs: None)

    keep_playing = collisions.handle_player_asteroid_collision(
        player2, 2, asteroid, state, particle_system, 0, 0, player1
    )

    assert keep_playing is False
    assert state.player1_dead and state.player2_dead
    assert player1.lives == 0
    assert player2.lives == 1  # Restored after syncing shared pool
    assert player1.respawn_calls == []
    assert player2.respawn_calls == []
    assert game_over_calls == [(player1, player2)]


def test_shared_lives_collision_handles_empty_pool(monkeypatch):
    class DummyPlayer:
        def __init__(self, lives, player_number):
            self.lives = lives
            self.player_number = player_number
            self.respawn_calls = []
            self.boost_active = False
            self.score = 0

        def take_damage(self):
            self.lives -= 1
            return True

        def respawn(self, x, y):
            self.respawn_calls.append((x, y))

    class DummyAsteroid:
        def __init__(self):
            self.position = pygame.Vector2(0, 0)

        def split(self):
            return None

    state = SimpleNamespace(
        shared_lives_enabled=True,
        player1_dead=False,
        player2_dead=False,
        screen_shake=0.0,
        screen_shake_cooldown=0.0,
    )
    player1 = DummyPlayer(lives=0, player_number=1)
    player2 = DummyPlayer(lives=1, player_number=2)
    asteroid = DummyAsteroid()
    particle_system = object()
    game_over_calls = []

    monkeypatch.setattr(collisions, "handle_game_over", lambda s, p1, p2: game_over_calls.append((p1, p2)))
    monkeypatch.setattr(collisions, "spawn_particles", lambda *args, **kwargs: None)

    keep_playing = collisions.handle_player_asteroid_collision(
        player2, 2, asteroid, state, particle_system, 0, 0, player1
    )

    assert keep_playing is False
    assert state.player1_dead and state.player2_dead
    assert player1.respawn_calls == []
    assert player2.respawn_calls == []
    assert game_over_calls == [(player1, player2)]


def test_add_screen_shake_clamps_and_respects_cooldown():
    state = SimpleNamespace(screen_shake=11.5, screen_shake_cooldown=0.0)

    collisions.add_screen_shake(state, amount=5)

    assert state.screen_shake == SCREEN_SHAKE_MAX
    assert state.screen_shake_cooldown == SCREEN_SHAKE_COOLDOWN

    previous_shake = state.screen_shake
    state.screen_shake_cooldown = 0.01

    collisions.add_screen_shake(state, amount=3)

    assert state.screen_shake == previous_shake
