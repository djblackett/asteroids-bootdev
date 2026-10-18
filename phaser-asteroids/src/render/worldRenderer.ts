import type Phaser from 'phaser';
import { archetypeConfig, type Asteroid } from '../core/asteroid';
import { BOOST_WARNING_TIME } from '../core/constants';
import { PICKUP_FLASH_DURATION, type GameSim } from '../core/game';
import type { LaserBeam } from '../core/laser';
import { getForwardVector } from '../core/math';
import { shipTriangle, type PlayerState } from '../core/player';
import type { Starfield } from '../core/starfield';
import { rainbowColor, scaleColor } from './colors';
import { drawPowerUpIcon, POWERUP_COLOR } from './powerupIcons';

type Graphics = Phaser.GameObjects.Graphics;

const WHITE = 0xffffff;
const GREY_150 = 0x969696;
const RESPAWN_DIM = 0x646464;
const BOOST_MAGENTA = 0xff64ff;
const RAPID_YELLOW = 0xffff00;
const MULTI_ORANGE = 0xffa500;
const SHIELD_CYAN = 0x00ffff;

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

/** Ship colour by state, in the same priority order as the Python `Player.draw`. */
export function shipColor(p: PlayerState, timeMs: number): number {
  if (p.isRespawning) return Math.floor(timeMs / 100) % 2 === 0 ? RESPAWN_DIM : WHITE;
  if (p.megaPower.active) return rainbowColor(timeMs);
  if (p.boost.active) return BOOST_MAGENTA;
  if (p.rapidFire.active) return RAPID_YELLOW;
  if (p.multiShot.active) return MULTI_ORANGE;
  return WHITE;
}

function drawPlayer(g: Graphics, sim: GameSim, timeMs: number): void {
  const p = sim.player;
  if (p.lives <= 0) return;

  const [nose, left, right] = shipTriangle(p);
  g.lineStyle(2, shipColor(p, timeMs), 1);
  g.strokeTriangle(nose.x, nose.y, left.x, left.y, right.x, right.y);

  if (p.boost.active) {
    // Three fading rings trailing behind the ship, and a pulsing warning ring in the last second.
    const back = getForwardVector(p.rotation + 180);
    g.lineStyle(1, BOOST_MAGENTA, 1);
    for (let i = 1; i <= 3; i++) {
      g.strokeCircle(p.position.x + back.x * p.radius * i * 0.5, p.position.y + back.y * p.radius * i * 0.5, Math.trunc(p.radius * (1 - i * 0.2)));
    }
    if (p.boost.timer <= BOOST_WARNING_TIME) {
      const pulse = Math.abs(((timeMs / 1000) * 8) % 2 - 1);
      g.lineStyle(pulse > 0.5 ? 2 : 3, RAPID_YELLOW, 1);
      g.strokeCircle(p.position.x, p.position.y, Math.trunc(p.radius * (1.8 + 0.4 * pulse)));
    }
  }

  if (p.shieldActive) {
    const pulse = Math.abs((timeMs % 1000) - 500) / 500;
    g.lineStyle(2, SHIELD_CYAN, 1);
    g.strokeCircle(p.position.x, p.position.y, Math.trunc(p.radius * (1.5 + 0.3 * pulse)));
  }
}

/** Glow, beam and core, each dimming to black as the beam's 0.3 s life runs out. */
function drawLaser(g: Graphics, laser: LaserBeam): void {
  const fade = Math.max(0, 1 - laser.timer / laser.lifetime);
  const { start, end } = laser;
  g.lineStyle(9, scaleColor(0x64c8ff, fade), 1);
  g.lineBetween(start.x, start.y, end.x, end.y);
  g.lineStyle(3, scaleColor(0xc8f0ff, fade), 1);
  g.lineBetween(start.x, start.y, end.x, end.y);
  g.lineStyle(1, scaleColor(0xffffff, fade), 1);
  g.lineBetween(start.x, start.y, end.x, end.y);
}

/** Redraws everything in the playfield. Shake is applied by the caller via the object's position. */
export function drawWorld(g: Graphics, sim: GameSim, timeMs: number): void {
  g.clear();

  for (const a of sim.asteroids) if (a.alive) drawAsteroid(g, a);

  for (const p of sim.powerups) {
    if (p.alive) drawPowerUpIcon(g, p.type, p.position.x, p.position.y, p.radius, timeMs, p.lifetime);
  }

  g.lineStyle(2, WHITE, 1);
  for (const s of sim.shots) if (s.alive) g.strokeCircle(s.position.x, s.position.y, s.radius);

  drawPlayer(g, sim, timeMs);

  for (const flash of sim.pickupFlashes) {
    const t = flash.age / PICKUP_FLASH_DURATION;
    const color = flash.type === 'mega_power' ? rainbowColor(timeMs) : POWERUP_COLOR[flash.type];
    g.lineStyle(2, color, 1 - t);
    g.strokeCircle(flash.position.x, flash.position.y, 15 + 35 * t);
  }

  for (const p of sim.particles.particles) {
    if (!p.active) continue;
    const fade = 1 - p.life / p.maxLife;
    // The original blends a grey that is already scaled by alpha, which fades roughly with alpha squared.
    g.fillStyle(WHITE, fade * fade);
    g.fillCircle(p.x, p.y, Math.max(1, p.size * fade));
  }

  if (!sim.isGameOver) for (const laser of sim.lasers) drawLaser(g, laser);
}
