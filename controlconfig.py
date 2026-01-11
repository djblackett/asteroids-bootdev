"""Control configuration screen for multiplayer setup"""
import pygame
from constants import SCREEN_WIDTH, SCREEN_HEIGHT


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
        self.selected_player = 0  # Which row is selected: 0=Players, 1=P1, 2=P2, 3=Speed
        self.config_complete = False

        # Player count toggle
        self.player_count = 1  # 1 or 2 players
        self.player_count_options = [1, 2]

        # Speed multiplier (1.0 = normal, 1.5 = 50% faster, etc.)
        self.speed_multiplier = 1.0
        self.speed_options = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]
        self.speed_labels = ["50%", "75%", "100%", "125%", "150%", "200%"]

        # Detect available gamepads
        self.gamepad_count = pygame.joystick.get_count()
        self.gamepad_names = []
        for i in range(self.gamepad_count):
            joystick = pygame.joystick.Joystick(i)
            self.gamepad_names.append(joystick.get_name())

        # Set default based on available hardware
        if self.gamepad_count >= 2:
            self.player1_input = self.GAMEPAD_0
            self.player2_input = self.GAMEPAD_1
        elif self.gamepad_count == 1:
            self.player1_input = self.KEYBOARD_1
            self.player2_input = self.GAMEPAD_0

    def get_available_options(self, player_num):
        """Get list of available input options for a player"""
        options = [
            ("Keyboard (WASD + Space)", self.KEYBOARD_1) if player_num == 1 else ("Keyboard (Arrows + Enter)", self.KEYBOARD_2)
        ]

        # Add gamepad options if available
        for i in range(self.gamepad_count):
            gamepad_name = self.gamepad_names[i][:30]  # Truncate long names
            options.append((f"Gamepad {i+1}: {gamepad_name}", f"gamepad_{i}"))

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
            if event.key == pygame.K_UP:
                self.selected_player = max(0, self.selected_player - 1)
            elif event.key == pygame.K_DOWN:
                self.selected_player = min(3, self.selected_player + 1)
            elif event.key == pygame.K_LEFT:
                if self.selected_player == 0:
                    self.cycle_player_count(-1)
                elif self.selected_player == 1:
                    self.cycle_player1_input(-1)
                elif self.selected_player == 2:
                    self.cycle_player2_input(-1)
                else:  # selected_player == 3
                    self.cycle_speed(-1)
            elif event.key == pygame.K_RIGHT:
                if self.selected_player == 0:
                    self.cycle_player_count(1)
                elif self.selected_player == 1:
                    self.cycle_player1_input(1)
                elif self.selected_player == 2:
                    self.cycle_player2_input(1)
                else:  # selected_player == 3
                    self.cycle_speed(1)
            elif event.key == pygame.K_RETURN or event.key == pygame.K_SPACE:
                self.config_complete = True

        # Gamepad support for navigation
        elif event.type == pygame.JOYBUTTONDOWN:
            if event.button == 0:  # A button - confirm
                self.config_complete = True
            elif event.button == 11:  # D-pad up
                self.selected_player = max(0, self.selected_player - 1)
            elif event.button == 12:  # D-pad down
                self.selected_player = min(3, self.selected_player + 1)
            elif event.button == 13:  # D-pad left
                if self.selected_player == 0:
                    self.cycle_player_count(-1)
                elif self.selected_player == 1:
                    self.cycle_player1_input(-1)
                elif self.selected_player == 2:
                    self.cycle_player2_input(-1)
                else:
                    self.cycle_speed(-1)
            elif event.button == 14:  # D-pad right
                if self.selected_player == 0:
                    self.cycle_player_count(1)
                elif self.selected_player == 1:
                    self.cycle_player1_input(1)
                elif self.selected_player == 2:
                    self.cycle_player2_input(1)
                else:
                    self.cycle_speed(1)

        # Also handle joystick hat for D-pad
        elif event.type == pygame.JOYHATMOTION:
            hat_x, hat_y = event.value
            if hat_y == 1:  # Up
                self.selected_player = max(0, self.selected_player - 1)
            elif hat_y == -1:  # Down
                self.selected_player = min(3, self.selected_player + 1)
            elif hat_x == -1:  # Left
                if self.selected_player == 0:
                    self.cycle_player_count(-1)
                elif self.selected_player == 1:
                    self.cycle_player1_input(-1)
                elif self.selected_player == 2:
                    self.cycle_player2_input(-1)
                else:
                    self.cycle_speed(-1)
            elif hat_x == 1:  # Right
                if self.selected_player == 0:
                    self.cycle_player_count(1)
                elif self.selected_player == 1:
                    self.cycle_player1_input(1)
                elif self.selected_player == 2:
                    self.cycle_player2_input(1)
                else:
                    self.cycle_speed(1)

    def draw(self, screen):
        """Draw the control configuration screen"""
        screen.fill((0, 0, 0))

        # Title
        font_title = pygame.font.Font(None, 64)
        font_large = pygame.font.Font(None, 42)
        font_medium = pygame.font.Font(None, 36)
        font_small = pygame.font.Font(None, 28)

        title = font_title.render("CONTROL SETUP", True, (255, 255, 255))
        title_rect = title.get_rect(center=(SCREEN_WIDTH // 2, 80))
        screen.blit(title, title_rect)

        # Gamepad detection info
        if self.gamepad_count > 0:
            gamepad_text = font_small.render(f"{self.gamepad_count} gamepad(s) detected", True, (100, 255, 100))
        else:
            gamepad_text = font_small.render("No gamepads detected - using keyboards", True, (255, 200, 100))
        gamepad_rect = gamepad_text.get_rect(center=(SCREEN_WIDTH // 2, 140))
        screen.blit(gamepad_text, gamepad_rect)

        # Player count selection
        y_offset = 190
        player_count_color = (255, 255, 255) if self.selected_player == 0 else (150, 150, 150)
        player_count_label = font_large.render("PLAYERS", True, player_count_color)
        player_count_label_rect = player_count_label.get_rect(center=(SCREEN_WIDTH // 2, y_offset))
        screen.blit(player_count_label, player_count_label_rect)

        # Player count display
        player_count_display = f"< {self.player_count} >"
        player_count_text = font_medium.render(player_count_display, True, player_count_color)
        player_count_rect = player_count_text.get_rect(center=(SCREEN_WIDTH // 2, y_offset + 50))
        screen.blit(player_count_text, player_count_rect)

        # Selection indicator for player count
        if self.selected_player == 0:
            indicator = font_medium.render("^", True, (255, 255, 255))
            indicator_rect = indicator.get_rect(center=(SCREEN_WIDTH // 2, y_offset + 85))
            screen.blit(indicator, indicator_rect)

        # Player 1 config
        y_offset = 300
        p1_color = (100, 200, 255) if self.selected_player == 1 else (150, 150, 150)
        p1_label = font_large.render("PLAYER 1", True, p1_color)
        p1_label_rect = p1_label.get_rect(center=(SCREEN_WIDTH // 2, y_offset))
        screen.blit(p1_label, p1_label_rect)

        # Player 1 input display
        p1_input_name = self.get_input_display_name(self.player1_input, 1)
        p1_input_text = font_medium.render(f"< {p1_input_name} >", True, p1_color)
        p1_input_rect = p1_input_text.get_rect(center=(SCREEN_WIDTH // 2, y_offset + 50))
        screen.blit(p1_input_text, p1_input_rect)

        # Selection indicator for Player 1
        if self.selected_player == 1:
            indicator = font_medium.render("^", True, (100, 200, 255))
            indicator_rect = indicator.get_rect(center=(SCREEN_WIDTH // 2, y_offset + 85))
            screen.blit(indicator, indicator_rect)

        # Player 2 config (only show if 2 players selected)
        if self.player_count == 2:
            y_offset = 410
            p2_color = (255, 200, 100) if self.selected_player == 2 else (150, 150, 150)
            p2_label = font_large.render("PLAYER 2", True, p2_color)
            p2_label_rect = p2_label.get_rect(center=(SCREEN_WIDTH // 2, y_offset))
            screen.blit(p2_label, p2_label_rect)

            # Player 2 input display
            p2_input_name = self.get_input_display_name(self.player2_input, 2)
            p2_input_text = font_medium.render(f"< {p2_input_name} >", True, p2_color)
            p2_input_rect = p2_input_text.get_rect(center=(SCREEN_WIDTH // 2, y_offset + 50))
            screen.blit(p2_input_text, p2_input_rect)

            # Selection indicator for Player 2
            if self.selected_player == 2:
                indicator = font_medium.render("^", True, (255, 200, 100))
                indicator_rect = indicator.get_rect(center=(SCREEN_WIDTH // 2, y_offset + 85))
                screen.blit(indicator, indicator_rect)

        # Speed config
        y_offset = 520 if self.player_count == 2 else 410
        speed_color = (100, 255, 100) if self.selected_player == 3 else (150, 150, 150)
        speed_label = font_large.render("SPEED", True, speed_color)
        speed_label_rect = speed_label.get_rect(center=(SCREEN_WIDTH // 2, y_offset))
        screen.blit(speed_label, speed_label_rect)

        # Speed display
        speed_display = self.get_speed_label()
        speed_text = font_medium.render(f"< {speed_display} >", True, speed_color)
        speed_rect = speed_text.get_rect(center=(SCREEN_WIDTH // 2, y_offset + 50))
        screen.blit(speed_text, speed_rect)

        # Selection indicator for Speed
        if self.selected_player == 3:
            indicator = font_medium.render("^", True, (100, 255, 100))
            indicator_rect = indicator.get_rect(center=(SCREEN_WIDTH // 2, y_offset + 85))
            screen.blit(indicator, indicator_rect)

        # Instructions
        y_offset = 615 if self.player_count == 2 else 505
        instructions = [
            "UP/DOWN: Select option",
            "LEFT/RIGHT: Change setting",
            "ENTER or SPACE: Start game"
        ]

        for i, instruction in enumerate(instructions):
            text = font_small.render(instruction, True, (200, 200, 200))
            text_rect = text.get_rect(center=(SCREEN_WIDTH // 2, y_offset + i * 30))
            screen.blit(text, text_rect)

        # Warning if both players use same input
        if self.player1_input == self.player2_input:
            warning = font_small.render("WARNING: Both players using same input!", True, (255, 100, 100))
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
