import { SFX_GAIN } from '../audio/audioConfig';
import type { SoundCue } from '../audio/sfxPlayer';
import type { BossEvent } from './bossTrialSim';

/** One restrained, pitched sample per cue, through the existing volume/overlap limiter. No gameplay RNG. */
export function bossAttackCue(event: BossEvent): SoundCue | null {
  switch (event.type) {
    case 'beam_charge': return { key: 'boost', volume: SFX_GAIN.boost * 0.32, rate: 0.7 };
    case 'beam_fire': return { key: 'laser', volume: SFX_GAIN.laser * 0.6, rate: 0.55 };
    case 'core_exposed': return { key: 'explosion_medium', volume: SFX_GAIN.explosion_medium * 0.55, rate: 0.65 };
    case 'pulse_charge': return { key: 'boost', volume: SFX_GAIN.boost * 0.2, rate: 1 };
    case 'fire':
      if (event.kind === 'spread') return { key: 'shoot_mid', volume: SFX_GAIN.shoot_mid, rate: 0.55 };
      if (event.kind === 'pulse') return { key: 'shoot_high', volume: SFX_GAIN.shoot_high * 0.9, rate: 0.45 };
      return { key: 'shoot_low', volume: SFX_GAIN.shoot_low, rate: 0.65 };
    default: return null;
  }
}
