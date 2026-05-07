# Asteroids

A Python/pygame Asteroids clone built on top of the [Boot.dev](https://boot.dev) guided project, extended with a large set of extra features.

## Boot.dev baseline

The original assignment covered:

- Player ship that rotates and thrusts
- Asteroids that spawn, move, and split into smaller pieces when shot
- Bullets that destroy asteroids
- Game over when the player is hit

Everything else listed below was added beyond those requirements.

## Extra features

### Gameplay

- **2-player local co-op** — two ships on screen simultaneously
- **UFO enemies** — large UFO fires randomly; small UFO aims at players with 70% accuracy
- **Power-ups** — Rapid Fire, Multi-Shot, Slow Motion, Shield (one-hit absorb), Mega Power (all at once), Revive
- **Laser beam** — limited-use directed beam weapon
- **Boost** — temporary speed burst with cooldown
- **Progressive difficulty** — asteroids speed up and spawn faster every 30 seconds
- **Wave mode** — optional wave-based spawning instead of continuous (toggle in `constants.py`)
- **Combo system** — chain kills within 3 seconds for up to 3× score multiplier
- **Kill streak notifications** — milestones from "Killing Spree!" to "Beyond Legendary!"
- **Co-op options**: shared life pool, friendly fire toggle, per-player speed multiplier

### Polish

- **Particle effects** on asteroid destruction and wall bounce
- **Screen shake** scaled to asteroid size
- **Parallax starfield** background
- **Death taunts** displayed on player death
- **Exhaust trail** behind thrusting ships
- **HUD** with scores, lives, active power-ups, wave number, timer
- **Start screen** and pre-game **control configuration UI**
- **Pause** support

### Technical

- **Gamepad support** — auto-detects up to 2 controllers
- **Spatial grid** for O(1) average collision detection
- **Web build** via pygbag (deployed to GitHub Pages)
- **Background music** with dynamic speed-up during Mega Power
- **Sound effects** with pre-processed audio for web compatibility
- **Async game loop** (`asyncio`) for pygbag compatibility

## Requirements

- Python 3.10+
- pygame 2.6.1
- pygbag (for web builds)
- pytest (for tests)

## Installation

```bash
git clone <repo-url>
cd asteroids-bootdev
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
```

## Running

```bash
python main.py
```

## Controls

### Keyboard (Player 1)

| Action | Key |
| ------ | --- |
| Rotate | A / D |
| Thrust | W |
| Shoot | Space |
| Laser | Left Shift |
| Boost | Left Ctrl |

### Keyboard (Player 2)

| Action | Key |
| ------ | --- |
| Rotate | ← / → |
| Thrust | ↑ |
| Shoot | Enter |
| Laser | Right Shift |
| Boost | Right Ctrl |

### Gamepad

| Action | Button |
| ------ | ------ |
| Rotate | Left stick / D-pad |
| Thrust | Left stick up / D-pad up |
| Shoot | A / Cross |
| Laser | RB / R1 |
| Boost | LB / L1 |

## Testing

```bash
# Run all tests
pytest

# Run a specific test file
pytest tests/test_player.py

# Run a specific test
pytest tests/test_player.py::test_player_movement -v
```

## Web Build

```bash
# Development build (with debug console)
pygbag --no_opt main.py
python scripts/force_debug_console.py build/web/index.html

# Production build for itch.io
pygbag --no_opt --build main.py
python scripts/force_debug_console.py build/web/index.html
```

The `--no_opt` flag is required because pygbag's optimizer rewrites `.wav` paths to `.ogg` on Linux, but this repo ships only `.wav` files.

## Project Structure

```text
main.py             # Entry point, game loop initialization
gameloop.py         # Core update/render functions
gamestate.py        # Mutable game state dataclass
events.py           # Input/event processing
constants.py        # All tunable game constants
player.py           # Player entity
asteroid.py         # Asteroid entity and splitting logic
asteroidfield.py    # Asteroid spawner (continuous + wave modes)
ufo.py              # UFO enemy entity
shot.py             # Projectile entity
powerup.py          # Power-up entity and types
collisions.py       # All collision handlers
spatialgrid.py      # Spatial partitioning for collision perf
circleshape.py      # Base sprite class for all entities
soundeffects.py     # Sound loading and playback
controlconfig.py    # Pre-game input configuration UI
starfield.py        # Parallax starfield background
particlesystem.py   # Particle effect system
hud.py              # Heads-up display rendering
```

## Configuration

All game constants are in [constants.py](constants.py). Notable toggles:

| Constant | Default | Description |
| -------- | ------- | ----------- |
| `GAMEPLAY_DEBUG` | `False` | Skip intro/config screens for instant testing |
| `WAVE_SYSTEM_ENABLED` | `False` | Wave-based vs. continuous asteroid spawning |
| `UFO_ENABLED` | `True` | Toggle UFO enemies |
| `POWERUP_SPAWN_ENABLED` | `True` | Toggle power-up drops |
| `SHARED_LIVES_ENABLED` | `False` | Shared life pool for co-op |
| `FRIENDLY_FIRE_ENABLED` | `True` | Players can shoot each other |
| `STARFIELD_ENABLED` | `True` | Parallax starfield background |

## License

MIT
