import pygame
import pytest

import taunt as taunt_module
from taunt import TauntAnimation
from constants import TAUNT_DURATION, SCREEN_WIDTH, SCREEN_HEIGHT


def deterministic_randint(a, b):
    if (a, b) == (100, 140):
        return 110
    if (a, b) == (0, 4):
        return TauntAnimation.ANIM_BOUNCE
    raise AssertionError(f"Unexpected randint range {(a, b)}")


def setup_deterministic_taunt(monkeypatch):
    monkeypatch.setattr(taunt_module.random, "choice", lambda seq: seq[0])
    monkeypatch.setattr(taunt_module.random, "randint", deterministic_randint)
    monkeypatch.setattr(taunt_module.random, "random", lambda: 0.1)
    monkeypatch.setattr(taunt_module.random, "uniform", lambda a, b: a)
    monkeypatch.setattr(TauntAnimation, "_font_cache", {})


def test_taunt_animation_update_counts_down(monkeypatch):
    setup_deterministic_taunt(monkeypatch)
    anim = TauntAnimation()

    assert anim.timer == pytest.approx(TAUNT_DURATION)
    assert anim.update(0.75) is True
    assert anim.timer == pytest.approx(TAUNT_DURATION - 0.75)
    assert anim.update(TAUNT_DURATION) is False


def test_taunt_animation_draw_renders_message(monkeypatch):
    setup_deterministic_taunt(monkeypatch)

    render_calls = []

    def fake_font(_, size):
        class _Font:
            def __init__(self):
                self.size = max(1, size)

            def render(self, text, antialias, color):
                render_calls.append((text, self.size, tuple(color)))
                surf = pygame.Surface((self.size, max(1, self.size // 2)), pygame.SRCALPHA)
                return surf

        return _Font()

    monkeypatch.setattr("taunt.pygame.font.Font", fake_font)

    anim = TauntAnimation()
    surface = pygame.Surface((SCREEN_WIDTH, SCREEN_HEIGHT), pygame.SRCALPHA)

    anim.draw(surface)

    texts = [text for text, *_ in render_calls]
    assert anim.message in texts
    # Outline/glow draws multiple times, ensure we got both main/glow renders
    assert len(texts) > 1
