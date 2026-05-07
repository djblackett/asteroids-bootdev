import pygame
import pytest

from controlconfig import ControlConfig


@pytest.fixture
def no_gamepads(monkeypatch):
    class DummyJoystick:
        def __init__(self, idx):
            self.idx = idx

        def get_name(self):
            return f"Dummy {self.idx}"

    monkeypatch.setattr("controlconfig.pygame.joystick.get_count", lambda: 0)
    monkeypatch.setattr("controlconfig.pygame.joystick.Joystick", lambda idx: DummyJoystick(idx))


def test_cycle_player_inputs_recovers_from_invalid_values(no_gamepads):
    config = ControlConfig()
    config.player1_input = "invalid"
    config.player2_input = "invalid"

    config.cycle_player1_input()
    config.cycle_player2_input()

    assert config.player1_input == config.KEYBOARD_1
    assert config.player2_input == config.KEYBOARD_2


def test_get_speed_label_defaults_on_unknown_value(no_gamepads):
    config = ControlConfig()
    config.speed_multiplier = 3.14
    assert config.get_speed_label() == "100%"


def test_cycle_player_count_recovers_from_invalid_state(no_gamepads):
    config = ControlConfig()
    config.player_count = 99
    config.cycle_player_count()
    assert config.player_count in config.player_count_options


def test_get_input_display_name_returns_unknown(no_gamepads):
    config = ControlConfig()
    assert config.get_input_display_name("mystery", 1) == "Unknown"
