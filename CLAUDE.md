# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
# Run the game (requires pygame)
python main.py

# Run tests
pytest

# Run a single test file
pytest tests/test_player.py

# Run a specific test
pytest tests/test_player.py::test_player_movement -v

# Build for web browser (pygbag)
pygbag --no_opt main.py
python scripts/force_debug_console.py build/web/index.html

# Build for itch.io deployment
pygbag --no_opt --build main.py
python scripts/force_debug_console.py build/web/index.html

# Regenerate processed audio files
python preprocess_audio.py
```

Note: The `--no_opt` flag is required because pygbag's optimizer rewrites `.wav` to `.ogg` paths on Linux, but the repo only ships `.wav` files.

## Architecture Overview

### Game Loop Structure
- `main.py` - Entry point, initializes pygame, sprite groups, and runs the async game loop
- `gameloop.py` - Core update/render logic extracted into functions: `update_timers()`, `update_players()`, `update_entities()`, `process_collisions()`, `render_gameplay()`
- `gamestate.py` - Dataclass holding all mutable game state (timers, scores, flags, difficulty)
- `events.py` - Event processing (keyboard, gamepad, window events)

### Entity System
All game entities inherit from `CircleShape` (in `circleshape.py`), which extends `pygame.sprite.Sprite`:
- Uses class-level `containers` tuple for auto-registration with sprite groups
- Provides `position`, `velocity`, `radius` and `check_collision()` method

Entities: `Player`, `Asteroid`, `Shot`, `PowerUp`, `UFO`

Sprite groups are set up in `main.py`:
```python
Player.containers = (updatable, drawable)
Asteroid.containers = (asteroids, updatable, drawable)
Shot.containers = (shots, updatable, drawable)
```

### Collision System
- `collisions.py` - All collision handlers (player-asteroid, shot-asteroid, UFO interactions, friendly fire)
- `spatialgrid.py` - Spatial partitioning for efficient collision detection
- The `take_damage()` method on Player handles shield logic and decrements lives internally

### Configuration
- `constants.py` - All game constants (speeds, timers, spawn rates, power-up durations)
- `controlconfig.py` - Input configuration UI for player controls
- `GAMEPLAY_DEBUG = True` skips intro screens for faster testing

### Sound System
- `soundeffects.py` - Sound loading and playback functions
- Pre-processed audio in `sound-effects/processed/` for web compatibility
- `boost_audio_volume.py` - Utility to normalize quiet sound files

### Key Game Modes
- Wave system (toggle: `WAVE_SYSTEM_ENABLED`) vs continuous asteroid spawning
- UFO spawning works differently in each mode - see `UFO_CONTINUOUS_SPAWN_TIME` constants
- Shared lives mode for co-op (`SHARED_LIVES_ENABLED`)

## Testing Notes
- Tests use headless pygame via `SDL_AUDIODRIVER=dummy` and `SDL_VIDEODRIVER=dummy` in `tests/conftest.py`
- Fixtures reset sprite containers between tests to avoid cross-test pollution
- The `pygame_setup` fixture initializes pygame once per session
