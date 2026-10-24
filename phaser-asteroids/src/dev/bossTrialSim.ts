// This entire simulation is reached only through GameScene's DEV-only, unrecorded trial import.
import { MAX_FRAME_DT, SCREEN_WIDTH } from '../core/constants';
import { GameSim, type SimEvent } from '../core/game';
import type { GameConfig } from '../core/gameConfig';
import { distanceToBeam, laserHits } from '../core/laser';
import { circlesOverlap, type Vec2 } from '../core/math';
import { NO_INPUT, respawnPlayer } from '../core/player';
import { seededRng } from '../core/rng';
import { createUfoShot } from '../core/ufo';

export const BOSS_BONUS = 2000;
export const BOSS_TOTAL_HP = 76;
/** Local playtest tuning: a shared cycle, regardless of how many turrets survive. */
export const BOSS_ATTACK = {
  opportunitySeconds: 4,
  chargeSeconds: 1,
  projectileSpeed: 170,
} as const;
export const BOSS_HULL: readonly Vec2[] = [
  { x: 0, y: -65 }, { x: 48, y: -42 }, { x: 115, y: -48 }, { x: 170, y: -14 },
  { x: 156, y: 38 }, { x: 90, y: 56 }, { x: 48, y: 37 }, { x: 0, y: 72 },
  { x: -48, y: 37 }, { x: -90, y: 56 }, { x: -156, y: 38 }, { x: -170, y: -14 },
  { x: -115, y: -48 }, { x: -48, y: -42 },
];
export type SectionId = 'left' | 'right' | 'core';
export interface BossSection {
  id: SectionId;
  position: Vec2;
  radius: number;
  hp: number;
  maxHp: number;
  hitFlash: number;
  muzzleFlash: number;
  destroyedAt: number | null;
}
export interface BossFlash { position: Vec2; age: number; radius: number; color: number }
export type BossEvent = { type: 'fire' | 'hit' | 'turret_destroyed' | 'core_destroyed' | 'explosion' | 'destroyed'; section?: SectionId; player?: number };

function section(id: SectionId, hp: number, radius: number): BossSection {
  return { id, hp, maxHp: hp, radius, position: { x: 0, y: 0 }, hitFlash: 0, muzzleFlash: 0, destroyedAt: null };
}

export class Mothership {
  position: Vec2 = { x: SCREEN_WIDTH / 2, y: -120 };
  phase: 'warning' | 'entering' | 'fighting' | 'dying' | 'destroyed' = 'warning';
  age = 0;
  fightTime = 0;
  deathTime = 0;
  exposedAt: number | null = null;
  hitFlash = 0;
  attackCooldown: number = BOSS_ATTACK.opportunitySeconds;
  charge: { turret: 'left' | 'right'; target: Vec2; elapsed: number } | null = null;
  nextTurret = 0;
  explosionCount = 0;
  creditedPlayer = 1;
  readonly left = section('left', 18, 22);
  readonly right = section('right', 18, 22);
  readonly core = section('core', 40, 26);
  readonly sections = [this.left, this.right, this.core];

  constructor() { this.syncSections(); }
  get exposed(): boolean { return this.left.hp === 0 && this.right.hp === 0; }
  get hp(): number { return this.sections.reduce((sum, s) => sum + s.hp, 0); }
  syncSections(): void {
    for (const s of this.sections) {
      s.position.x = this.position.x + (s.id === 'left' ? -112 : s.id === 'right' ? 112 : 0);
      // All three targets protrude past the forward armor, so ordinary shots from below reach them.
      s.position.y = this.position.y + (s.id === 'core' ? 50 : 43);
    }
  }
}

/** Fresh instance = complete trial reset, including the fixed clock, RNG, weapons, score and enemy shots. */
export class BossTrialSim extends GameSim {
  readonly boss = new Mothership();
  bossFlashes: BossFlash[] = [];
  bossEvents: BossEvent[] = [];
  private accumulator = 0;

  constructor(config: Partial<GameConfig> = {}) {
    super({ config, rng: seededRng(0xd4ead), ufos: false, startCooldown: 0 });
    this.spawner.spawnTimer = -1e9;
    this.players.forEach((p, index) => {
      respawnPlayer(p, this.players.length === 1 ? 640 : 490 + index * 300, 540);
      p.isRespawning = false;
      p.respawnTimer = 0;
      p.rotation = 180;
    });
  }

  /** Fixed 60 Hz independent of display rate. Ordinary play never instantiates this class. */
  override step(dt: number, input = NO_INPUT, input2 = NO_INPUT): SimEvent[] {
    const events: SimEvent[] = [];
    this.accumulator += Math.min(Math.max(dt, 0), MAX_FRAME_DT);
    while (this.accumulator + 1e-10 >= 1 / 60) {
      this.accumulator = Math.max(0, this.accumulator - 1 / 60);
      events.push(...super.step(1 / 60, input, input2));
      if (!this.isGameOver) this.tickBoss(1 / 60);
    }
    return events;
  }

  /** Presentation drains this queue once; pausing cannot replay a cue. */
  drainBossEvents(): BossEvent[] {
    const events = this.bossEvents;
    this.bossEvents = [];
    return events;
  }

  private flash(position: Vec2, radius: number, color: number): void {
    this.bossFlashes.push({ position: { ...position }, age: 0, radius, color });
    if (this.bossFlashes.length > 48) this.bossFlashes.shift();
  }

  private tickBoss(dt: number): void {
    const b = this.boss;
    b.age += dt;
    b.hitFlash = Math.max(0, b.hitFlash - dt);
    for (const s of b.sections) {
      s.hitFlash = Math.max(0, s.hitFlash - dt);
      s.muzzleFlash = Math.max(0, s.muzzleFlash - dt);
    }
    for (const f of this.bossFlashes) f.age += dt;
    this.bossFlashes = this.bossFlashes.filter((f) => f.age < 0.65);
    if (b.phase === 'destroyed') return;
    if (b.phase === 'dying') {
      b.deathTime += dt;
      while (b.explosionCount < 8 && b.deathTime >= b.explosionCount * 0.18) {
        const n = b.explosionCount++;
        this.flash({ x: b.position.x + Math.sin(n * 2.4) * 138, y: b.position.y + Math.cos(n * 3.1) * 36 }, 32, 0xff7040);
        this.bossEvents.push({ type: 'explosion' });
      }
      if (b.deathTime >= 1.8) {
        b.phase = 'destroyed';
        this.flash(b.position, 200, 0xffb4ef);
        this.screenShake = 12;
        this.playerByNumber(b.creditedPlayer).score += BOSS_BONUS;
        this.bossEvents.push({ type: 'destroyed', player: b.creditedPlayer });
      }
      return;
    }
    if (b.age < 1.1) return;
    if (b.phase === 'warning') b.phase = 'entering';
    if (b.phase === 'entering') {
      const t = Math.min(1, (b.age - 1.1) / 2.2);
      b.position.y = -120 + 355 * (1 - (1 - t) ** 3);
      if (t >= 1) b.phase = 'fighting';
    } else {
      b.fightTime += dt;
      b.position.x = SCREEN_WIDTH / 2 + Math.sin(b.fightTime * 0.32) * 260;
    }
    b.syncSections();
    if (b.phase === 'fighting') this.fireTurret(dt);
    this.collideBossWeapons();
  }

  private fireTurret(dt: number): void {
    const b = this.boss;
    if (!b.charge) {
      b.attackCooldown -= dt;
      if (b.attackCooldown > 1e-9) return;
      b.attackCooldown = BOSS_ATTACK.opportunitySeconds;
      const turrets = b.nextTurret === 0 ? [b.left, b.right] : [b.right, b.left];
      const turret = turrets.find((s) => s.hp > 0);
      if (!turret) return;
      const target = this.targetFor(turret.position);
      if (!target) return;
      // Copy the world position once: neither player movement nor a closer co-op partner retargets the shot.
      b.charge = { turret: turret === b.left ? 'left' : 'right', target: { ...target.position }, elapsed: 0 };
      b.nextTurret = turret === b.left ? 1 : 0;
      return;
    }
    const charge = b.charge;
    charge.elapsed += dt;
    if (charge.elapsed + 1e-9 < BOSS_ATTACK.chargeSeconds) return;
    const turret = b[charge.turret];
    b.charge = null;
    b.attackCooldown = BOSS_ATTACK.opportunitySeconds;
    if (turret.hp <= 0) return;
    const origin = { x: turret.position.x, y: turret.position.y + 22 };
    const dx = charge.target.x - origin.x;
    const dy = charge.target.y - origin.y;
    const shot = createUfoShot(origin, Math.atan2(dy, dx) * 180 / Math.PI - 90);
    const length = Math.hypot(dx, dy) || 1;
    shot.velocity = { x: dx / length * BOSS_ATTACK.projectileSpeed, y: dy / length * BOSS_ATTACK.projectileSpeed };
    shot.radius = 8;
    this.ufoShots.push(shot); // base sim owns movement, shields, lives, invulnerability and co-op targeting
    turret.muzzleFlash = 0.2;
    this.bossEvents.push({ type: 'fire', section: turret.id });
  }

  private hitSection(s: BossSection, owner: number): void {
    const b = this.boss;
    if (s.hp <= 0 || b.phase === 'dying' || b.phase === 'destroyed') return;
    if (s.id === 'core' && !b.exposed) {
      this.flash(s.position, 12, 0x56dfff);
      return;
    }
    s.hp--;
    s.hitFlash = b.hitFlash = 0.12;
    this.flash(s.position, 10, 0xffc8ee);
    this.bossEvents.push({ type: 'hit', section: s.id, player: owner });
    if (s.hp > 0) return;
    s.destroyedAt = b.age;
    if (b.charge?.turret === s.id || s.id === 'core') {
      // Destroying a charging turret cancels its shot and gives a fresh attack opportunity.
      b.charge = null;
      b.attackCooldown = BOSS_ATTACK.opportunitySeconds;
    }
    this.flash(s.position, s.id === 'core' ? 70 : 48, 0xff8050);
    if (s.id === 'core') {
      b.phase = 'dying';
      b.creditedPlayer = owner;
      this.ufoShots = []; // victory stops the attack immediately, including shots still in flight
      this.bossEvents.push({ type: 'core_destroyed', player: owner });
    } else {
      this.screenShake = 5;
      this.bossEvents.push({ type: 'turret_destroyed', section: s.id, player: owner });
      if (b.exposed) b.exposedAt = b.age;
    }
  }

  private collideBossWeapons(): void {
    const b = this.boss;
    for (const shot of this.shots) {
      if (!shot.alive || b.phase === 'dying') continue;
      const target = b.sections.find((s) => s.hp > 0 && circlesOverlap(shot, s));
      if (target) {
        shot.alive = false;
        this.hitSection(target, shot.owner); // charged bullets keep their ordinary direct hit; no chain jumps
      } else if (hullTouches(b, shot.position, shot.radius)) {
        shot.alive = false;
        this.flash(shot.position, 7, 0x56dfff);
      }
    }
    this.shots = this.shots.filter((s) => s.alive);
    for (const beam of this.lasers) {
      if (b.phase === 'dying') break;
      for (const s of b.sections) {
        if (s.hp > 0 && laserHits(beam, s)) this.hitSection(s, beam.owner);
      }
      // Hull sparks once per beam. The beam retains its established piercing behaviour.
      if (!beam.hit.has(b)) {
        const contact = BOSS_HULL.map((p) => ({ x: b.position.x + p.x, y: b.position.y + p.y }))
          .find((p, i, points) => segmentsCross(beam.start, beam.end, p, points[(i + 1) % points.length]!) || distanceToBeam(beam, p) < 2);
        if (contact) {
          beam.hit.add(b);
          this.flash(contact, 7, 0x56dfff);
        }
      }
    }
  }
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const cross = (p: Vec2, q: Vec2, r: Vec2): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}

/** Circle against the actual drawn hull polygon, including the radius at its edges. */
export function hullTouches(boss: Mothership, point: Vec2, radius: number): boolean {
  const p = { x: point.x - boss.position.x, y: point.y - boss.position.y };
  let inside = false;
  for (let i = 0, j = BOSS_HULL.length - 1; i < BOSS_HULL.length; j = i++) {
    const a = BOSS_HULL[i]!;
    const b = BOSS_HULL[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    if (distanceToBeam({ start: a, end: b }, p) <= radius) return true;
  }
  return inside;
}
