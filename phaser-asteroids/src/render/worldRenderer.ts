import type Phaser from 'phaser';
import { archetypeConfig, type Asteroid } from '../core/asteroid';
import type { GameSim } from '../core/game';
import { shipTriangle } from '../core/player';
import type { Starfield } from '../core/starfield';

type Graphics = Phaser.GameObjects.Graphics;

const WHITE = 0xffffff;
const GREY_150 = 0x969696;
const RESPAWN_DIM = 0x646464;

/**
 * Everything is drawn procedurally into two Graphics objects that are cleared and refilled each
 * frame (one for the starfield, one for the playfield). That is a handful of GPU batches in total,
 * instead of one game object per asteroid/shot/particle.
 */

export function drawStarfield(g: Graphics, starfield: Starfield): void {
  g.clear();
  for (const star of starfield.stars) {
    const { x, y } = starfield.project(star);
    const b = star.brightness;
    g.fillStyle((b << 16) | (b << 8) | b, 1);
    if (star.size <= 1) g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    else g.fillCircle(x, y, star.size);
  }
  g.fillStyle(WHITE, 1);
}

function asteroidColor(a: Asteroid): number {
  if (a.dying) return Math.floor(a.deathTimer * 30) % 2 === 1 ? WHITE : GREY_150;
  if (a.hitFlashTimer > 0) return WHITE;
  return archetypeConfig(a).color;
}

function drawAsteroid(g: Graphics, a: Asteroid): void {
  const color = asteroidColor(a);
  const x = a.position.x + a.shakeOffset.x;
  const y = a.position.y + a.shakeOffset.y;
  g.lineStyle(archetypeConfig(a).outlineWidth, color, 1);
  g.strokeCircle(x, y, a.radius);
  if (a.archetype === 'armored') {
    g.lineStyle(a.hitPoints < a.maxHitPoints ? 2 : 1, color, 1);
    g.strokeCircle(x, y, Math.max(a.radius - 8, 6));
  }
}

function drawPlayer(g: Graphics, sim: GameSim, timeMs: number): void {
  const p = sim.player;
  if (p.lives <= 0) return;
  let color = WHITE;
  if (p.isRespawning) color = Math.floor(timeMs / 100) % 2 === 0 ? RESPAWN_DIM : WHITE;
  const [nose, left, right] = shipTriangle(p);
  g.lineStyle(2, color, 1);
  g.strokeTriangle(nose.x, nose.y, left.x, left.y, right.x, right.y);
}

/** Redraws asteroids, shots, ship and particles. Shake is applied by the caller via the object's position. */
export function drawWorld(g: Graphics, sim: GameSim, timeMs: number): void {
  g.clear();

  for (const a of sim.asteroids) if (a.alive) drawAsteroid(g, a);

  g.lineStyle(2, WHITE, 1);
  for (const s of sim.shots) if (s.alive) g.strokeCircle(s.position.x, s.position.y, s.radius);

  drawPlayer(g, sim, timeMs);

  for (const p of sim.particles.particles) {
    if (!p.active) continue;
    const fade = 1 - p.life / p.maxLife;
    // The original blends a grey that is already scaled by alpha, which fades roughly with alpha squared.
    g.fillStyle(WHITE, fade * fade);
    g.fillCircle(p.x, p.y, Math.max(1, p.size * fade));
  }
}
