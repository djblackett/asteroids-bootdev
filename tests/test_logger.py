import builtins
import json

import pygame

import logger


def test_log_event_writes_json_line(tmp_path, monkeypatch):
    original_open = builtins.open

    def fake_open(path, mode):
        return original_open(tmp_path / str(path), mode)

    monkeypatch.setattr("builtins.open", fake_open)
    logger.log_event("test-event", value=42)

    data = json.loads((tmp_path / "game_events.jsonl").read_text().strip())
    assert data["type"] == "test-event"
    assert data["value"] == 42


def test_log_state_records_sprite_snapshot(tmp_path, monkeypatch):
    original_open = builtins.open

    def fake_open(path, mode):
        return original_open(tmp_path / str(path), mode)

    monkeypatch.setattr("builtins.open", fake_open)
    logger._frame_count = logger._FPS - 1
    logger._state_log_initialized = False

    def capture_state():
        screen = pygame.Surface((30, 20))
        asteroids = pygame.sprite.Group()

        class Dummy(pygame.sprite.Sprite):
            def __init__(self):
                super().__init__(asteroids)
                self.position = pygame.Vector2(5, 5)
                self.velocity = pygame.Vector2(1, 0)
                self.radius = 10
                self.rotation = 0

        Dummy()
        logger.log_state()

    capture_state()
    entry = json.loads((tmp_path / "game_state.jsonl").read_text().strip())
    assert entry["screen_size"] == [30, 20]
    assert entry["asteroids"]["count"] == 1


def test_log_event_swallows_io_errors(monkeypatch):
    def fake_open(*args, **kwargs):
        raise OSError("boom")

    monkeypatch.setattr("builtins.open", fake_open)
    logger.log_event("test-error")


def test_log_state_swallows_io_errors(monkeypatch):
    def fake_open(*args, **kwargs):
        raise OSError("boom")

    monkeypatch.setattr("builtins.open", fake_open)
    logger._frame_count = logger._FPS - 1

    def call_log_state():
        screen = pygame.Surface((10, 10))
        sprites = pygame.sprite.Group()

        class Dummy(pygame.sprite.Sprite):
            def __init__(self):
                super().__init__(sprites)
                self.position = pygame.Vector2()

        Dummy()
        logger.log_state()

    call_log_state()
