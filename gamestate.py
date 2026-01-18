"""Game state management for Asteroids game."""

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from constants import ASTEROID_SPAWN_RATE

if TYPE_CHECKING:
    from killstreak import KillStreakNotification
    from taunt import TauntAnimation
    from particlesystem import ParticleSystem


@dataclass
class GameState:
    """Encapsulates all mutable game state variables."""

    # Core game state
    game_over: bool = False
    paused: bool = False
    game_started: bool = False
    config_phase: bool = True
    running: bool = True

    # Timers
    game_start_cooldown: float = 0.0
    game_over_retry_delay: float = 0.0
    combo_timer: float = 0.0
    slow_motion_timer: float = 0.0
    wave_break_timer: float = 0.0
    wave_duration_timer: float = 0.0
    difficulty_timer: float = 0.0
    game_time: float = 0.0
    screen_shake_cooldown: float = 0.0

    # Combo/streak system
    combo_count: int = 0
    last_streak_milestone: int = 0
    active_streak_notification: "KillStreakNotification | None" = None

    # Visual effects
    screen_shake: float = 0.0
    slow_motion_active: bool = False
    music_sped_up: bool = False
    music_muted: bool = False

    # Player death state
    player1_dead: bool = False
    player2_dead: bool = False

    # Wave system
    current_wave: int = 1
    wave_break_active: bool = False

    # High scores display
    show_high_scores: bool = False
    p1_highscore_rank: int | None = None
    p2_highscore_rank: int | None = None

    # Difficulty progression
    asteroid_speed_multiplier: float = 1.0
    asteroid_spawn_rate: float = ASTEROID_SPAWN_RATE

    # Game mode settings (set from control config)
    friendly_fire_enabled: bool = False
    shared_lives_enabled: bool = False
    current_player_count: int = 2

    # Taunt animation
    taunt_animation: "TauntAnimation | None" = None

    # Retry button rect for game over screen
    button_rect: object = None  # pygame.Rect

    def reset_for_new_game(self) -> None:
        """Reset state for starting a new game."""
        self.game_over = False
        self.player1_dead = False
        self.player2_dead = False
        self.game_over_retry_delay = 0.0
        self.show_high_scores = False
        self.p1_highscore_rank = None
        self.p2_highscore_rank = None
        self.combo_count = 0
        self.combo_timer = 0.0
        self.last_streak_milestone = 0
        self.active_streak_notification = None
        self.slow_motion_active = False
        self.slow_motion_timer = 0.0
        self.screen_shake = 0.0
        self.screen_shake_cooldown = 0.0
        self.taunt_animation = None
        self.game_time = 0.0
        self.difficulty_timer = 0.0
        self.asteroid_speed_multiplier = 1.0
        self.asteroid_spawn_rate = ASTEROID_SPAWN_RATE
        self.current_wave = 1
        self.wave_break_active = False
        self.wave_break_timer = 0.0
        self.wave_duration_timer = 0.0
        self.music_sped_up = False

    def trigger_game_over(self) -> None:
        """Set state for game over."""
        self.game_over = True
        self.game_over_retry_delay = 1.5

    def return_to_menu(self) -> None:
        """Reset state for returning to main menu."""
        self.game_over = False
        self.game_started = False
        self.config_phase = True
        self.paused = False
