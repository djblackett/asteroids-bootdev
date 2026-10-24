import type Phaser from 'phaser';
import { laserEndPosition } from '../core/laser';
import { BOSS_ATTACK, BOSS_HULL, bossBeamSegment, type BossTrialSim } from './bossTrialSim';
import { BOSS_CINEMATIC as C } from './bossCinematic';

/** One batched procedural hull, no textures, shaders, physics bodies or per-light objects. */
export function drawMothership(g: Phaser.GameObjects.Graphics, sim: BossTrialSim, reducedMotion = false): void {
  g.clear();
  const b = sim.boss;
  const { x, y } = b.position;
  const pulse = reducedMotion ? 0.5 : (Math.sin(b.age * 5) + 1) / 2;
  const dying = b.phase === 'dying';
  const flicker = !dying || (reducedMotion ? false : Math.floor(b.deathTime * 9) % 3 !== 0);
  const entering = b.phase === 'entering';
  const enginesOn = !entering || b.age >= 2;
  const turretsOn = !entering || b.age >= 8;
  const reactorOn = b.age >= 13;
  const polygon = (coords: readonly number[], fill: number, outline: number, width = 2): void => {
    const points = [];
    for (let i = 0; i < coords.length; i += 2) points.push({ x: x + coords[i]!, y: y + coords[i + 1]! });
    g.fillStyle(fill, 1);
    g.beginPath().moveTo(points[0]!.x, points[0]!.y);
    for (const p of points.slice(1)) g.lineTo(p.x, p.y);
    g.closePath().fillPath();
    g.lineStyle(width, outline, 1).strokePath();
  };
  if (b.phase !== 'warning' && b.phase !== 'destroyed' && !b.detonated) {
    // Small aft engines above the massive shoulders. Layered triangles suggest exhaust without particles.
    for (const side of [-1, 1]) {
      if (!enginesOn) continue;
      g.fillStyle(0x6133c9, 0.22).fillTriangle(x + side * 75 - 16, y - 38, x + side * 75 + 16, y - 38, x + side * 75, y - 76 - pulse * 12);
      g.fillStyle(0x61e5ff, flicker ? 0.7 : 0.08).fillRect(x + side * 75 - 9, y - 44, 18, 6);
    }
    const hull = BOSS_HULL.map((p) => ({ x: x + p.x, y: y + p.y }));
    g.beginPath().moveTo(hull[0]!.x, hull[0]!.y);
    for (const p of hull.slice(1)) g.lineTo(p.x, p.y);
    g.closePath();
    g.lineStyle(9, 0x6e42c9, 0.13).strokePath();
    g.fillStyle(0x111727, 1).fillPath();
    g.lineStyle(2.5, flicker ? (b.exposed ? 0xff536f : 0x62cfe4) : 0x462945, 1).strokePath();
    // Mirrored armored wing plates and red forward-facing vents make a capital-ship silhouette.
    for (const side of [-1, 1]) {
      polygon([side * 36, -34, side * 111, -37, side * 152, -9, side * 140, 28, side * 85, 39, side * 53, 20], 0x20273c, 0x8054b9);
      polygon([side * 51, -23, side * 103, -27, side * 129, -8, side * 81, 3], 0x2a3048, 0x3c6480, 1);
      g.lineStyle(3, 0xf44375, flicker ? 0.85 : 0.1);
      g.lineBetween(x + side * 145, y + 12, x + side * 135, y + 29);
      for (let i = 0; i < 4; i++) {
        g.fillStyle(b.exposed ? (i === Math.floor(b.age * 3) % 4 ? 0xffbd90 : 0xa73856) : (i === Math.floor(b.age * 3) % 4 ? 0xaefaff : 0x376781), flicker ? 1 : 0.1);
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
          const progress = Math.min(1, b.charge.elapsed / b.charge.duration);
          const chargePulse = (Math.sin(progress * Math.PI * 6) + 1) / 2;
          const color = b.charge.kind === 'beam' ? 0xee64ff : 0xffbe55;
          g.fillStyle(color, 0.2 + progress * 0.15 + chargePulse * 0.15).fillCircle(sx, sy, s.radius + 9 + chargePulse * 5);
          g.lineStyle(3, color, 0.65 + chargePulse * 0.35).strokeCircle(sx, sy, s.radius + 6);
          g.fillStyle(color, 0.65 + chargePulse * 0.35).fillCircle(sx, sy + 24, 10 + progress * 4);
        }
        // Visible circle = damage circle. The barrel is decoration outside the hit area.
        const weaponColor = turretsOn ? (s.id === 'left' ? 0xffa269 : 0xdb82ef) : 0x354052;
        g.fillStyle(0x080e1b, 1).fillCircle(sx, sy, s.radius);
        g.lineStyle(3, s.hitFlash > 0 ? 0xffffff : weaponColor, 1).strokeCircle(sx, sy, s.radius);
        g.fillStyle(s.hitFlash > 0 ? 0xffe9ff : 0x623951, 1).fillRect(sx - 9, sy - 11, 18, 29);
        g.lineStyle(2, weaponColor, 1).strokeRect(sx - 9, sy - 11, 18, 29);
        g.fillStyle(0x202b40, 1).fillRect(sx - 6, sy + 18, 12, 10);
        if (s.id === 'right') g.lineStyle(2, weaponColor, 0.9).strokeCircle(sx, sy + 23, 7);
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
    const coreColor = !reactorOn ? 0x293449 : b.core.hitFlash > 0 ? 0xffffff : b.exposed ? 0xff4a98 : 0x5c9ed5;
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
    if (dying) {
      // Bright faults crawl along hull seams before the silhouette ruptures.
      g.lineStyle(2, 0xffae76, reducedMotion ? 0.4 : flicker ? 0.85 : 0.2);
      for (let i = 0; i < Math.min(7, Math.floor(b.deathTime * 4)); i++) {
        const p = BOSS_HULL[(i * 2 + 1) % BOSS_HULL.length]!;
        g.lineBetween(x, y + 20, x + p.x, y + p.y);
      }
    }
  }
  drawDestruction(g, sim, reducedMotion);
  if (b.phase === 'fighting' && !sim.isGameOver) {
    const charge = b.charge;
    if (charge && b[charge.turret].hp > 0) {
      const p = charge.origin;
      const ray = (angle: number, color: number, alpha: number): void => {
        const end = laserEndPosition(p, angle * 180 / Math.PI - 90);
        g.lineStyle(1.5, color, alpha).lineBetween(p.x, p.y, end.x, end.y);
      };
      if (charge.kind === 'pulse') {
        const progress = charge.elapsed / charge.duration;
        g.fillStyle(0xffa8df, 0.12 + progress * 0.16).fillCircle(p.x, p.y, 38 + progress * 18);
        g.lineStyle(3, 0xffb4eb, 0.9).strokeCircle(p.x, p.y, 58 - progress * 25);
        // Six short spokes show the fixed pattern; gaps stay unlit and safe.
        for (let i = 0; i < BOSS_ATTACK.pulseCount; i++) {
          const angle = i * Math.PI * 2 / BOSS_ATTACK.pulseCount;
          g.lineStyle(2, 0xffb4eb, 0.6).lineBetween(p.x + Math.cos(angle) * 30, p.y + Math.sin(angle) * 30,
            p.x + Math.cos(angle) * 95, p.y + Math.sin(angle) * 95);
        }
      } else if (charge.kind === 'beam') {
        ray(charge.angle, 0xff80ee, 0.85);
        ray(charge.angle + charge.sweep * BOSS_ATTACK.beamArcRadians, 0xdd66ff, 0.3);
        // A persistent curved arrow shows the full sweep direction throughout charging.
        const radius = 145;
        const endAngle = charge.angle + charge.sweep * BOSS_ATTACK.beamArcRadians;
        g.lineStyle(3, 0xff80ee, 0.9);
        for (let i = 0; i < 16; i++) {
          const a = charge.angle + charge.sweep * BOSS_ATTACK.beamArcRadians * i / 16;
          const c = charge.angle + charge.sweep * BOSS_ATTACK.beamArcRadians * (i + 1) / 16;
          g.lineBetween(p.x + Math.cos(a) * radius, p.y + Math.sin(a) * radius, p.x + Math.cos(c) * radius, p.y + Math.sin(c) * radius);
        }
        const tip = { x: p.x + Math.cos(endAngle) * radius, y: p.y + Math.sin(endAngle) * radius };
        const tangent = endAngle + charge.sweep * Math.PI / 2;
        for (const side of [-1, 1]) g.lineBetween(tip.x, tip.y, tip.x - Math.cos(tangent) * 13 + Math.cos(endAngle) * side * 8,
          tip.y - Math.sin(tangent) * 13 + Math.sin(endAngle) * side * 8);
      } else {
        ray(charge.angle, 0xffbf72, 0.4);
        if (charge.kind === 'spread') for (const side of [-1, 1]) ray(charge.angle + side * BOSS_ATTACK.spreadRadians, 0xff8752, 0.4);
      }
    }
    if (b.beam && b.right.hp > 0) {
      const { start, end } = bossBeamSegment(b.beam);
      for (const [width, color, alpha] of [[30, 0xbd33ff, 0.12], [18, 0xe65eff, 0.3], [BOSS_ATTACK.beamWidth, 0xff58d8, 0.95], [3, 0xffedff, 1]]) {
        g.lineStyle(width!, color!, alpha!).lineBetween(start.x, start.y, end.x, end.y);
      }
      g.fillStyle(0xffc4fa, 0.9).fillCircle(start.x, start.y, 13);
    }
  }
  for (const flash of sim.bossFlashes) {
    if (reducedMotion || flash.radius === 200) continue;
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
  for (const [shot, state] of sim.bossProjectiles) {
    const kind = state.kind;
    const color = kind === 'pulse' ? 0xffa4eb : kind === 'spread' ? 0xff8c42 : 0xff523c;
    const alpha = Math.min(1, state.remaining / 0.3);
    g.fillStyle(color, 0.2 * alpha).fillCircle(shot.position.x, shot.position.y, 15);
    g.fillStyle(color, alpha).fillCircle(shot.position.x, shot.position.y, shot.radius);
    g.fillStyle(0xfff1de, alpha).fillCircle(shot.position.x, shot.position.y, 3);
    g.lineStyle(2, kind === 'pulse' ? 0xffd5fc : 0xffd17c, 0.9 * alpha).strokeCircle(shot.position.x, shot.position.y, shot.radius);
  }
}

/** Fixed-size geometry, derived from the death clock: no particles, timers or retained objects. */
function drawDestruction(g: Phaser.GameObjects.Graphics, sim: BossTrialSim, reducedMotion: boolean): void {
  const b = sim.boss;
  if (sim.ordinaryPlay || (b.phase !== 'dying' && b.phase !== 'destroyed')) return;
  const { x, y } = b.position;
  const t = b.deathTime - C.detonation;
  if (t >= 0) {
    const life = Math.max(0, 1 - t / 2.8);
    if (reducedMotion) {
      g.lineStyle(2, 0xc07883, life * 0.5).strokeEllipse(x, y, 300, 110);
      return;
    }
    // Two shock fronts, a short white-hot centre, then a slower amber fireball.
    for (const delay of [0, 0.18]) {
      const age = t - delay;
      if (age < 0 || age > 1.7) continue;
      g.lineStyle(5 * (1 - age / 1.7), delay ? 0xff669d : 0xffd7b4, (1 - age / 1.7) * 0.75)
        .strokeCircle(x, y, 25 + age * 270);
    }
    const fire = Math.max(0, 1 - t / 1.2);
    g.fillStyle(0xff5176, fire * 0.12).fillCircle(x, y, 110 + t * 80);
    g.fillStyle(0xffb866, fire * 0.45).fillCircle(x, y, 55 + t * 45);
    g.fillStyle(0xfff3db, Math.max(0, 1 - t / 0.35) * 0.9).fillCircle(x, y, 45 + t * 130);
    // Hull-colored shards retain the mothership's wing shapes as they separate.
    for (let i = 0; i < 56; i++) {
      const angle = i * 2.39996;
      const hull = BOSS_HULL[i % BOSS_HULL.length]!;
      const speed = 48 + i % 9 * 17;
      const px = x + hull.x * 0.65 + Math.cos(angle) * t * speed;
      const py = y + hull.y * 0.65 + Math.sin(angle) * t * speed + t * t * 24;
      const size = i < 14 ? 12 + i % 4 * 4 : 3 + i % 5;
      g.fillStyle(i < 14 ? 0x343047 : i % 2 ? 0xffa475 : 0xc3afd8, life)
        .fillTriangle(px, py, px + Math.cos(angle + t) * size, py + Math.sin(angle + t) * size, px - size * 0.4, py + size * 0.65);
      if (i < 14) g.lineStyle(1, 0xf16c95, life * 0.7).lineBetween(px, py, px - size * 0.4, py + size * 0.65);
    }
  } else if (!reducedMotion && b.deathTime >= C.failure) {
    // Local panel fragments and sparks accompany each of the ten staggered internal explosions.
    for (let n = 0; n < b.explosionCount; n++) {
      const age = b.deathTime - C.failure - n * 0.18;
      if (age > 0.8) continue;
      const ox = x + Math.sin(n * 2.4) * 138;
      const oy = y + Math.cos(n * 3.1) * 36;
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 + n;
        const px = ox + Math.cos(a) * age * 100;
        const py = oy + Math.sin(a) * age * 100 + age * age * 40;
        g.fillStyle(i % 2 ? 0xffb267 : 0x9b7895, 1 - age / 0.8).fillRect(px, py, 3 + i % 3 * 2, 3);
      }
    }
  }
}
