import json
import os
from datetime import datetime
import sys

IS_WEB = sys.platform == "emscripten"


def debug_print(*args, **kwargs):
    """Print only on desktop, not on web."""
    if not IS_WEB:
        print(*args, **kwargs)


HIGHSCORE_FILE = "highscores.json"
MAX_HIGHSCORES = 10


def load_highscores():
    """Load high scores from file"""
    if not os.path.exists(HIGHSCORE_FILE):
        return []

    try:
        with open(HIGHSCORE_FILE, 'r') as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return []


def save_highscores(scores):
    """Save high scores to file"""
    try:
        with open(HIGHSCORE_FILE, 'w') as f:
            json.dump(scores, f, indent=2)
    except IOError as e:
        debug_print(f"Error saving high scores: {e}")


def add_score(player_name, score):
    """Add a new score to the high scores list"""
    scores = load_highscores()

    # Add new score with timestamp
    new_entry = {
        "player": player_name,
        "score": score,
        "date": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }

    scores.append(new_entry)

    # Sort by score (descending) and keep only top MAX_HIGHSCORES
    scores.sort(key=lambda x: x["score"], reverse=True)
    scores = scores[:MAX_HIGHSCORES]

    save_highscores(scores)

    # Return the rank (1-based index) if the score made it into top scores
    for i, entry in enumerate(scores):
        if entry == new_entry:
            return i + 1

    return None  # Score didn't make it into top scores


def is_high_score(score):
    """Check if a score qualifies as a high score"""
    scores = load_highscores()

    # If we have fewer than MAX_HIGHSCORES, any score qualifies
    if len(scores) < MAX_HIGHSCORES:
        return True

    # Check if score is higher than the lowest high score
    if scores:
        lowest_high_score = scores[-1]["score"]
        return score > lowest_high_score

    return True


def get_top_scores(count=10):
    """Get the top N scores"""
    scores = load_highscores()
    return scores[:count]
