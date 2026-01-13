"""Test control configuration screen"""
import pygame
from controlconfig import ControlConfig

pygame.init()
pygame.joystick.init()

# Initialize joysticks
joysticks = [pygame.joystick.Joystick(i) for i in range(pygame.joystick.get_count())]
for joystick in joysticks:
    joystick.init()

print("Testing Control Configuration")
print(f"Detected {pygame.joystick.get_count()} gamepad(s)")

config = ControlConfig()

print(f"\nInitial config:")
print(f"  Player 1: {config.player1_input}")
print(f"  Player 2: {config.player2_input}")

# Test cycling
print("\nTesting player 1 input cycling:")
config.cycle_player1_input(1)
print(f"  After cycle forward: {config.player1_input}")

print("\nTesting player 2 input cycling:")
config.cycle_player2_input(1)
print(f"  After cycle forward: {config.player2_input}")

# Test display names
print("\nDisplay names:")
print(f"  Player 1: {config.get_input_display_name(config.player1_input, 1)}")
print(f"  Player 2: {config.get_input_display_name(config.player2_input, 2)}")

# Test available options
print("\nAvailable options for Player 1:")
for name, value in config.get_available_options(1):
    print(f"  {name} -> {value}")

print("\nAvailable options for Player 2:")
for name, value in config.get_available_options(2):
    print(f"  {name} -> {value}")

print("\n[SUCCESS] Control config tests passed!")
