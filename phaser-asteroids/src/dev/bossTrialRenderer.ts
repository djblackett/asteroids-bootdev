import type Phaser from 'phaser';
import { BOSS_ATTACK, BOSS_HULL, type BossTrialSim } from './bossTrialSim';

/** One batched procedural hull, no textures, shaders, physics bodies or per-light objects. */
export function drawMothership(g: Phaser.GameObjects.Graphics, sim: BossTrialSim): void {
  g.clear();
  const b = sim.boss;
  const { x, y } = b.position;
  const pulse = (Math.sin(b.age * 5) + 1) / 2;
  const dying = b.phase === 'dying';
  const flicker = !dying || Math.floor(b.deathTime * 19) % 3 !== 0;
  const polygon = (coords: readonly number[], fill: number, outline: number, width = 2): void => {
    const points = [];
    for (let i = 0; i < coords.length; i += 2) points.push({ x: x + coords[i]!, y: y + coords[i + 1]! });
    g.fillStyle(fill, 1);
    g.beginPath().moveTo(points[0]!.x, points[0]!.y);
    for (const p of points.slice(1)) g.lineTo(p.x, p.y);
    g.closePath().fillPath();
    g.lineStyle(width, outline, 1).strokePath();
  };
  if (b.phase !== 'warning' && b.phase !== 'destroyed') {
    // Small aft engines above the massive shoulders. Layered triangles suggest exhaust without particles.
    for (const side of [-1, 1]) {
      g.fillStyle(0x6133c9, 0.22).fillTriangle(x + side * 75 - 16, y - 38, x + side * 75 + 16, y - 38, x + side * 75, y - 76 - pulse * 12);
      g.fillStyle(0x61e5ff, flicker ? 0.7 : 0.08).fillRect(x + side * 75 - 9, y - 44, 18, 6);
    }
    const hull = BOSS_HULL.map((p) => ({ x: x + p.x, y: y + p.y }));
    g.beginPath().moveTo(hull[0]!.x, hull[0]!.y);
    for (const p of hull.slice(1)) g.lineTo(p.x, p.y);
    g.closePath();
    g.lineStyle(9, 0x6e42c9, 0.13).strokePath();
    g.fillStyle(0x111727, 1).fillPath();
    g.lineStyle(2.5, flicker ? 0x62cfe4 : 0x462945, 1).strokePath();
    // Mirrored armored wing plates and red forward-facing vents make a capital-ship silhouette.
    for (const side of [-1, 1]) {
      polygon([side * 36, -34, side * 111, -37, side * 152, -9, side * 140, 28, side * 85, 39, side * 53, 20], 0x20273c, 0x8054b9);
      polygon([side * 51, -23, side * 103, -27, side * 129, -8, side * 81, 3], 0x2a3048, 0x3c6480, 1);
      g.lineStyle(3, 0xf44375, flicker ? 0.85 : 0.1);
      g.lineBetween(x + side * 145, y + 12, x + side * 135, y + 29);
      for (let i = 0; i < 4; i++) {
        g.fillStyle(i === Math.floor(b.age * 3) % 4 ? 0xaefaff : 0x376781, flicker ? 1 : 0.1);
        g.fillRect(x + side * (62 + i * 17) - 2, y - 13, 4, 3);
      }
    }
    polygon([0, -57, 27, -34, 35, 34, 0, 61, -35, 34, -27, -34], 0x28213e, 0xd05a9e);
    // Bridge above the reactor.
    polygon([-15, -36, 15, -36, 20, -24, -20, -24], 0x15384b, flicker ? 0x88eeff : 0x324858, 1);

    for (const s of [b.left, b.right]) {
      const sx = s.position.x;
      const sy = s.position.y;
      if (s.hp > 0) {
        if (b.phase === 'fighting' && !sim.isGameOver && b.charge?.turret === s.id) {
          const progress = Math.min(1, b.charge.elapsed / BOSS_ATTACK.chargeSeconds);
          const chargePulse = (Math.sin(progress * Math.PI * 6) + 1) / 2;
          // Amber halo and bright muzzle identify the sole charging turret for the full warning second.
          g.fillStyle(0xffbe55, 0.2 + progress * 0.15 + chargePulse * 0.15).fillCircle(sx, sy, s.radius + 9 + chargePulse * 5);
          g.lineStyle(3, 0xffdc83, 0.65 + chargePulse * 0.35).strokeCircle(sx, sy, s.radius + 6);
          g.fillStyle(0xffdf8c, 0.65 + chargePulse * 0.35).fillCircle(sx, sy + 24, 10 + progress * 4);
        }
        // Visible circle = damage circle. The barrel is decoration outside the hit area.
        g.fillStyle(0x080e1b, 1).fillCircle(sx, sy, s.radius);
        g.lineStyle(3, s.hitFlash > 0 ? 0xffffff : 0xc277eb, 1).strokeCircle(sx, sy, s.radius);
        g.fillStyle(s.hitFlash > 0 ? 0xffe9ff : 0x623951, 1).fillRect(sx - 9, sy - 11, 18, 29);
        g.lineStyle(2, 0xff587a, 1).strokeRect(sx - 9, sy - 11, 18, 29);
        g.fillStyle(0x202b40, 1).fillRect(sx - 6, sy + 18, 12, 10);
        if (s.muzzleFlash > 0) {
          g.fillStyle(0xff6a40, s.muzzleFlash / 0.2).fillCircle(sx, sy + 24, 18);
          g.fillStyle(0xffef9a, 1).fillCircle(sx, sy + 24, 7);
        }
      } else {
        g.fillStyle(0x05070f, 1).fillCircle(sx, sy, s.radius);
        g.lineStyle(2, 0x6b465b, 1).strokeCircle(sx, sy, s.radius);
        g.lineStyle(2, 0xc86549, 0.65);
        g.lineBetween(sx - 17, sy - 10, sx + 8, sy + 15);
        g.lineBetween(sx + 15, sy - 8, sx - 7, sy + 14);
        const age = b.age - (s.destroyedAt ?? b.age);
        if (age < 0.8) {
          for (let i = 0; i < 5; i++) {
            const angle = i * Math.PI * 2 / 5;
            const dx = Math.cos(angle) * age * 65;
            const dy = Math.sin(angle) * age * 65 + age * age * 30;
            g.fillStyle(0xc295ab, 1 - age / 0.8).fillTriangle(sx + dx, sy + dy, sx + dx + 9, sy + dy + 2, sx + dx + 2, sy + dy + 9);
          }
        }
      }
    }
    const c = b.core.position;
    const coreColor = b.core.hitFlash > 0 ? 0xffffff : b.exposed ? 0xff4a98 : 0x5c9ed5;
    g.fillStyle(coreColor, (b.exposed ? 0.17 + pulse * 0.12 : 0.07) * (flicker ? 1 : 0.1)).fillCircle(c.x, c.y, b.exposed ? 42 : 31);
    g.fillStyle(0x0a1123, 1).fillCircle(c.x, c.y, 26);
    g.lineStyle(b.exposed ? 3 : 2, coreColor, flicker ? 1 : 0.2).strokeCircle(c.x, c.y, 26);
    g.fillStyle(coreColor, flicker ? 0.7 + pulse * 0.3 : 0.08).fillCircle(c.x, c.y, b.exposed ? 18 + pulse * 3 : 13);
    g.fillStyle(0xffffff, b.exposed && flicker ? 0.8 : 0.2).fillCircle(c.x, c.y, 7);
    if (!b.exposed) {
      g.lineStyle(4, 0x7195b9, 0.9);
      g.lineBetween(c.x - 20, c.y - 17, c.x + 20, c.y + 17);
      g.lineBetween(c.x + 20, c.y - 17, c.x - 20, c.y + 17);
    }
  }
  for (const flash of sim.bossFlashes) {
    const life = 1 - flash.age / 0.65;
    const radius = flash.radius * (0.2 + flash.age * 2);
    const p = flash.position;
    g.fillStyle(flash.color, life * 0.18).fillCircle(p.x, p.y, radius);
    g.lineStyle(2 + life * 2, flash.color, life).strokeCircle(p.x, p.y, radius);
    g.fillStyle(0xfff0d0, life).fillCircle(p.x, p.y, Math.max(1, radius * life * 0.24));
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      g.lineStyle(2, flash.color, life);
      g.lineBetween(p.x + Math.cos(angle) * radius * 0.7, p.y + Math.sin(angle) * radius * 0.7,
        p.x + Math.cos(angle) * radius, p.y + Math.sin(angle) * radius);
    }
  }
  // Larger bright enemy shots retain the existing world's inner projectile and damage logic.
  for (const shot of sim.ufoShots) {
    g.fillStyle(0xff523c, 0.17).fillCircle(shot.position.x, shot.position.y, 15);
    g.lineStyle(2, 0xffd17c, 0.9).strokeCircle(shot.position.x, shot.position.y, shot.radius);
  }
}
