"""
Frame time caching module for performance optimization.

OPTIMIZATION: Caches pygame.time.get_ticks() once per frame instead of calling
it multiple times across different game objects.

pygame.time.get_ticks() is a relatively cheap call (~0.01ms), but when called
12+ times per frame across Player, PowerUp, Starfield, etc., the overhead adds up.
By caching the value at the start of each frame, we eliminate redundant syscalls.

Usage:
    At the start of each frame in the main loop:
        frametime.update()

    In any drawing code that needs the current time:
        ticks = frametime.get_ticks()
"""

import pygame

# Cached ticks value for the current frame
_frame_ticks = 0


def update():
    """
    Update the cached ticks value. Call this once at the start of each frame
    in the main game loop, before any drawing or animation updates.
    """
    global _frame_ticks
    _frame_ticks = pygame.time.get_ticks()


def get_ticks():
    """
    Get the cached ticks value for the current frame.
    This returns the same value throughout the entire frame, which is
    actually desirable for consistent animations.
    """
    return _frame_ticks
