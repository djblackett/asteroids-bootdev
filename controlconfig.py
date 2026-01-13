"""Control configuration screen for multiplayer setup"""
import pygame
from constants import SCREEN_WIDTH, SCREEN_HEIGHT, FRIENDLY_FIRE_ENABLED, SHARED_LIVES_ENABLED


class ControlConfig:
    """Handles the control configuration screen"""

    # Input options
    KEYBOARD_1 = "keyboard"
    KEYBOARD_2 = "keyboard_2"
    GAMEPAD_0 = "gamepad_0"
    GAMEPAD_1 = "gamepad_1"

    def __init__(self):
        self.player1_input = self.KEYBOARD_1
        self.player2_input = self.KEYBOARD_2
        self.selected_player = 0  # Which row is selected: 0=Players, 1=P1, 2=P2, 3=Speed, 4=FriendlyFire, 5=SharedLives
        self.config_complete = False

        # Player count toggle
        self.player_count = 1  # 1 or 2 players
        self.player_count_options = [1, 2]

        # Speed multiplier (1.0 = normal, 1.5 = 50% faster, etc.)
        self.speed_multiplier = 1.0
        self.speed_options = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]
        # Pad labels with spaces for consistent width
        self.speed_labels = [" 50%", " 75%", "100%", "125%", "150%", "200%"]

        # Friendly fire toggle
        self.friendly_fire_enabled = FRIENDLY_FIRE_ENABLED
        self.friendly_fire_options = [False, True]

        # Shared lives toggle
        self.shared_lives_enabled = SHARED_LIVES_ENABLED
        self.shared_lives_options = [False, True]

        # Detect available gamepads
        self.gamepad_count = pygame.joystick.get_count()
        self.gamepad_names = []
        for i in range(self.gamepad_count):
            joystick = pygame.joystick.Joystick(i)
            self.gamepad_names.append(joystick.get_name())

        # Set default based on available hardware
        # Note: Player 2 input only matters when player_count == 2
        if self.gamepad_count >= 2:
            self.player1_input = self.GAMEPAD_0
            self.player2_input = self.GAMEPAD_1
        elif self.gamepad_count == 1:
            # In 1P mode, assign gamepad to P1. P2 input doesn't matter until 2P mode.
            self.player1_input = self.GAMEPAD_0
            self.player2_input = self.KEYBOARD_2

        # Create fonts once during init instead of every frame
        # Use default pygame fonts for better performance
        self.font_title = pygame.font.Font(None, 64)
        self.font_large = pygame.font.Font(None, 42)
        self.font_medium = pygame.font.Font(None, 36)
        self.font_small = pygame.font.Font(None, 28)

    def get_available_options(self, player_num):
        """Get list of available input options for a player"""
        options = [
            ("Keyboard (WASD + Space)", self.KEYBOARD_1) if player_num == 1 else ("Keyboard (Arrows + Enter)", self.KEYBOARD_2)
        ]

        # Add gamepad options if available
        for i in range(self.gamepad_count):
            # Clean up gamepad name to avoid font alignment issues
            gamepad_name = self.gamepad_names[i][:25]  # Truncate long names
            # Format: "Controller X - Name" for cleaner rendering
            options.append((f"Controller {i+1} - {gamepad_name}", f"gamepad_{i}"))

        return options

    def cycle_player1_input(self, direction=1):
        """Cycle through available inputs for player 1"""
        options = self.get_available_options(1)
        input_values = [opt[1] for opt in options]

        try:
            current_index = input_values.index(self.player1_input)
            new_index = (current_index + direction) % len(input_values)
            self.player1_input = input_values[new_index]
        except ValueError:
            self.player1_input = input_values[0]

    def cycle_player2_input(self, direction=1):
        """Cycle through available inputs for player 2"""
        options = self.get_available_options(2)
        input_values = [opt[1] for opt in options]

        try:
            current_index = input_values.index(self.player2_input)
            new_index = (current_index + direction) % len(input_values)
            self.player2_input = input_values[new_index]
        except ValueError:
            self.player2_input = input_values[0]

    def cycle_player_count(self, direction=1):
        """Cycle through player count options"""
        try:
            current_index = self.player_count_options.index(self.player_count)
            new_index = (current_index + direction) % len(self.player_count_options)
            self.player_count = self.player_count_options[new_index]
        except ValueError:
            self.player_count = 1

    def cycle_speed(self, direction=1):
        """Cycle through speed multiplier options"""
        try:
            current_index = self.speed_options.index(self.speed_multiplier)
            new_index = (current_index + direction) % len(self.speed_options)
            self.speed_multiplier = self.speed_options[new_index]
        except ValueError:
            self.speed_multiplier = 1.0

    def get_speed_label(self):
        """Get display label for current speed"""
        try:
            index = self.speed_options.index(self.speed_multiplier)
            return self.speed_labels[index]
        except ValueError:
            return "100%"

    def cycle_friendly_fire(self, direction=1):
        """Cycle through friendly fire options"""
        try:
            current_index = self.friendly_fire_options.index(self.friendly_fire_enabled)
            new_index = (current_index + direction) % len(self.friendly_fire_options)
            self.friendly_fire_enabled = self.friendly_fire_options[new_index]
        except ValueError:
            self.friendly_fire_enabled = FRIENDLY_FIRE_ENABLED

    def cycle_shared_lives(self, direction=1):
        """Cycle through shared lives options"""
        try:
            current_index = self.shared_lives_options.index(self.shared_lives_enabled)
            new_index = (current_index + direction) % len(self.shared_lives_options)
            self.shared_lives_enabled = self.shared_lives_options[new_index]
        except ValueError:
            self.shared_lives_enabled = SHARED_LIVES_ENABLED

    def get_input_display_name(self, input_source, player_num):
        """Get human-readable name for an input source"""
        options = self.get_available_options(player_num)
        for name, value in options:
            if value == input_source:
                return name
        return "Unknown"

    def handle_event(self, event):
        """Handle keyboard/gamepad input for config screen"""
        if event.type == pygame.KEYDOWN:
            # UP navigation (also support W key)
            if event.key == pygame.K_UP or event.key == pygame.K_w:
                self.selected_player = max(0, self.selected_player - 1)
                # Skip Player 2 option if in 1-player mode
                if self.player_count == 1 and self.selected_player == 2:
                    self.selected_player = 1
            # DOWN navigation (also support S key)
            elif event.key == pygame.K_DOWN or event.key == pygame.K_s:
                self.selected_player = min(5, self.selected_player + 1)
                # Skip Player 2 option if in 1-player mode
                if self.player_count == 1 and self.selected_player == 2:
                    self.selected_player = 3
            # LEFT navigation (also support A key)
            elif event.key == pygame.K_LEFT or event.key == pygame.K_a:
                if self.selected_player == 0:
                    self.cycle_player_count(-1)
                elif self.selected_player == 1:
                    self.cycle_player1_input(-1)
                elif self.selected_player == 2:
                    self.cycle_player2_input(-1)
                elif self.selected_player == 3:
                    self.cycle_speed(-1)
                elif self.selected_player == 4:
                    self.cycle_friendly_fire(-1)
                else:  # selected_player == 5
                    self.cycle_shared_lives(-1)
            # RIGHT navigation (also support D key)
            elif event.key == pygame.K_RIGHT or event.key == pygame.K_d:
                if self.selected_player == 0:
                    self.cycle_player_count(1)
                elif self.selected_player == 1:
                    self.cycle_player1_input(1)
                elif self.selected_player == 2:
                    self.cycle_player2_input(1)
                elif self.selected_player == 3:
                    self.cycle_speed(1)
                elif self.selected_player == 4:
                    self.cycle_friendly_fire(1)
                else:  # selected_player == 5
                    self.cycle_shared_lives(1)
            elif event.key == pygame.K_RETURN or event.key == pygame.K_SPACE:
                self.config_complete = True

        # Gamepad support for navigation
        elif event.type == pygame.JOYBUTTONDOWN:
            if event.button == 0:  # A button - confirm
                self.config_complete = True
            elif event.button == 11:  # D-pad up
                self.selected_player = max(0, self.selected_player - 1)
                # Skip Player 2 option if in 1-player mode
                if self.player_count == 1 and self.selected_player == 2:
                    self.selected_player = 1
            elif event.button == 12:  # D-pad down
                self.selected_player = min(5, self.selected_player + 1)
                # Skip Player 2 option if in 1-player mode
                if self.player_count == 1 and self.selected_player == 2:
                    self.selected_player = 3
            elif event.button == 13:  # D-pad left
                if self.selected_player == 0:
                    self.cycle_player_count(-1)
                elif self.selected_player == 1:
                    self.cycle_player1_input(-1)
                elif self.selected_player == 2:
                    self.cycle_player2_input(-1)
                elif self.selected_player == 3:
                    self.cycle_speed(-1)
                elif self.selected_player == 4:
                    self.cycle_friendly_fire(-1)
                else:  # selected_player == 5
                    self.cycle_shared_lives(-1)
            elif event.button == 14:  # D-pad right
                if self.selected_player == 0:
                    self.cycle_player_count(1)
                elif self.selected_player == 1:
                    self.cycle_player1_input(1)
                elif self.selected_player == 2:
                    self.cycle_player2_input(1)
                elif self.selected_player == 3:
                    self.cycle_speed(1)
                elif self.selected_player == 4:
                    self.cycle_friendly_fire(1)
                else:  # selected_player == 5
                    self.cycle_shared_lives(1)

        # Also handle joystick hat for D-pad
        elif event.type == pygame.JOYHATMOTION:
            hat_x, hat_y = event.value
            if hat_y == 1:  # Up
                self.selected_player = max(0, self.selected_player - 1)
                # Skip Player 2 option if in 1-player mode
                if self.player_count == 1 and self.selected_player == 2:
                    self.selected_player = 1
            elif hat_y == -1:  # Down
                self.selected_player = min(5, self.selected_player + 1)
                # Skip Player 2 option if in 1-player mode
                if self.player_count == 1 and self.selected_player == 2:
                    self.selected_player = 3
            elif hat_x == -1:  # Left
                if self.selected_player == 0:
                    self.cycle_player_count(-1)
                elif self.selected_player == 1:
                    self.cycle_player1_input(-1)
                elif self.selected_player == 2:
                    self.cycle_player2_input(-1)
                elif self.selected_player == 3:
                    self.cycle_speed(-1)
                elif self.selected_player == 4:
                    self.cycle_friendly_fire(-1)
                else:  # selected_player == 5
                    self.cycle_shared_lives(-1)
            elif hat_x == 1:  # Right
                if self.selected_player == 0:
                    self.cycle_player_count(1)
                elif self.selected_player == 1:
                    self.cycle_player1_input(1)
                elif self.selected_player == 2:
                    self.cycle_player2_input(1)
                elif self.selected_player == 3:
                    self.cycle_speed(1)
                elif self.selected_player == 4:
                    self.cycle_friendly_fire(1)
                else:  # selected_player == 5
                    self.cycle_shared_lives(1)

    def draw(self, screen):
        """Draw the control configuration screen"""
        screen.fill((0, 0, 0))

        # Use pre-created fonts
        title = self.font_title.render("CONTROL SETUP", True, (255, 255, 255))
        title_rect = title.get_rect(center=(SCREEN_WIDTH // 2, 80))
        screen.blit(title, title_rect)

        # Gamepad detection info
        if self.gamepad_count > 0:
            gamepad_text = self.font_small.render(f"{self.gamepad_count} gamepad(s) detected", True, (100, 255, 100))
        else:
            gamepad_text = self.font_small.render("No gamepads detected - using keyboards", True, (255, 200, 100))
        gamepad_rect = gamepad_text.get_rect(center=(SCREEN_WIDTH // 2, 140))
        screen.blit(gamepad_text, gamepad_rect)

        # Player count selection
        y_offset = 190
        player_count_color = (255, 255, 255) if self.selected_player == 0 else (150, 150, 150)
        player_count_label = self.font_large.render("PLAYERS", True, player_count_color)
        player_count_label_rect = player_count_label.get_rect(center=(SCREEN_WIDTH // 2, y_offset))
        screen.blit(player_count_label, player_count_label_rect)

        # Player count display
        player_count_display = f"< {self.player_count} >"
        player_count_text = self.font_medium.render(player_count_display, True, player_count_color)
        player_count_rect = player_count_text.get_rect(center=(SCREEN_WIDTH // 2, y_offset + 50))
        screen.blit(player_count_text, player_count_rect)

        # Selection indicator for player count
        if self.selected_player == 0:
            indicator = self.font_medium.render("^", True, (255, 255, 255))
            indicator_rect = indicator.get_rect(center=(SCREEN_WIDTH // 2, y_offset + 85))
            screen.blit(indicator, indicator_rect)

        # Player 1 config
        y_offset = 300
        p1_color = (100, 200, 255) if self.selected_player == 1 else (150, 150, 150)
        p1_label = self.font_large.render("PLAYER 1", True, p1_color)
        p1_label_rect = p1_label.get_rect(center=(SCREEN_WIDTH // 2, y_offset))
        screen.blit(p1_label, p1_label_rect)

        # Player 1 input display
        p1_input_name = self.get_input_display_name(self.player1_input, 1)
        p1_input_text = self.font_medium.render(f"< {p1_input_name} >", True, p1_color)
        p1_input_rect = p1_input_text.get_rect(center=(SCREEN_WIDTH // 2, y_offset + 50))
        screen.blit(p1_input_text, p1_input_rect)

        # Selection indicator for Player 1
        if self.selected_player == 1:
            indicator = self.font_medium.render("^", True, (100, 200, 255))
            indicator_rect = indicator.get_rect(center=(SCREEN_WIDTH // 2, y_offset + 85))
            screen.blit(indicator, indicator_rect)

        # Player 2 config (only show if 2 players selected)
        if self.player_count == 2:
            y_offset = 410
            p2_color = (255, 200, 100) if self.selected_player == 2 else (150, 150, 150)
            p2_label = self.font_large.render("PLAYER 2", True, p2_color)
            p2_label_rect = p2_label.get_rect(center=(SCREEN_WIDTH // 2, y_offset))
            screen.blit(p2_label, p2_label_rect)

            # Player 2 input display
            p2_input_name = self.get_input_display_name(self.player2_input, 2)
            p2_input_text = self.font_medium.render(f"< {p2_input_name} >", True, p2_color)
            p2_input_rect = p2_input_text.get_rect(center=(SCREEN_WIDTH // 2, y_offset + 50))
            screen.blit(p2_input_text, p2_input_rect)

            # Selection indicator for Player 2
            if self.selected_player == 2:
                indicator = self.font_medium.render("^", True, (255, 200, 100))
                indicator_rect = indicator.get_rect(center=(SCREEN_WIDTH // 2, y_offset + 85))
                screen.blit(indicator, indicator_rect)

        # Speed config
        y_offset = 520 if self.player_count == 2 else 410
        speed_color = (100, 255, 100) if self.selected_player == 3 else (150, 150, 150)
        speed_label = self.font_large.render("SPEED", True, speed_color)
        speed_label_rect = speed_label.get_rect(center=(SCREEN_WIDTH // 2, y_offset))
        screen.blit(speed_label, speed_label_rect)

        # Speed display
        speed_display = self.get_speed_label()
        speed_text = self.font_medium.render(f"< {speed_display} >", True, speed_color)
        speed_rect = speed_text.get_rect(center=(SCREEN_WIDTH // 2, y_offset + 50))
        screen.blit(speed_text, speed_rect)

        # Selection indicator for Speed
        if self.selected_player == 3:
            indicator = self.font_medium.render("^", True, (100, 255, 100))
            indicator_rect = indicator.get_rect(center=(SCREEN_WIDTH // 2, y_offset + 85))
            screen.blit(indicator, indicator_rect)

        # Friendly Fire config (only show if 2 players)
        if self.player_count == 2:
            y_offset = 615
            ff_color = (255, 100, 100) if self.selected_player == 4 else (150, 150, 150)
            ff_label = self.font_large.render("FRIENDLY FIRE", True, ff_color)
            ff_label_rect = ff_label.get_rect(center=(SCREEN_WIDTH // 2, y_offset))
            screen.blit(ff_label, ff_label_rect)

            # Friendly Fire display
            ff_display = "ON" if self.friendly_fire_enabled else "OFF"
            ff_text = self.font_medium.render(f"< {ff_display} >", True, ff_color)
            ff_rect = ff_text.get_rect(center=(SCREEN_WIDTH // 2, y_offset + 50))
            screen.blit(ff_text, ff_rect)

            # Selection indicator for Friendly Fire
            if self.selected_player == 4:
                indicator = self.font_medium.render("^", True, (255, 100, 100))
                indicator_rect = indicator.get_rect(center=(SCREEN_WIDTH // 2, y_offset + 85))
                screen.blit(indicator, indicator_rect)

            # Shared Lives config
            y_offset = 710
            sl_color = (100, 255, 255) if self.selected_player == 5 else (150, 150, 150)
            sl_label = self.font_large.render("SHARED LIVES", True, sl_color)
            sl_label_rect = sl_label.get_rect(center=(SCREEN_WIDTH // 2, y_offset))
            screen.blit(sl_label, sl_label_rect)

            # Shared Lives display
            sl_display = "ON" if self.shared_lives_enabled else "OFF"
            sl_text = self.font_medium.render(f"< {sl_display} >", True, sl_color)
            sl_rect = sl_text.get_rect(center=(SCREEN_WIDTH // 2, y_offset + 50))
            screen.blit(sl_text, sl_rect)

            # Selection indicator for Shared Lives
            if self.selected_player == 5:
                indicator = self.font_medium.render("^", True, (100, 255, 255))
                indicator_rect = indicator.get_rect(center=(SCREEN_WIDTH // 2, y_offset + 85))
                screen.blit(indicator, indicator_rect)

        # Instructions
        y_offset = 805 if self.player_count == 2 else 505
        instructions = [
            "WASD or ARROWS: Navigate",
            "ENTER or SPACE: Start game"
        ]

        for i, instruction in enumerate(instructions):
            text = self.font_small.render(instruction, True, (200, 200, 200))
            text_rect = text.get_rect(center=(SCREEN_WIDTH // 2, y_offset + i * 30))
            screen.blit(text, text_rect)

        # Warning if both players use same input
        if self.player1_input == self.player2_input:
            warning = self.font_small.render("WARNING: Both players using same input!", True, (255, 100, 100))
            warning_rect = warning.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT - 40))
            screen.blit(warning, warning_rect)

    def is_complete(self):
        """Check if configuration is complete"""
        return self.config_complete

    def get_player_inputs(self):
        """Return the configured inputs for both players"""
        return self.player1_input, self.player2_input

    def get_speed_multiplier(self):
        """Return the configured speed multiplier"""
        return self.speed_multiplier

    def get_player_count(self):
        """Return the configured player count"""
        return self.player_count

    def get_friendly_fire_enabled(self):
        """Return the configured friendly fire setting"""
        return self.friendly_fire_enabled

    def get_shared_lives_enabled(self):
        """Return the configured shared lives setting"""
        return self.shared_lives_enabled
