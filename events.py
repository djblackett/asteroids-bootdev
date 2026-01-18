"""Event handling for Asteroids game."""

import sys
import pygame

from soundeffects import pause_music, unpause_music

IS_WEB = sys.platform == "emscripten"


class EventResult:
    """Result of event processing that may require action from main loop."""
    def __init__(self):
        self.should_reset_game = False
        self.should_quit = False
        self.start_game = False
        self.return_to_config = False


def handle_config_events(event, control_config, state):
    """
    Handle events during the control configuration phase.
    Returns True if config is complete and should transition to start screen.
    """
    control_config.handle_event(event)
    if control_config.is_complete():
        state.config_phase = False
        return True
    return False


def handle_start_screen_events(event, state):
    """
    Handle events on the start screen.
    Returns EventResult with action flags.
    """
    result = EventResult()

    if event.type == pygame.KEYDOWN:
        if event.key == pygame.K_SPACE:
            state.game_started = True
            state.game_start_cooldown = 0.2  # Prevent immediate shooting
            result.start_game = True
        elif event.key == pygame.K_ESCAPE:
            state.config_phase = True
            result.return_to_config = True

    elif event.type == pygame.JOYBUTTONDOWN:
        if event.button == 0:  # A button / X button
            state.game_started = True
            state.game_start_cooldown = 0.2
            result.start_game = True

    return result


def handle_gameplay_events(event, state):
    """
    Handle events during active gameplay (pause, music, etc).
    Returns EventResult with action flags.
    """
    result = EventResult()

    if event.type == pygame.KEYDOWN:
        if event.key == pygame.K_p:
            # Toggle pause
            state.paused = not state.paused
            if state.paused:
                pause_music()
            elif not state.music_muted:
                unpause_music()

        elif event.key == pygame.K_m and state.paused:
            # Toggle music mute (only when paused)
            state.music_muted = not state.music_muted
            if state.music_muted:
                pause_music()
            else:
                unpause_music()

        elif event.key == pygame.K_ESCAPE and state.paused:
            # Return to menu from pause
            state.paused = False
            state.game_started = False
            state.config_phase = True
            unpause_music()
            result.return_to_config = True

        elif event.key == pygame.K_q and state.paused and not IS_WEB:
            # Quit from pause menu (desktop only)
            result.should_quit = True

    elif event.type == pygame.JOYBUTTONDOWN:
        if event.button == 7:  # Start button
            state.paused = not state.paused
            if state.paused:
                pause_music()
            elif not state.music_muted:
                unpause_music()

    return result


def handle_game_over_events(event, state, button_rect):
    """
    Handle events on the game over screen.
    Returns EventResult with action flags.
    """
    result = EventResult()

    # Only accept input if retry delay has expired
    can_retry = state.game_over_retry_delay <= 0

    if event.type == pygame.MOUSEBUTTONDOWN and can_retry:
        if button_rect and button_rect.collidepoint(event.pos):
            result.should_reset_game = True

    elif event.type == pygame.KEYDOWN:
        if event.key == pygame.K_r and can_retry:
            result.should_reset_game = True
        elif event.key == pygame.K_ESCAPE:
            state.game_over = False
            state.game_started = False
            state.config_phase = True
            result.return_to_config = True
        elif event.key == pygame.K_q:
            result.should_quit = True

    elif event.type == pygame.JOYBUTTONDOWN and can_retry:
        if event.button == 0:  # A button / X button
            result.should_reset_game = True

    return result


def process_events(state, control_config):
    """
    Process all pygame events for the current frame.
    Returns EventResult with action flags.
    """
    result = EventResult()

    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            result.should_quit = True
            continue

        # Handle based on current game phase
        if state.config_phase:
            if handle_config_events(event, control_config, state):
                # Config complete - will need to reset game with new settings
                result.should_reset_game = True

        elif not state.game_started:
            # Start screen
            start_result = handle_start_screen_events(event, state)
            if start_result.start_game:
                result.start_game = True
            if start_result.return_to_config:
                result.return_to_config = True
                control_config.reset()

        elif state.game_over:
            # Game over screen
            go_result = handle_game_over_events(event, state, state.button_rect)
            if go_result.should_reset_game:
                result.should_reset_game = True
            if go_result.return_to_config:
                result.return_to_config = True
                control_config.reset()
            if go_result.should_quit:
                result.should_quit = True

        else:
            # Active gameplay
            gp_result = handle_gameplay_events(event, state)
            if gp_result.return_to_config:
                result.return_to_config = True
                control_config.reset()
            if gp_result.should_quit:
                result.should_quit = True

    return result
