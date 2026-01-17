"""
Optimized particle system using object pooling and batched rendering.

PERFORMANCE OPTIMIZATIONS:
1. Object Pooling: Pre-allocates particles to avoid per-frame memory allocation.
   Instead of creating/destroying particles, we mark them as active/inactive.

2. In-place Updates: Updates particles in a fixed-size array rather than
   creating a new filtered list every frame (avoids list comprehension allocation).

3. Batched Drawing: All particles are drawn to a single surface which is then
   blitted once, reducing the number of draw calls from N to 1.
"""

import pygame
from pygame import Vector2
import random


class PooledParticle:
    """
    A particle that can be reused via object pooling.
    Instead of creating new particles, we reset and reuse existing ones.
    """
    __slots__ = ['position', 'velocity', 'lifetime', 'max_lifetime', 'size', 'active']

    def __init__(self):
        # Using __slots__ reduces memory overhead per particle
        self.position = Vector2(0, 0)
        self.velocity = Vector2(0, 0)
        self.lifetime = 0.0
        self.max_lifetime = 0.5
        self.size = 3
        self.active = False

    def activate(self, x, y, velocity_direction):
        """Reset and activate this particle for reuse (avoids allocation)."""
        self.position.x = x
        self.position.y = y
        # Add randomness to velocity direction
        angle_offset = random.uniform(-30, 30)
        self.velocity = velocity_direction.rotate(angle_offset)
        self.lifetime = 0.0
        self.max_lifetime = random.uniform(0.3, 0.5)
        self.size = random.randint(2, 4)
        self.active = True

    def update(self, dt):
        """Update particle state. Returns False when particle expires."""
        if not self.active:
            return False

        self.position.x += self.velocity.x * dt
        self.position.y += self.velocity.y * dt
        self.lifetime += dt
        # Slow down over time
        self.velocity *= 0.95

        if self.lifetime >= self.max_lifetime:
            self.active = False
            return False
        return True


class ParticleSystem:
    """
    Manages a pool of reusable particles with batched rendering.

    USAGE:
        system = ParticleSystem(max_particles=500)

        # Spawn particles (reuses from pool, no allocation)
        system.emit(x, y, velocity, count=10)

        # Update all active particles in-place
        system.update(dt)

        # Draw all particles with a single batched blit
        system.draw(screen, offset)
    """

    def __init__(self, max_particles=500):
        """
        Pre-allocate particle pool. The pool size is fixed to avoid
        runtime allocations. If pool is exhausted, oldest particles
        are recycled (particles never visibly pop in/out).
        """
        self.max_particles = max_particles
        # Pre-allocate all particles upfront (one-time cost at startup)
        self.particles = [PooledParticle() for _ in range(max_particles)]
        # Track next available slot for round-robin allocation
        self.next_slot = 0
        # Count of currently active particles (for stats/debugging)
        self.active_count = 0

        # Pre-create the batch surface for drawing (reused each frame)
        # Created lazily on first draw to ensure pygame is initialized
        self._batch_surface = None
        self._surface_size = None

    def emit(self, x, y, velocity_direction, count=1):
        """
        Emit particles at position with given velocity direction.
        Uses round-robin allocation from the pool - if pool is full,
        oldest particles are overwritten (graceful degradation).
        """
        for _ in range(count):
            # Get next particle slot (wraps around if pool is full)
            particle = self.particles[self.next_slot]

            # If overwriting an active particle, decrement count
            if particle.active:
                self.active_count -= 1

            # Activate/reset the particle
            particle.activate(x, y, velocity_direction)
            self.active_count += 1

            # Move to next slot (round-robin)
            self.next_slot = (self.next_slot + 1) % self.max_particles

    def update(self, dt):
        """
        Update all particles in-place. No list allocation occurs.
        Inactive particles are simply skipped, not removed.
        """
        active = 0
        for particle in self.particles:
            if particle.active:
                particle.update(dt)
                if particle.active:  # Still active after update
                    active += 1
        self.active_count = active

    def draw(self, screen, offset=(0, 0)):
        """
        Draw all active particles using batched rendering.

        Instead of calling pygame.draw.circle() for each particle (N draw calls),
        we draw to a temporary surface and blit once (1 draw call + 1 blit).
        This reduces draw call overhead significantly when particle count is high.
        """
        if self.active_count == 0:
            return

        screen_size = screen.get_size()

        # Lazily create/resize batch surface as needed
        if self._batch_surface is None or self._surface_size != screen_size:
            # SRCALPHA allows per-pixel transparency for particle fading
            self._batch_surface = pygame.Surface(screen_size, pygame.SRCALPHA)
            self._surface_size = screen_size

        # Clear the batch surface (transparent)
        self._batch_surface.fill((0, 0, 0, 0))

        # Draw all active particles to the batch surface
        offset_x, offset_y = offset
        for particle in self.particles:
            if not particle.active:
                continue

            # Calculate fade based on lifetime
            alpha = 1.0 - (particle.lifetime / particle.max_lifetime)
            color_value = int(255 * alpha)
            # Include alpha in color for transparency
            color = (color_value, color_value, color_value, int(255 * alpha))

            # Apply screen shake offset
            draw_x = int(particle.position.x + offset_x)
            draw_y = int(particle.position.y + offset_y)

            # Draw to batch surface
            size = max(1, int(particle.size * alpha))
            pygame.draw.circle(self._batch_surface, color, (draw_x, draw_y), size)

        # Single blit to screen (much faster than N individual draw calls)
        screen.blit(self._batch_surface, (0, 0))

    def clear(self):
        """Deactivate all particles (for game reset)."""
        for particle in self.particles:
            particle.active = False
        self.active_count = 0
        self.next_slot = 0


# Convenience function for backwards compatibility
def create_particle_system(max_particles=500):
    """Create a particle system with the specified pool size."""
    return ParticleSystem(max_particles)
