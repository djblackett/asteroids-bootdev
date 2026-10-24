import type { GameConfig } from '../core/gameConfig';
import { seededRng } from '../core/rng';
import { BOSS_CINEMATIC as C } from '../boss/bossCinematic';
import { MothershipGameSim } from '../boss/bossSim';
export * from '../boss/bossSim';

/** Development-only immediate encounter and optional exposed-core shortcut. */
export class BossTrialSim extends MothershipGameSim {
  constructor(config: Partial<GameConfig> = {}, options: { exposedCore?: boolean } = {}) {
    super({ config, rng: seededRng(0xd4ead), startCooldown: 0 });
    this.startEncounter();
    for (const p of this.players) { p.isRespawning = false; p.respawnTimer = 0; }
    if (options.exposedCore) {
      const b = this.boss;
      b.phase = 'fighting';
      b.age = C.descentEnd;
      b.position.y = 235;
      for (const s of [b.left, b.right]) { s.hp = 0; s.destroyedAt = b.age; }
      b.syncSections();
      this.exposeCore();
    }
  }

  skipEntrance(): void {
    const b = this.boss;
    if ((b.phase === 'warning' || b.phase === 'entering') && b.age >= C.skipAfter) b.age = C.descentEnd;
  }
}
