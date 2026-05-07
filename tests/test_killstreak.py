import pygame

from killstreak import KillStreakNotification
from constants import KILL_STREAK_NOTIFICATION_DURATION


def test_killstreak_notification_update_and_timer():
    notification = KillStreakNotification(10, "DOMINATING!", (255, 0, 0))
    assert notification.timer == KILL_STREAK_NOTIFICATION_DURATION

    assert notification.update(0.5) is True
    assert notification.timer == KILL_STREAK_NOTIFICATION_DURATION - 0.5

    assert notification.update(KILL_STREAK_NOTIFICATION_DURATION) is False


def test_killstreak_notification_draw_skips_when_expired(monkeypatch):
    notification = KillStreakNotification(5, "SPREE", (255, 255, 0))
    notification.timer = 0.0

    render_calls = []

    def fake_font(_, size):
        class _Font:
            def render(self, text, antialias, color):
                render_calls.append((text, size))
                surface = pygame.Surface((10, 10), pygame.SRCALPHA)
                return surface

        return _Font()

    monkeypatch.setattr("killstreak.pygame.font.Font", fake_font)

    surface = pygame.Surface((200, 200), pygame.SRCALPHA)
    notification.draw(surface)

    assert render_calls == []


def test_killstreak_notification_draw_renders_text(monkeypatch):
    notification = KillStreakNotification(15, "SPREE", (120, 200, 80))
    notification.timer = notification.initial_duration / 2

    render_calls = []

    def fake_font(_, size):
        class _Font:
            def render(self, text, antialias, color):
                render_calls.append((text, size, tuple(color)))
                surface = pygame.Surface((20, 10), pygame.SRCALPHA)
                return surface

        return _Font()

    monkeypatch.setattr("killstreak.pygame.font.Font", fake_font)

    surface = pygame.Surface((400, 200), pygame.SRCALPHA)
    notification.draw(surface)

    texts = [text for text, *_ in render_calls]
    assert any("KILLS" in text for text in texts)
    assert any(text == notification.streak_name for text in texts)
