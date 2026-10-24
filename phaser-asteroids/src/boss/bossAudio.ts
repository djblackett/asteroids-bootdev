import { SFX_GAIN } from '../audio/audioConfig';
import type { SoundCue } from '../audio/sfxPlayer';
import type { BossEvent } from './bossSim';
import type { Mothership } from './bossSim';
import type { MusicController } from '../audio/musicController';
import type { SfxPlayer } from '../audio/sfxPlayer';
import { BOSS_CINEMATIC as C } from './bossCinematic';

/** A lifecycle adapter to the shared audio system; owns no independent sound player or timers. */
export class BossEncounterAudio {
  private alarmStarted = false;
  private fighting = false;
  private finished = false;

  constructor(private readonly audio: { music: MusicController; sfx: SfxPlayer }) {
    audio.sfx.stopCue('boss_alarm');
    audio.music.prepare('gatekeeper');
  }

  update(b: Mothership, paused: boolean): void {
    if (this.finished) return;
    const entering = b.phase === 'warning' || b.phase === 'entering';
    if (entering) {
      this.audio.music.setPresentationGain(Math.max(0, 1 - b.age / C.musicFade));
      if (!paused && !this.alarmStarted && b.age >= C.alarmStart) {
        this.alarmStarted = true;
        this.audio.sfx.playCue({ key: 'boss_alarm', volume: SFX_GAIN.boss_alarm });
      }
      this.audio.sfx.setAlarmGain(Math.min(1, Math.max(0, (C.combatStart - b.age) / C.alarmFade)));
      this.audio.sfx.pauseCue('boss_alarm', paused);
    } else if (!this.fighting) {
      this.fighting = true;
      this.audio.sfx.stopCue('boss_alarm');
      this.audio.music.setTemporaryTrack('gatekeeper');
      this.audio.music.setPresentationGain(1);
    }
    if (b.phase === 'destroyed') this.dispose();
  }

  dispose(): void {
    if (this.finished) return;
    this.finished = true;
    this.audio.sfx.stopCue('boss_alarm');
    this.audio.music.setTemporaryTrack(null);
    this.audio.music.setPresentationGain(1);
  }
}

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
