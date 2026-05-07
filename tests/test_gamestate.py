import pytest

from constants import ASTEROID_SPAWN_RATE
from gamestate import GameState


def test_reset_for_new_game_restores_defaults():
    state = GameState()
    state.game_over = True
    state.player1_dead = True
    state.player2_dead = True
    state.game_over_retry_delay = 3.0
    state.show_high_scores = True
    state.p1_highscore_rank = 2
    state.p2_highscore_rank = 1
    state.combo_count = 9
    state.combo_timer = 2.2
    state.last_streak_milestone = 30
    state.active_streak_notification = object()
    state.slow_motion_active = True
    state.slow_motion_timer = 4.0
    state.screen_shake = 7.0
    state.screen_shake_cooldown = 5.0
    state.taunt_animation = object()
    state.game_time = 123.4
    state.difficulty_timer = 50.0
    state.asteroid_speed_multiplier = 2.5
    state.asteroid_spawn_rate = 0.2
    state.current_wave = 5
    state.wave_break_active = True
    state.wave_break_timer = 3.0
    state.wave_duration_timer = 9.0
    state.music_sped_up = True

    state.reset_for_new_game()

    assert not state.game_over
    assert not state.player1_dead
    assert not state.player2_dead
    assert state.combo_count == 0
    assert state.combo_timer == 0.0
    assert state.last_streak_milestone == 0
    assert state.active_streak_notification is None
    assert not state.slow_motion_active
    assert state.slow_motion_timer == 0.0
    assert state.screen_shake == 0.0
    assert state.screen_shake_cooldown == 0.0
    assert state.taunt_animation is None
    assert state.game_time == 0.0
    assert state.difficulty_timer == 0.0
    assert state.asteroid_speed_multiplier == 1.0
    assert state.asteroid_spawn_rate == ASTEROID_SPAWN_RATE
    assert state.current_wave == 1
    assert not state.wave_break_active
    assert state.wave_break_timer == 0.0
    assert state.wave_duration_timer == 0.0
    assert not state.music_sped_up
    assert not state.show_high_scores
    assert state.p1_highscore_rank is None
    assert state.p2_highscore_rank is None


def test_trigger_game_over_sets_delay():
    state = GameState()
    state.trigger_game_over()
    assert state.game_over is True
    assert state.game_over_retry_delay == pytest.approx(1.5)


def test_return_to_menu_resets_menu_flags():
    state = GameState()
    state.game_over = True
    state.game_started = True
    state.config_phase = False
    state.paused = True

    state.return_to_menu()

    assert state.game_over is False
    assert state.game_started is False
    assert state.config_phase is True
    assert state.paused is False
