# this allows us to use code from
# the open-source pygame library
# throughout this file
from constants import ASTEROID_MAX_RADIUS, ASTEROID_MIN_RADIUS, ASTEROID_SPAWN_RATE, SCREEN_HEIGHT, SCREEN_WIDTH
import pygame
from constants import *

def main():
    print("Starting Asteroids!")
    print("Screen width:", SCREEN_WIDTH)
    print("Screen height:", SCREEN_HEIGHT)
    # print("Asteroid Min Radius:", ASTEROID_MIN_RADIUS)
    # print("Asteroid Max Radius:", ASTEROID_MAX_RADIUS)
    # print("Asteroid Spawn Rate:", ASTEROID_SPAWN_RATE)

    pygame.init()
    screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
    pygame.display.set_caption("Asteroids Game")

    # Main game loop
    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
        screen.fill((0, 0, 0))  # Fill the screen with black
        pygame.display.flip()  # Update the display
       


if __name__ == "__main__":
    main()
