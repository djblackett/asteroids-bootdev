// This entire simulation is reached only through GameScene's DEV-only, unrecorded trial import.
import { MAX_FRAME_DT, SCREEN_WIDTH } from '../core/constants';
import { GameSim, type SimEvent } from '../core/game';
import type { GameConfig } from '../core/gameConfig';
import { distanceToBeam, laserEndPosition, laserHits } from '../core/laser';
import { circlesOverlap, type Vec2 } from '../core/math';
import { NO_INPUT, respawnPlayer } from '../core/player';
import { seededRng } from '../core/rng';
import { createUfoShot, type UfoShot } from '../core/ufo';

export const BOSS_BONUS = 2000;
export const BOSS_TOTAL_HP = 76;
/** Local playtest tuning: a shared cycle, regardless of how many turrets survive. */
export const BOSS_ATTACK = {
  opportunitySeconds: 4,
  chargeSeconds: 1,
  projectileSpeed: 170,
  projectileLifetime: 3.5, // clears the longest volley before another warning can begin
  specialEvery: 3,
  spreadRadians: Math.PI / 10, // 18 degrees either side
  beamChargeSeconds: 1.5,
  beamSeconds: 1.25,
  beamArcRadians: Math.PI / 6,
  beamWidth: 12,
  exposurePauseSeconds: 2.4,
  pulseIntervalSeconds: 6.5,
  pulseChargeSeconds: 1,
  pulseCount: 6,
  pulseSpeed: 145,
  exposedMovementScale: 1.2,
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
export type AttackKind = 'single' | 'spread' | 'beam' | 'pulse';
export interface BossCharge {
  turret: SectionId;
  kind: AttackKind;
  target: Vec2;
  origin: Vec2;
  angle: number; // radians, locked at warning start
  sweep: 1 | -1;
  elapsed: number;
  duration: number;
}
export interface BossBeam {
  origin: Vec2;
  startAngle: number;
  angle: number;
  sweep: 1 | -1;
  elapsed: number;
  hitPlayers: Set<number>;
}
export interface BossProjectile { kind: Exclude<AttackKind, 'beam'>; section: SectionId; remaining: number }
export type BossEvent = { type: 'fire' | 'beam_charge' | 'beam_fire' | 'core_exposed' | 'pulse_charge' | 'hit' | 'turret_destroyed' | 'core_destroyed' | 'explosion' | 'destroyed'; kind?: AttackKind; section?: SectionId; player?: number };

export function bossBeamSegment(beam: BossBeam): { start: Vec2; end: Vec2 } {
  return { start: beam.origin, end: laserEndPosition(beam.origin, beam.angle * 180 / Math.PI - 90) };
}

function section(id: SectionId, hp: number, radius: number): BossSection {
  return { id, hp, maxHp: hp, radius, position: { x: 0, y: 0 }, hitFlash: 0, muzzleFlash: 0, destroyedAt: null };
}

export class Mothership {
  position: Vec2 = { x: SCREEN_WIDTH / 2, y: -120 };
  phase: 'warning' | 'entering' | 'fighting' | 'dying' | 'destroyed' = 'warning';
  age = 0;
  fightTime = 0;
  movementTime = 0;
  deathTime = 0;
  exposedAt: number | null = null;
  hitFlash = 0;
  attackCooldown: number = BOSS_ATTACK.opportunitySeconds;
  charge: BossCharge | null = null;
  beam: BossBeam | null = null;
  attackCounts = { left: 0, right: 0 };
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
  readonly bossProjectiles = new Map<UfoShot, BossProjectile>();
  private accumulator = 0;
  private attackInterrupted = false;

  constructor(config: Partial<GameConfig> = {}, options: { exposedCore?: boolean } = {}) {
    super({ config, rng: seededRng(0xd4ead), ufos: false, startCooldown: 0 });
    this.spawner.spawnTimer = -1e9;
    this.players.forEach((p, index) => {
      respawnPlayer(p, this.players.length === 1 ? 640 : 490 + index * 300, 540);
      p.isRespawning = false;
      p.respawnTimer = 0;
      p.rotation = 180;
    });
    if (options.exposedCore) {
      const b = this.boss;
      b.phase = 'fighting';
      b.age = 3.3;
      b.position.y = 235;
      for (const s of [b.left, b.right]) { s.hp = 0; s.destroyedAt = b.age; }
      b.syncSections();
      this.exposeCore();
    }
  }

  /** Fixed 60 Hz independent of display rate. Ordinary play never instantiates this class. */
  override step(dt: number, input = NO_INPUT, input2 = NO_INPUT): SimEvent[] {
    const events: SimEvent[] = [];
    this.accumulator += Math.min(Math.max(dt, 0), MAX_FRAME_DT);
    while (this.accumulator + 1e-10 >= 1 / 60) {
      this.accumulator = Math.max(0, this.accumulator - 1 / 60);
      this.expireProjectiles(1 / 60);
      const tickEvents = super.step(1 / 60, input, input2);
      if (!this.isGameOver) this.tickBoss(1 / 60);
      // hurt() appends to this same array during the boss tick, including co-op/game-over events.
      events.push(...tickEvents);
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
      // Hold position while telegraphing/firing so the warning describes the actual world-space path.
      if (!b.charge && !b.beam) b.movementTime += dt * (b.exposed ? BOSS_ATTACK.exposedMovementScale : 1);
      b.position.x = SCREEN_WIDTH / 2 + Math.sin(b.movementTime * 0.32) * 260;
    }
    b.syncSections();
    this.attackInterrupted = false;
    this.collideBossWeapons();
    // Player weapons resolve first: a section destroyed this tick cannot fire or deal beam damage.
    if (b.phase === 'fighting' && !this.attackInterrupted) this.updateAttack(dt);
  }

  private expireProjectiles(dt: number): void {
    for (const [shot, state] of this.bossProjectiles) {
      state.remaining -= dt;
      if (!shot.alive || state.remaining <= 1e-9 || this.boss[state.section].hp <= 0) {
        shot.alive = false;
        this.bossProjectiles.delete(shot);
      }
    }
    this.ufoShots = this.ufoShots.filter((s) => s.alive);
  }

  private exposeCore(): void {
    const b = this.boss;
    this.attackInterrupted = true;
    b.exposedAt = b.age;
    b.charge = null;
    b.beam = null;
    b.attackCooldown = Math.max(BOSS_ATTACK.exposurePauseSeconds, BOSS_ATTACK.pulseIntervalSeconds - BOSS_ATTACK.pulseChargeSeconds);
    this.ufoShots = [];
    this.bossProjectiles.clear();
    this.flash(b.core.position, 58, 0xff6cbd);
    this.bossEvents.push({ type: 'core_exposed', section: 'core' });
  }

  private updateAttack(dt: number): void {
    const b = this.boss;
    if (b.beam) {
      const beam = b.beam;
      if (b.right.hp <= 0) { b.beam = null; b.attackCooldown = BOSS_ATTACK.opportunitySeconds; return; }
      beam.elapsed += dt;
      if (beam.elapsed + 1e-9 >= BOSS_ATTACK.beamSeconds) {
        b.beam = null;
        b.attackCooldown = BOSS_ATTACK.opportunitySeconds;
        return;
      }
      beam.angle = beam.startAngle + beam.sweep * BOSS_ATTACK.beamArcRadians * beam.elapsed / BOSS_ATTACK.beamSeconds;
      this.collideEnergyBeam(beam);
      return;
    }
    if (!b.charge) {
      b.attackCooldown -= dt;
      if (b.attackCooldown > 1e-9) return;
      if (b.exposed) {
        b.charge = { turret: 'core', kind: 'pulse', target: { ...b.core.position }, origin: { ...b.core.position }, angle: 0,
          sweep: 1, elapsed: 0, duration: BOSS_ATTACK.pulseChargeSeconds };
        this.bossEvents.push({ type: 'pulse_charge', section: 'core' });
        return;
      }
      const turret = b.nextTurret === 0 ? b.left : b.right;
      b.nextTurret = 1 - b.nextTurret;
      // Preserve the absent turret's entire slot. A survivor never inherits its partner's frequency.
      b.attackCooldown = BOSS_ATTACK.opportunitySeconds + BOSS_ATTACK.chargeSeconds;
      if (turret.hp <= 0) return;
      const target = this.targetFor(turret.position);
      if (!target) return;
      const id = turret.id as 'left' | 'right';
      const count = ++b.attackCounts[id];
      const kind = count % BOSS_ATTACK.specialEvery === 0 ? (id === 'left' ? 'spread' : 'beam') : 'single';
      const origin = { x: turret.position.x, y: turret.position.y + 22 };
      const sweep = Math.floor(count / BOSS_ATTACK.specialEvery) % 2 === 1 ? 1 : -1;
      b.charge = { turret: id, kind, target: { ...target.position }, origin,
        angle: Math.atan2(target.position.y - origin.y, target.position.x - origin.x), sweep,
        elapsed: 0, duration: kind === 'beam' ? BOSS_ATTACK.beamChargeSeconds : BOSS_ATTACK.chargeSeconds };
      if (kind === 'beam') this.bossEvents.push({ type: 'beam_charge', section: id });
      return;
    }
    const charge = b.charge;
    charge.elapsed += dt;
    if (charge.elapsed + 1e-9 < charge.duration) return;
    const turret = b[charge.turret];
    b.charge = null;
    b.attackCooldown = BOSS_ATTACK.opportunitySeconds;
    if (turret.hp <= 0) return;
    if (charge.kind === 'beam') {
      b.beam = { origin: charge.origin, startAngle: charge.angle, angle: charge.angle, sweep: charge.sweep, elapsed: 0, hitPlayers: new Set() };
      this.bossEvents.push({ type: 'beam_fire', section: turret.id });
      this.collideEnergyBeam(b.beam);
      return;
    }
    if (charge.kind === 'pulse') {
      for (let i = 0; i < BOSS_ATTACK.pulseCount; i++) this.emitProjectile(charge, i * Math.PI * 2 / BOSS_ATTACK.pulseCount);
      b.attackCooldown = BOSS_ATTACK.pulseIntervalSeconds - BOSS_ATTACK.pulseChargeSeconds;
    } else {
      const offsets = charge.kind === 'spread' ? [-BOSS_ATTACK.spreadRadians, 0, BOSS_ATTACK.spreadRadians] : [0];
      for (const offset of offsets) this.emitProjectile(charge, charge.angle + offset);
    }
    turret.muzzleFlash = 0.2;
    this.bossEvents.push({ type: 'fire', kind: charge.kind, section: turret.id });
  }

  private emitProjectile(charge: BossCharge, angle: number): void {
    if (charge.kind === 'beam') return;
    const speed = charge.kind === 'pulse' ? BOSS_ATTACK.pulseSpeed : BOSS_ATTACK.projectileSpeed;
    const shot = createUfoShot(charge.origin, angle * 180 / Math.PI - 90);
    shot.velocity = { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
    shot.radius = 8;
    this.ufoShots.push(shot); // base sim owns movement and all ordinary hostile projectile damage rules
    this.bossProjectiles.set(shot, { kind: charge.kind, section: charge.turret, remaining: BOSS_ATTACK.projectileLifetime });
  }

  private collideEnergyBeam(beam: BossBeam): void {
    const segment = bossBeamSegment(beam);
    for (const p of this.players) {
      if (p.lives <= 0 || beam.hitPlayers.has(p.playerNumber)) continue;
      if (distanceToBeam(segment, p.position) > p.radius + BOSS_ATTACK.beamWidth / 2) continue;
      // Even a shield or respawn-protected contact consumes this beam's one hit on that ship.
      beam.hitPlayers.add(p.playerNumber);
      if (this.hurt(p, 'ufo_shot') === 'game_over') {
        this.boss.beam = null;
        return;
      }
    }
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
    if (b.charge?.turret === s.id || (b.beam && s.id === 'right') || s.id === 'core') {
      // Destroying a charging turret cancels its shot and gives a fresh attack opportunity.
      b.charge = null;
      b.beam = null;
      b.attackCooldown = BOSS_ATTACK.opportunitySeconds;
      this.attackInterrupted = true;
    }
    for (const [shot, state] of this.bossProjectiles) if (state.section === s.id) shot.alive = false;
    this.expireProjectiles(0);
    this.flash(s.position, s.id === 'core' ? 70 : 48, 0xff8050);
    if (s.id === 'core') {
      b.phase = 'dying';
      b.creditedPlayer = owner;
      this.ufoShots = []; // victory stops the attack immediately, including shots still in flight
      this.bossProjectiles.clear();
      this.bossEvents.push({ type: 'core_destroyed', player: owner });
    } else {
      this.screenShake = 5;
      this.bossEvents.push({ type: 'turret_destroyed', section: s.id, player: owner });
      if (b.exposed) this.exposeCore();
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
