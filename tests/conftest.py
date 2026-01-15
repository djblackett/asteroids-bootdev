import os
import sys
from pathlib import Path

# Configure pygame for headless test execution before importing it
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")
os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")

import pygame
import pytest

# Ensure project root is importable
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture(scope="session", autouse=True)
def pygame_setup():
    """Initialize pygame once for the entire test session."""
    pygame.init()
    pygame.display.set_mode((1, 1))
    pygame.font.init()
    yield
    pygame.quit()


@pytest.fixture(autouse=True)
def reset_powerup_containers():
    """
    Ensure PowerUp sprites do not try to register with real sprite groups.
    The game sets this at runtime, so tests should provide a safe default.
    """
    from powerup import PowerUp

    original_containers = PowerUp.containers
    PowerUp.containers = ()
    yield
    PowerUp.containers = original_containers


@pytest.fixture(autouse=True)
def reset_dynamic_sprite_containers():
    """Provide safe defaults for sprite groups defined at runtime in the game."""
    from asteroidfield import AsteroidField
    from ufo import UFO

    field_had_attr = hasattr(AsteroidField, "containers")
    original_field_containers = getattr(AsteroidField, "containers", ())
    AsteroidField.containers = ()

    ufo_had_attr = hasattr(UFO, "containers")
    original_ufo_containers = getattr(UFO, "containers", ())
    UFO.containers = ()

    yield

    if field_had_attr:
        AsteroidField.containers = original_field_containers
    else:
        delattr(AsteroidField, "containers")

    if ufo_had_attr:
        UFO.containers = original_ufo_containers
    else:
        delattr(UFO, "containers")
