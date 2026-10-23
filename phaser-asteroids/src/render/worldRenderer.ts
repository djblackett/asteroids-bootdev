import type Phaser from 'phaser';
import { archetypeConfig, type Asteroid } from '../core/asteroid';
import { BOOST_FLASH_COUNT, BOOST_FLASH_PERIOD, BOOST_WARNING_TIME } from '../core/constants';
import { PICKUP_FLASH_DURATION, VOLATILE_FLASH_DURATION, type GameSim } from '../core/game';
import type { LaserBeam } from '../core/laser';
import { getForwardVector } from '../core/math';
import { shipTriangle, type PlayerState } from '../core/player';
import type { Starfield } from '../core/starfield';
import type { Ufo } from '../core/ufo';
import { rainbowColor, scaleColor } from './colors';
import { drawPowerUpIcon, POWERUP_COLOR } from './powerupIcons';

type Graphics = Phaser.GameObjects.Graphics;

const WHITE = 0xffffff;
const GREY_150 = 0x969696;
const RESPAWN_DIM = 0x646464;
const BOOST_MAGENTA = 0xff64ff;
const BOOST_FLASH_RED = 0xff0000;
const RAPID_YELLOW = 0xffff00;
const MULTI_ORANGE = 0xffa500;
const SHIELD_CYAN = 0x00ffff;
/** Two-player colours (the same hues as the HUD): ship outline when nothing special is on, centre dot, shots, laser beam. */
export const PLAYER_BASE_COLOR: readonly number[] = [0x64c8ff, 0xffc864];
const LASER_COLORS: ReadonlyArray<readonly [glow: number, beam: number]> = [
  [0x64c8ff, 0xc8f0ff],
  [0xffa040, 0xffe0b0],
];

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

/** True during the red flashes in the last moments of a boost; driven by the boost timer so there are exactly three. */
export function boostFlashRed(p: PlayerState): boolean {
  const t = p.boost.timer;
  return p.boost.active && t > 0 && t <= BOOST_FLASH_COUNT * BOOST_FLASH_PERIOD && t % BOOST_FLASH_PERIOD <= BOOST_FLASH_PERIOD / 2;
}

/**
 * Ship colour by state, in the same priority order as the Python `Player.draw`. `base` replaces the plain white of a
 * ship with nothing special active, which is how the two ships of a co-op game are told apart.
 */
export function shipColor(p: PlayerState, timeMs: number, base = WHITE): number {
  if (p.isRespawning) return Math.floor(timeMs / 100) % 2 === 0 ? RESPAWN_DIM : WHITE;
  if (p.megaPower.active) return rainbowColor(timeMs);
  if (p.boost.active) return boostFlashRed(p) ? BOOST_FLASH_RED : BOOST_MAGENTA;
  if (p.rapidFire.active) return RAPID_YELLOW;
  if (p.multiShot.active) return MULTI_ORANGE;
  return base;
}

function drawPlayer(g: Graphics, p: PlayerState, timeMs: number, coop: boolean): void {
  if (p.lives <= 0) return;

  const base = coop ? (PLAYER_BASE_COLOR[p.playerNumber - 1] ?? WHITE) : WHITE;
  const [nose, left, right] = shipTriangle(p);
  g.lineStyle(2, shipColor(p, timeMs, base), 1);
  g.strokeTriangle(nose.x, nose.y, left.x, left.y, right.x, right.y);
  if (coop) {
    // A dot in the player's colour stays visible whatever power-up colour the outline has.
    g.fillStyle(base, 1);
    g.fillCircle(p.position.x, p.position.y, 3);
  }

  if (p.boost.active) {
    // Three fading rings trailing behind the ship, and a pulsing warning ring in the last second.
    const back = getForwardVector(p.rotation + 180);
    g.lineStyle(1, BOOST_MAGENTA, 1);
    for (let i = 1; i <= 3; i++) {
      g.strokeCircle(p.position.x + back.x * p.radius * i * 0.5, p.position.y + back.y * p.radius * i * 0.5, Math.trunc(p.radius * (1 - i * 0.2)));
    }
    if (p.boost.timer <= BOOST_WARNING_TIME) {
      const pulse = Math.abs(((timeMs / 1000) * 8) % 2 - 1);
      g.lineStyle(pulse > 0.5 ? 2 : 3, boostFlashRed(p) ? BOOST_FLASH_RED : RAPID_YELLOW, 1);
      g.strokeCircle(p.position.x, p.position.y, Math.trunc(p.radius * (1.8 + 0.4 * pulse)));
    }
  }

  if (p.shieldActive) {
    const pulse = Math.abs((timeMs % 1000) - 500) / 500;
    g.lineStyle(2, SHIELD_CYAN, 1);
    g.strokeCircle(p.position.x, p.position.y, Math.trunc(p.radius * (1.5 + 0.3 * pulse)));
  }
}

const UFO_SHOT_RED = 0xff6464;
const UFO_LIGHT_ON = 0xffff00;
const UFO_LIGHT_OFF = 0x646400;
const UFO_LARGE_BRIGHT = 0x64ff64;
const UFO_LARGE_DIM = 0x32c832;
const UFO_SMALL_BRIGHT = 0xff64ff;
const UFO_SMALL_DIM = 0xc832c8;
/** Python draws large UFOs with 3 lights and small ones with 2, at 60 % of the radius. */
const UFO_LIGHTS: Record<Ufo['type'], number> = { large: 3, small: 2 };

const lighten = (color: number, by: number): number =>
  (Math.min(255, ((color >> 16) & 0xff) + by) << 16) | (Math.min(255, ((color >> 8) & 0xff) + by) << 8) | Math.min(255, (color & 0xff) + by);

/**
 * Python `UFO.draw`: a filled disc (green large / purple small, brighter on the blink), a lighter dome arc across its
 * upper half, a white outline and a few yellow lights that blink with it.
 */
function drawUfo(g: Graphics, u: Ufo): void {
  const { x, y } = u.position;
  const r = u.radius;
  const large = u.type === 'large';
  const body = large ? (u.blinkState ? UFO_LARGE_BRIGHT : UFO_LARGE_DIM) : u.blinkState ? UFO_SMALL_BRIGHT : UFO_SMALL_DIM;

  g.fillStyle(body, 1);
  g.fillCircle(x, y, r);

  // pygame's arc of the top half of a 2r x r box: the upper half of an ellipse r wide and r / 2 tall.
  g.lineStyle(3, lighten(body, 50), 1);
  g.beginPath();
  const segments = 16;
  for (let i = 0; i <= segments; i++) {
    const t = (Math.PI * i) / segments;
    const px = x + r * Math.cos(t);
    const py = y - r / 2 - (r / 2) * Math.sin(t);
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.strokePath();

  g.lineStyle(2, WHITE, 1);
  g.strokeCircle(x, y, r);

  g.fillStyle(u.blinkState ? UFO_LIGHT_ON : UFO_LIGHT_OFF, 1);
  const lights = UFO_LIGHTS[u.type];
  for (let i = 0; i < lights; i++) {
    const dir = getForwardVector((360 / lights) * i);
    g.fillCircle(x + dir.x * r * 0.6, y + dir.y * r * 0.6, 2);
  }
}

/** Glow, beam and core, each dimming to black as the beam's 0.3 s life runs out. In co-op Player 2's beam is orange. */
function drawLaser(g: Graphics, laser: LaserBeam, coop: boolean): void {
  const fade = Math.max(0, 1 - laser.timer / laser.lifetime);
  const { start, end } = laser;
  const [glow, beam] = LASER_COLORS[coop ? laser.owner - 1 : 0] ?? (LASER_COLORS[0] as readonly [number, number]);
  g.lineStyle(9, scaleColor(glow, fade), 1);
  g.lineBetween(start.x, start.y, end.x, end.y);
  g.lineStyle(3, scaleColor(beam, fade), 1);
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

  const coop = sim.players.length > 1;
  // In co-op each ship's shots wear its colour, so friendly fire is easy to read.
  for (const s of sim.shots) {
    if (!s.alive) continue;
    g.lineStyle(2, coop ? (PLAYER_BASE_COLOR[s.owner - 1] ?? WHITE) : WHITE, 1);
    g.strokeCircle(s.position.x, s.position.y, s.radius);
  }

  for (const u of sim.ufos) if (u.alive) drawUfo(g, u);
  // Enemy shots are bigger and reddish so they cannot be mistaken for the ship's white ones.
  g.lineStyle(2, UFO_SHOT_RED, 1);
  for (const s of sim.ufoShots) if (s.alive) g.strokeCircle(s.position.x, s.position.y, s.radius);

  for (const p of sim.players) drawPlayer(g, p, timeMs, coop);

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

  // A few procedural strokes per blast, with no textures, emitters or gameplay RNG.
  // Each source has its own ring; chain depth staggers/rotates the sparks for readable overlapping blasts.
  for (const flash of sim.volatileFlashes) {
    if (flash.age < 0) continue;
    const t = flash.age / VOLATILE_FLASH_DURATION;
    const fade = 1 - t;
    const { x, y } = flash.position;
    const radius = 8 + (flash.radius - 8) * (1 - fade * fade);
    g.lineStyle(5 * fade + 1, 0xff8a24, fade * 0.45);
    g.strokeCircle(x, y, radius);
    g.lineStyle(2, 0xffe477, fade);
    g.strokeCircle(x, y, radius * 0.94);
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6 + flash.depth * 0.7;
      const distance = (12 + 100 * t) * (0.7 + (i % 3) * 0.15);
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      g.lineStyle(2, i % 2 ? 0xffa52a : 0xffee99, fade * fade);
      g.lineBetween(x + dx * distance, y + dy * distance, x + dx * (distance + 9 * fade), y + dy * (distance + 9 * fade));
    }
  }

  if (!sim.isGameOver) for (const laser of sim.lasers) drawLaser(g, laser, coop);
}
