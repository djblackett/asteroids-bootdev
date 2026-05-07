import json

import pytest

import highscores
from highscores import (
    add_score,
    get_top_scores,
    is_high_score,
    load_highscores,
    MAX_HIGHSCORES,
)


@pytest.fixture
def highscores_file(tmp_path, monkeypatch):
    target = tmp_path / "scores.json"
    monkeypatch.setattr(highscores, "HIGHSCORE_FILE", str(target))
    return target


def test_add_score_sorts_and_limits_entries(highscores_file):
    for i in range(MAX_HIGHSCORES + 2):
        rank = add_score(f"Player{i}", i * 100)
    scores = load_highscores()
    assert len(scores) == MAX_HIGHSCORES
    assert scores[0]["score"] == (MAX_HIGHSCORES + 1) * 100
    assert rank == 1  # Last insert was highest score


def test_is_high_score_checks_threshold(highscores_file):
    # Less than max entries => always qualifies
    assert is_high_score(10)

    # Fill scores with known values
    for value in range(MAX_HIGHSCORES):
        add_score(f"Player{value}", value)

    assert is_high_score(MAX_HIGHSCORES + 10)
    assert not is_high_score(-1)


def test_get_top_scores_returns_requested_count(highscores_file):
    for i in range(5):
        add_score(f"Player{i}", i * 50)

    top = get_top_scores(3)
    assert len(top) == 3
    assert top[0]["score"] >= top[1]["score"] >= top[2]["score"]


def test_load_highscores_returns_empty_for_missing_file(highscores_file):
    assert load_highscores() == []


def test_load_highscores_returns_empty_for_corrupt_file(highscores_file):
    highscores_file.write_text("{ this is : bad }")
    assert load_highscores() == []


def test_save_highscores_handles_io_error(highscores_file, monkeypatch):
    captured = {}

    def fake_open(*args, **kwargs):
        raise IOError("boom")

    def fake_debug_print(*args, **kwargs):
        captured["called"] = True

    monkeypatch.setattr("builtins.open", fake_open)
    monkeypatch.setattr(highscores, "debug_print", fake_debug_print)

    highscores.save_highscores([{"player": "P1", "score": 10}])
    assert captured.get("called") is True
