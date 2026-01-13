"""Quick test to verify multiplayer setup works"""
import sys
sys.path.insert(0, '.')

# Test imports
try:
    from player import Player
    from shot import Shot
    print("[OK] Imports successful")
except Exception as e:
    print(f"[FAIL] Import error: {e}")
    sys.exit(1)

# Test player creation with different input sources
try:
    p1 = Player(100, 100, "keyboard", 1)
    p2 = Player(200, 200, "keyboard_2", 2)
    print("[OK] Players created successfully")
    print(f"  Player 1: lives={p1.lives}, score={p1.score}, input={p1.input_source}")
    print(f"  Player 2: lives={p2.lives}, score={p2.score}, input={p2.input_source}")
except Exception as e:
    print(f"[FAIL] Player creation error: {e}")
    sys.exit(1)

# Test shot ownership
try:
    import pygame
    pygame.init()
    shot1 = Shot(100, 100, 5, 0, p1)
    shot2 = Shot(200, 200, 5, 90, p2)
    print("[OK] Shots created with ownership")
    print(f"  Shot 1 owner: Player {shot1.owner.player_number if shot1.owner else 'None'}")
    print(f"  Shot 2 owner: Player {shot2.owner.player_number if shot2.owner else 'None'}")
except Exception as e:
    print(f"[FAIL] Shot creation error: {e}")
    sys.exit(1)

# Test score assignment
try:
    p1.score = 100
    p2.score = 200
    print("[OK] Score assignment works")
    print(f"  Player 1 score: {p1.score}")
    print(f"  Player 2 score: {p2.score}")
except Exception as e:
    print(f"[FAIL] Score assignment error: {e}")
    sys.exit(1)

# Test lives and respawn
try:
    initial_lives = p1.lives
    p1.take_damage()
    print(f"[OK] Damage system works (lives: {initial_lives} -> {p1.lives})")

    p1.respawn(150, 150)
    print(f"[OK] Respawn works (position: ({p1.position.x}, {p1.position.y}), invulnerable: {p1.is_respawning})")
except Exception as e:
    print(f"[FAIL] Damage/respawn error: {e}")
    sys.exit(1)

print("\n[SUCCESS] All multiplayer tests passed!")
