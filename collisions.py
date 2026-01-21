"""Collision detection and handling for Asteroids game."""

import random
import sys
import pygame

from constants import (
    COMBO_TIMEOUT, COMBO_MULTIPLIERS, PARTICLE_SPEED,
    SCREEN_SHAKE_MAX, SCREEN_SHAKE_COOLDOWN,
    POWERUP_SPAWN_ENABLED, POWERUP_SPAWN_CHANCE, MEGA_POWER_SPAWN_CHANCE,
    SLOW_MOTION_DURATION, MEGA_POWER_DURATION,
    UFO_LARGE_POINTS, UFO_SMALL_POINTS,
    KILL_STREAK_ENABLED, KILL_STREAK_MILESTONES,
)
from powerup import PowerUp
from killstreak import KillStreakNotification
from highscores import add_score, is_high_score
from taunt import TauntAnimation
from ufo import UFO

IS_WEB = sys.platform == "emscripten"


def debug_print(*args, **kwargs):
    """Print only on desktop, not on web."""
    if not IS_WEB:
        print(*args, **kwargs)


def check_kill_streak_milestone(combo_count, last_milestone):
    """Check if a new kill streak milestone has been reached. Returns milestone info or None."""
    if not KILL_STREAK_ENABLED:
        return None

    # Find the highest milestone we've reached that's higher than the last one
    for milestone in sorted(KILL_STREAK_MILESTONES.keys(), reverse=True):
        if combo_count >= milestone and milestone > last_milestone:
            streak_info = KILL_STREAK_MILESTONES[milestone]
            return {
                'milestone': milestone,
                'name': streak_info['name'],
                'color': streak_info['color']
            }

    return None


def increment_combo_and_check_streak(state):
    """Increment combo and check for kill streak milestones. Updates state in place."""
    state.combo_count += 1
    state.combo_timer = COMBO_TIMEOUT

    # Check if we hit a new milestone
    milestone_info = check_kill_streak_milestone(
        state.combo_count, state.last_streak_milestone)
    if milestone_info:
        # Create new notification
        state.active_streak_notification = KillStreakNotification(
            state.combo_count,
            milestone_info['name'],
            milestone_info['color']
        )
        state.last_streak_milestone = milestone_info['milestone']


def spawn_particles(particle_system, x, y, count):
    """Spawn explosion particles at a position."""
    for i in range(count):
        angle = (360 / count) * i + random.uniform(-15, 15)
        velocity = pygame.Vector2(0, 1).rotate(angle) * PARTICLE_SPEED
        particle_system.emit(x, y, velocity)


def add_screen_shake(state, amount):
    """Add screen shake if cooldown has expired."""
    if state.screen_shake_cooldown <= 0:
        state.screen_shake = min(state.screen_shake + amount, SCREEN_SHAKE_MAX)
        state.screen_shake_cooldown = SCREEN_SHAKE_COOLDOWN


def maybe_spawn_powerup(x, y):
    """Maybe spawn a power-up at the given position based on spawn chances."""
    if not POWERUP_SPAWN_ENABLED:
        return

    # First check for rare MEGA POWER
    if random.random() < MEGA_POWER_SPAWN_CHANCE:
        PowerUp(x, y, PowerUp.MEGA_POWER)
    elif random.random() < POWERUP_SPAWN_CHANCE:
        # Randomly choose a normal power-up type
        powerup_types = [
            PowerUp.RAPID_FIRE, PowerUp.SHIELD, PowerUp.MULTI_SHOT, PowerUp.SLOW_MOTION]
        chosen_type = random.choice(powerup_types)
        PowerUp(x, y, chosen_type)


def handle_asteroid_destruction(asteroid, state, particle_system, points_recipient=None):
    """
    Handle the destruction of an asteroid (particles, shake, points, powerup).
    Returns the points earned.
    """
    # Increment combo
    increment_combo_and_check_streak(state)

    # Calculate points with combo multiplier
    base_points = asteroid.get_points()
    multiplier = COMBO_MULTIPLIERS.get(state.combo_count, COMBO_MULTIPLIERS[5])
    points_earned = int(base_points * multiplier)

    # Award points
    if points_recipient:
        points_recipient.score += points_earned

    # Split the asteroid and get effect info
    effect_info = asteroid.split()
    if effect_info:
        add_screen_shake(state, effect_info['shake_amount'])
        spawn_particles(particle_system, effect_info['position'].x,
                        effect_info['position'].y, effect_info['particle_count'])

    # Maybe spawn power-up
    maybe_spawn_powerup(asteroid.position.x, asteroid.position.y)

    return points_earned


def handle_game_over(state, player1, player2):
    """Handle game over state and high score submission."""
    debug_print("Game over!")
    debug_print(f"Player 1 Final Score: {player1.score}")
    debug_print(f"Player 2 Final Score: {player2.score}")

    state.trigger_game_over()
    state.taunt_animation = TauntAnimation()

    # Check if scores qualify for high score board BEFORE saving
    p1_is_high = is_high_score(player1.score) if player1.score > 0 else False
    p2_is_high = is_high_score(player2.score) if player2.score > 0 else False

    # Save high scores and store ranks
    if player1.score > 0:
        state.p1_highscore_rank = add_score("Player 1", player1.score)
        if state.p1_highscore_rank:
            debug_print(f"Player 1 achieved high score rank #{state.p1_highscore_rank}!")
    else:
        state.p1_highscore_rank = None

    if player2.score > 0:
        state.p2_highscore_rank = add_score("Player 2", player2.score)
        if state.p2_highscore_rank:
            debug_print(f"Player 2 achieved high score rank #{state.p2_highscore_rank}!")
    else:
        state.p2_highscore_rank = None

    # Show high scores if either player got one
    state.show_high_scores = (p1_is_high or p2_is_high)


def handle_player_asteroid_collision(player, player_num, asteroid, state, particle_system,
                                     spawn_x, spawn_y, other_player):
    """
    Handle collision between a player and an asteroid.
    Returns True if game should continue checking collisions, False if game over.
    """
    player_dead_attr = f'player{player_num}_dead'
    other_dead_attr = f'player{3 - player_num}_dead'

    # If player is boosting, ram through the asteroid
    if player.boost_active:
        points = handle_asteroid_destruction(asteroid, state, particle_system, player)
        if state.combo_count > 1:
            debug_print(f"Player {player_num}: +{points} points! ({state.combo_count}x COMBO) [BOOST RAM]")
        else:
            debug_print(f"Player {player_num}: +{points} points [BOOST RAM]")
        return True

    # Normal collision - take damage
    if not player.take_damage():
        debug_print(f"Player {player_num} shield absorbed hit!")
        # Still destroy the asteroid
        effect_info = asteroid.split()
        if effect_info:
            add_screen_shake(state, effect_info['shake_amount'] * 0.5)
            spawn_particles(particle_system, effect_info['position'].x,
                            effect_info['position'].y, effect_info['particle_count'])
        return True

    # Player took damage (take_damage() already decremented player.lives)
    if state.shared_lives_enabled:
        # Shared lives mode - both players share player1's life pool
        # take_damage() decremented the hitting player's lives, but for shared mode
        # we need to track from player1's pool. Since take_damage already decremented
        # the hitting player, we need to sync: restore hitting player's lives and
        # decrement player1's lives instead (if player2 was hit)
        if player_num == 2:
            # Undo the decrement to player2, decrement player1 instead
            player.lives += 1  # Restore player2's lives
            other_player.lives -= 1  # Decrement shared pool (player1)
            lives_remaining = other_player.lives
        else:
            # Player1 was hit, take_damage already decremented correctly
            lives_remaining = player.lives

        debug_print(f"Player {player_num} hit! Shared lives remaining: {lives_remaining}")

        if lives_remaining > 0:
            player.respawn(spawn_x, spawn_y)
        else:
            # Out of shared lives - both dead
            debug_print("Out of shared lives! Game over!")
            state.player1_dead = True
            state.player2_dead = True
            handle_game_over(state, player if player_num == 1 else other_player,
                            other_player if player_num == 1 else player)
            return False
    else:
        # Individual lives mode (take_damage() already decremented)
        debug_print(f"Player {player_num} hit! Lives remaining: {player.lives}")
        if player.lives > 0:
            player.respawn(spawn_x, spawn_y)
        else:
            debug_print(f"Player {player_num} eliminated!")
            setattr(state, player_dead_attr, True)

            # Check if both players are dead
            if other_player.lives <= 0:
                handle_game_over(state, player if player_num == 1 else other_player,
                                other_player if player_num == 1 else player)
                return False

    # Destroy the asteroid that hit the player
    effect_info = asteroid.split()
    if effect_info:
        add_screen_shake(state, effect_info['shake_amount'] * 0.5)
        spawn_particles(particle_system, effect_info['position'].x,
                        effect_info['position'].y, effect_info['particle_count'])

    return True


def handle_shot_asteroid_collisions(shots, collision_grid, state, particle_system):
    """Handle collisions between shots and asteroids."""
    for shot in list(shots):
        for asteroid in collision_grid.get_nearby(shot):
            if asteroid.check_collision(shot):
                # Get the owner for points - skip UFO shots (they don't score points)
                if shot.owner and hasattr(shot.owner, 'player_number'):
                    player_name = f"Player {shot.owner.player_number}"
                    points = handle_asteroid_destruction(asteroid, state, particle_system, shot.owner)
                elif shot.owner:
                    # UFO shot hit asteroid - no points, just destroy
                    player_name = "UFO"
                    points = handle_asteroid_destruction(asteroid, state, particle_system, None)
                else:
                    player_name = "Unknown"
                    points = handle_asteroid_destruction(asteroid, state, particle_system, None)

                if state.combo_count > 1:
                    debug_print(f"{player_name}: +{points} points! ({state.combo_count}x COMBO)")
                else:
                    debug_print(f"{player_name}: +{points} points")

                shot.kill()
                break


def handle_laser_asteroid_collisions(laser_beams, asteroids, state, particle_system, dt):
    """Handle laser beam collisions with asteroids. Returns list of expired lasers."""
    laser_beams_to_remove = []

    for laser in laser_beams:
        if not laser.update(dt):
            laser_beams_to_remove.append(laser)
            continue

        # Check collisions with all asteroids
        for asteroid in asteroids:
            if asteroid.dying:
                continue

            if laser.check_hit(asteroid):
                if laser.owner:
                    player_name = f"Player {laser.owner.player_number}"
                else:
                    player_name = "Unknown"

                points = handle_asteroid_destruction(asteroid, state, particle_system, laser.owner)

                if state.combo_count > 1:
                    debug_print(f"{player_name}: +{points} points! ({state.combo_count}x COMBO)")
                else:
                    debug_print(f"{player_name}: +{points} points")

    return laser_beams_to_remove


def handle_ufo_shot_collision(ufo, shot, state, particle_system):
    """Handle a UFO being hit by a player shot."""
    # Determine points based on UFO type
    points = UFO_LARGE_POINTS if ufo.ufo_type == "large" else UFO_SMALL_POINTS

    # Award points to shooter
    if shot.owner:
        shot.owner.score += points
        player_name = f"Player {shot.owner.player_number}"
        debug_print(f"{player_name}: UFO destroyed! +{points} points")

    # Screen shake effect
    add_screen_shake(state, 6)

    # Spawn particles at UFO position
    spawn_particles(particle_system, ufo.position.x, ufo.position.y, 10)

    # Always spawn a power-up (guaranteed drop from UFOs)
    powerup_types = [
        PowerUp.RAPID_FIRE, PowerUp.SHIELD, PowerUp.MULTI_SHOT, PowerUp.SLOW_MOTION]
    chosen_type = random.choice(powerup_types)
    PowerUp(ufo.position.x, ufo.position.y, chosen_type)

    # Destroy UFO and shot
    ufo.kill()
    shot.kill()


def handle_ufo_player_collision(ufo, player, player_num, state, particle_system,
                                 spawn_x, spawn_y, player1, player2):
    """Handle collision between a UFO and a player."""
    if player.boost_active:
        # Boosting player destroys UFO
        points = UFO_LARGE_POINTS if ufo.ufo_type == "large" else UFO_SMALL_POINTS
        player.score += points
        debug_print(f"Player {player_num}: UFO destroyed by boost! +{points} points")

        add_screen_shake(state, 6)
        spawn_particles(particle_system, ufo.position.x, ufo.position.y, 10)

        # Guaranteed power-up
        powerup_types = [
            PowerUp.RAPID_FIRE, PowerUp.SHIELD, PowerUp.MULTI_SHOT, PowerUp.SLOW_MOTION]
        chosen_type = random.choice(powerup_types)
        PowerUp(ufo.position.x, ufo.position.y, chosen_type)

        ufo.kill()
        return True

    # Normal collision - take damage
    if not player.take_damage():
        return True  # Shield absorbed

    if state.shared_lives_enabled:
        # Shared lives mode - sync to player1's pool
        if player_num == 2:
            player.lives += 1  # Restore player2's lives
            player1.lives -= 1  # Decrement shared pool
        debug_print(f"Player {player_num} hit by UFO! Shared lives remaining: {player1.lives}")
        if player1.lives > 0:
            player.respawn(spawn_x, spawn_y)
        else:
            debug_print("Out of shared lives! Game over!")
            state.player1_dead = True
            state.player2_dead = True
            handle_game_over(state, player1, player2)
            return False
    else:
        debug_print(f"Player {player_num} hit by UFO! Lives remaining: {player.lives}")
        if player.lives > 0:
            player.respawn(spawn_x, spawn_y)
        else:
            setattr(state, f'player{player_num}_dead', True)
            if state.player1_dead and state.player2_dead:
                handle_game_over(state, player1, player2)
                return False

    return True


def handle_ufo_shot_hitting_player(shot, player, player_num, state, spawn_x, spawn_y, player1, player2):
    """Handle a UFO shot hitting a player."""
    if not player.take_damage():
        shot.kill()
        return True  # Shield absorbed

    if state.shared_lives_enabled:
        # Shared lives mode - sync to player1's pool
        if player_num == 2:
            player.lives += 1  # Restore player2's lives
            player1.lives -= 1  # Decrement shared pool
        debug_print(f"Player {player_num} hit by UFO shot! Shared lives remaining: {player1.lives}")
        if player1.lives > 0:
            player.respawn(spawn_x, spawn_y)
        else:
            debug_print("Out of shared lives! Game over!")
            state.player1_dead = True
            state.player2_dead = True
            handle_game_over(state, player1, player2)
            shot.kill()
            return False
    else:
        debug_print(f"Player {player_num} hit by UFO shot! Lives remaining: {player.lives}")
        if player.lives > 0:
            player.respawn(spawn_x, spawn_y)
        else:
            setattr(state, f'player{player_num}_dead', True)
            if state.player1_dead and state.player2_dead:
                handle_game_over(state, player1, player2)
                shot.kill()
                return False

    shot.kill()
    return True


def handle_powerup_collection(player, player_num, powerup, state, other_player,
                               p1_spawn_x, p1_spawn_y, p2_spawn_x, p2_spawn_y):
    """Handle a player collecting a power-up."""
    if powerup.powerup_type == PowerUp.MEGA_POWER:
        player.activate_mega_power()
        state.slow_motion_active = True
        state.slow_motion_timer = MEGA_POWER_DURATION
        debug_print(f"Player {player_num}: MEGA POWER ACTIVATED!")
    elif powerup.powerup_type == PowerUp.RAPID_FIRE:
        player.activate_rapid_fire()
        debug_print(f"Player {player_num}: Rapid Fire!")
    elif powerup.powerup_type == PowerUp.SHIELD:
        player.activate_shield()
        debug_print(f"Player {player_num}: Shield!")
    elif powerup.powerup_type == PowerUp.MULTI_SHOT:
        player.activate_multi_shot()
        debug_print(f"Player {player_num}: Multi-Shot!")
    elif powerup.powerup_type == PowerUp.SLOW_MOTION:
        state.slow_motion_active = True
        state.slow_motion_timer = SLOW_MOTION_DURATION
        debug_print(f"Player {player_num}: Slow Motion!")
    elif powerup.powerup_type == PowerUp.REVIVE:
        # Revive dead player
        other_num = 3 - player_num
        other_dead = getattr(state, f'player{other_num}_dead')
        player_dead = getattr(state, f'player{player_num}_dead')

        if other_dead and other_player.lives == 0:
            other_player.lives = 3  # Revive with 3 lives
            spawn_x = p2_spawn_x if other_num == 2 else p1_spawn_x
            spawn_y = p2_spawn_y if other_num == 2 else p1_spawn_y
            other_player.respawn(spawn_x, spawn_y)
            setattr(state, f'player{other_num}_dead', False)
            debug_print(f"Player {player_num} revived Player {other_num}!")
        elif player_dead:
            debug_print(f"Player {player_num} can't revive themselves!")
        else:
            debug_print(f"Player {player_num}: No one to revive!")

    powerup.kill()


def handle_friendly_fire_shot(shot, player, player_num, state, spawn_x, spawn_y, player1, player2):
    """Handle a shot hitting a player (friendly fire)."""
    if not player.take_damage():
        debug_print(f"Player {player_num} shield absorbed friendly fire!")
        shot.kill()
        return True

    other_player = player2 if player_num == 1 else player1
    debug_print(f"Player {player_num} hit by Player {shot.owner.player_number}'s shot! Lives remaining: {player.lives}")

    if player.lives > 0:
        player.respawn(spawn_x, spawn_y)
    else:
        debug_print(f"Player {player_num} eliminated by friendly fire!")
        setattr(state, f'player{player_num}_dead', True)
        if other_player.lives <= 0:
            handle_game_over(state, player1, player2)
            shot.kill()
            return False

    shot.kill()
    return True


def handle_friendly_fire_laser(laser, player, player_num, state, spawn_x, spawn_y, player1, player2):
    """Handle a laser hitting a player (friendly fire)."""
    if not player.take_damage():
        debug_print(f"Player {player_num} shield absorbed laser!")
        return True

    other_player = player2 if player_num == 1 else player1
    debug_print(f"Player {player_num} hit by Player {laser.owner.player_number}'s laser! Lives remaining: {player.lives}")

    if player.lives > 0:
        player.respawn(spawn_x, spawn_y)
    else:
        debug_print(f"Player {player_num} eliminated by laser!")
        setattr(state, f'player{player_num}_dead', True)
        if other_player.lives <= 0:
            handle_game_over(state, player1, player2)
            return False

    return True
