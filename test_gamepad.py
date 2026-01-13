import pygame

pygame.init()
pygame.joystick.init()

print(f"Number of joysticks detected: {pygame.joystick.get_count()}")

if pygame.joystick.get_count() == 0:
    print("No gamepad detected!")
    print("Make sure your gamepad is connected and recognized by your system.")
    exit()

joystick = pygame.joystick.Joystick(0)
joystick.init()

print(f"\nGamepad name: {joystick.get_name()}")
print(f"Number of axes: {joystick.get_numaxes()}")
print(f"Number of buttons: {joystick.get_numbuttons()}")
print(f"Number of hats: {joystick.get_numhats()}")

print("\n" + "="*60)
print("GAMEPAD TEST - Press buttons and move sticks")
print("Press Ctrl+C to exit")
print("="*60 + "\n")

screen = pygame.display.set_mode((400, 300))
pygame.display.set_caption("Gamepad Test")
clock = pygame.time.Clock()

running = True
while running:
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            running = False
        elif event.type == pygame.JOYBUTTONDOWN:
            print(f"Button {event.button} pressed")
        elif event.type == pygame.JOYBUTTONUP:
            print(f"Button {event.button} released")
        elif event.type == pygame.JOYAXISMOTION:
            if abs(event.value) > 0.1:  # Only show significant movements
                print(f"Axis {event.axis} moved to {event.value:.2f}")
        elif event.type == pygame.JOYHATMOTION:
            print(f"Hat moved to {event.value}")

    # Also show current axis values continuously
    axis_str = "Axes: "
    for i in range(joystick.get_numaxes()):
        value = joystick.get_axis(i)
        if abs(value) > 0.1:
            axis_str += f"[{i}]={value:.2f} "

    # Clear and redraw if there's axis activity
    if len(axis_str) > 7:
        print(f"\r{axis_str}          ", end="", flush=True)

    screen.fill((0, 0, 0))
    pygame.display.flip()
    clock.tick(30)

pygame.quit()
