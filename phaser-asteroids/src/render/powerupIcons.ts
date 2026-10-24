import type Phaser from 'phaser';
import { getForwardVector } from '../core/math';
import type { PowerUpType } from '../core/powerup';
import { rainbowColor } from './colors';

type Graphics = Phaser.GameObjects.Graphics;

/** Base colour of each pick-up (MEGA POWER cycles through the rainbow instead). */
export const POWERUP_COLOR: Record<PowerUpType, number> = {
  rapid_fire: 0xffff00,
  shield: 0x00ffff,
  multi_shot: 0xffa500,
  slow_motion: 0xff00ff,
  chain_lightning: 0x39cfff,
  mega_power: 0xff64ff,
  revive: 0x00ff64,
};

const point = (cx: number, cy: number, degrees: number, distance: number) => {
  const d = getForwardVector(degrees);
  return { x: cx + d.x * distance, y: cy + d.y * distance };
};

/**
 * Procedural pick-up icons, ported from the Python `PowerUp.draw`. `baseRadius` is the collision radius
 * (15); the icon pulses between 0.8x and 1.2x of it.
 */
export function drawPowerUpIcon(
  g: Graphics,
  type: PowerUpType,
  cx: number,
  cy: number,
  baseRadius: number,
  timeMs: number,
  lifetimeLeft = Infinity,
): void {
  const pulse = Math.abs((timeMs % 1000) - 500) / 500;
  const radius = Math.trunc(baseRadius * (0.8 + 0.4 * pulse));

  switch (type) {
    case 'chain_lightning': {
      g.lineStyle(1.5, POWERUP_COLOR.chain_lightning, 0.7);
      g.strokeCircle(cx, cy, radius);
      g.fillStyle(POWERUP_COLOR.chain_lightning, 1);
      g.beginPath();
      g.moveTo(cx + radius * 0.45, cy - radius * 0.95);
      g.lineTo(cx - radius * 0.6, cy + radius * 0.12);
      g.lineTo(cx - radius * 0.05, cy + radius * 0.12);
      g.lineTo(cx - radius * 0.4, cy + radius * 0.95);
      g.lineTo(cx + radius * 0.65, cy - radius * 0.2);
      g.lineTo(cx + radius * 0.1, cy - radius * 0.2);
      g.closePath();
      g.fillPath();
      break;
    }
    case 'rapid_fire': {
      const color = POWERUP_COLOR.rapid_fire;
      g.lineStyle(3, color, 1);
      g.lineBetween(cx, cy - radius, cx, cy + radius);
      g.lineBetween(cx - radius, cy, cx + radius, cy);
      const o = Math.trunc(radius * 0.7);
      g.lineStyle(2, color, 1);
      g.lineBetween(cx - o, cy - o, cx + o, cy + o);
      g.lineBetween(cx + o, cy - o, cx - o, cy + o);
      g.strokeCircle(cx, cy, radius);
      break;
    }
    case 'shield': {
      const color = POWERUP_COLOR.shield;
      g.lineStyle(3, color, 1);
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const p = point(cx, cy, 60 * i, radius);
        if (i === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
      }
      g.closePath();
      g.strokePath();
      g.lineStyle(2, color, 1);
      g.strokeCircle(cx, cy, Math.trunc(radius * 0.5));
      break;
    }
    case 'multi_shot': {
      const color = POWERUP_COLOR.multi_shot;
      g.lineStyle(2, color, 1);
      for (const offset of [-20, 0, 20]) {
        const tip = point(cx, cy, 90 + offset, radius);
        g.lineBetween(cx, cy, tip.x, tip.y);
        const head = radius * 0.4;
        const left = point(tip.x, tip.y, 90 + offset - 150, head);
        const right = point(tip.x, tip.y, 90 + offset + 150, head);
        g.lineBetween(tip.x, tip.y, left.x, left.y);
        g.lineBetween(tip.x, tip.y, right.x, right.y);
      }
      break;
    }
    case 'slow_motion': {
      const color = POWERUP_COLOR.slow_motion;
      g.lineStyle(3, color, 1);
      g.strokeCircle(cx, cy, radius);
      const hour = point(cx, cy, (timeMs / 20) % 360, radius * 0.5);
      g.lineBetween(cx, cy, hour.x, hour.y);
      const minute = point(cx, cy, (timeMs / 5) % 360, radius * 0.8);
      g.lineStyle(2, color, 1);
      g.lineBetween(cx, cy, minute.x, minute.y);
      break;
    }
    case 'mega_power': {
      const colors = [rainbowColor(timeMs), rainbowColor(timeMs, 120), rainbowColor(timeMs, 240)] as const;
      const rotation = (timeMs / 10) % 360;
      for (let i = 0; i < 8; i++) {
        const p = point(cx, cy, rotation + i * 45, radius * 1.2);
        g.lineStyle(3, colors[i % 3] ?? colors[0], 1);
        g.lineBetween(cx, cy, p.x, p.y);
      }
      const circle = Math.trunc(radius * (1.0 + 0.5 * pulse));
      g.lineStyle(3, colors[0], 1);
      g.strokeCircle(cx, cy, circle);
      g.lineStyle(2, colors[1], 1);
      g.strokeCircle(cx, cy, Math.trunc(circle * 0.7));
      g.lineStyle(2, colors[2], 1);
      g.strokeCircle(cx, cy, Math.trunc(circle * 0.4));
      break;
    }
    case 'revive': {
      // Blinks white when about to expire.
      const blinking = lifetimeLeft <= 3 && Math.trunc((timeMs / 1000) * 3) % 2 === 0;
      const color = blinking ? 0xffffff : POWERUP_COLOR.revive;
      const width = radius * 0.4;
      const length = radius * 1.2;
      g.fillStyle(color, 1);
      g.fillRect(cx - width / 2, cy - length / 2, width, length);
      g.fillRect(cx - length / 2, cy - width / 2, length, width);
      g.lineStyle(2, color, 1);
      g.strokeCircle(cx, cy, radius);
      break;
    }
  }
}
