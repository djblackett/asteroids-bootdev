import { PARTICLE_DAMPING_PER_FRAME, PARTICLE_MAX, PARTICLE_SPEED } from './constants';
import { getForwardVector, rotateVec, timeNormalizedDamping, type Vec2 } from './math';
import { randint, uniform, type Rng } from './rng';

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

/**
 * Fixed-size particle pool (no per-frame allocation). When full, the oldest slot is recycled,
 * exactly like the Python `ParticleSystem`.
 */
export class ParticleSystem {
  readonly particles: Particle[];
  private nextSlot = 0;

  constructor(readonly capacity: number = PARTICLE_MAX) {
    this.particles = Array.from({ length: capacity }, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 0.5,
      size: 3,
    }));
  }

  get activeCount(): number {
    let n = 0;
    for (const p of this.particles) if (p.active) n++;
    return n;
  }

  /** Emits one particle travelling along `velocity`, with the original +/-30 degree scatter. */
  emit(x: number, y: number, velocity: Vec2, rng: Rng): void {
    const p = this.particles[this.nextSlot];
    if (!p) return;
    const v = rotateVec(velocity, uniform(rng, -30, 30));
    p.active = true;
    p.x = x;
    p.y = y;
    p.vx = v.x;
    p.vy = v.y;
    p.life = 0;
    p.maxLife = uniform(rng, 0.3, 0.5);
    p.size = randint(rng, 2, 4);
    this.nextSlot = (this.nextSlot + 1) % this.capacity;
  }

  update(dt: number): void {
    const damping = timeNormalizedDamping(PARTICLE_DAMPING_PER_FRAME, dt);
    for (const p of this.particles) {
      if (!p.active) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life += dt;
      p.vx *= damping;
      p.vy *= damping;
      if (p.life >= p.maxLife) p.active = false;
    }
  }

  clear(): void {
    for (const p of this.particles) p.active = false;
    this.nextSlot = 0;
  }
}

/** Radial burst (asteroid explosions): evenly spaced headings with +/-15 degree jitter. */
export function emitBurst(system: ParticleSystem, x: number, y: number, count: number, rng: Rng): void {
  for (let i = 0; i < count; i++) {
    const angle = (360 / count) * i + uniform(rng, -15, 15);
    const dir = getForwardVector(angle);
    system.emit(x, y, { x: dir.x * PARTICLE_SPEED, y: dir.y * PARTICLE_SPEED }, rng);
  }
}
