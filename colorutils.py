"""
Pre-computed rainbow color lookup table for performance optimization.

OPTIMIZATION: colorsys.hsv_to_rgb() is called frequently for rainbow effects
(player mega power, powerup animations, taunt text). Each call has overhead
from the Python function dispatch and math operations.

By pre-computing 360 colors (one per degree of hue), we can replace the
expensive hsv_to_rgb() call with a simple array lookup, which is ~10x faster.

The lookup table is generated once at module import time.
"""

import colorsys

# Pre-compute 360 rainbow colors (one per degree of hue)
# Each entry is an (R, G, B) tuple with values 0-255
RAINBOW_COLORS = []

def _init_rainbow_table():
    """Initialize the rainbow color lookup table at module load time."""
    for i in range(360):
        hue = i / 360.0
        r, g, b = colorsys.hsv_to_rgb(hue, 1.0, 1.0)
        RAINBOW_COLORS.append((int(r * 255), int(g * 255), int(b * 255)))

# Initialize on import
_init_rainbow_table()


def get_rainbow_color(ticks, speed=100):
    """
    Get a rainbow color based on the current time.

    Args:
        ticks: Current frame ticks (from frametime.get_ticks())
        speed: How fast to cycle through colors (lower = faster)
               Default 100 means one full cycle per 36 seconds

    Returns:
        (R, G, B) tuple with values 0-255
    """
    # Calculate hue index (0-359) based on time
    hue_index = int((ticks / speed) % 360)
    return RAINBOW_COLORS[hue_index]


def get_rainbow_color_offset(ticks, offset, speed=100):
    """
    Get a rainbow color with a hue offset (for multi-color effects).

    Args:
        ticks: Current frame ticks
        offset: Hue offset in degrees (0-359)
        speed: How fast to cycle through colors

    Returns:
        (R, G, B) tuple with values 0-255
    """
    hue_index = int(((ticks / speed) + offset) % 360)
    return RAINBOW_COLORS[hue_index]


def hsv_to_rgb_fast(hue):
    """
    Fast HSV to RGB conversion using the lookup table.
    Assumes saturation=1.0 and value=1.0 (pure rainbow colors).

    Args:
        hue: Hue value from 0.0 to 1.0

    Returns:
        (R, G, B) tuple with values 0-255
    """
    hue_index = int(hue * 359) % 360
    return RAINBOW_COLORS[hue_index]
