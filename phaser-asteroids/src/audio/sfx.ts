import type Phaser from 'phaser';
import type { SimEvent } from '../core/game';

export const SFX_ASSETS: ReadonlyArray<readonly [key: string, file: string]> = [
  ['shoot_low', 'audio/sfx/shoot_low.ogg'],
  ['shoot_mid', 'audio/sfx/shoot_mid.ogg'],
  ['shoot_high', 'audio/sfx/shoot_high.ogg'],
  ['explosion_small', 'audio/sfx/explosion_small.ogg'],
  ['explosion_medium', 'audio/sfx/explosion_medium.ogg'],
  ['explosion_large', 'audio/sfx/explosion_large.ogg'],
  ['player_death', 'audio/sfx/player-death.ogg'],
];

const SHOOT_KEYS = ['shoot_low', 'shoot_mid', 'shoot_high'] as const;

/**
 * Maps simulation events to sound effects. Browsers keep the audio context locked until the first
 * user gesture; Phaser queues playback until then, so no manual unlocking is needed here.
 */
export class Sfx {
  constructor(private readonly sound: Phaser.Sound.BaseSoundManager) {}

  handle(events: readonly SimEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'shot_fired':
          this.play(SHOOT_KEYS[Math.floor(Math.random() * SHOOT_KEYS.length)] ?? 'shoot_mid', 0.5);
          break;
        case 'asteroid_destroyed':
          this.play(event.radius >= 50 ? 'explosion_large' : event.radius >= 30 ? 'explosion_medium' : 'explosion_small', 0.6);
          break;
        case 'player_hit':
          this.play('player_death', 0.8);
          break;
        default:
          break;
      }
    }
  }

  private play(key: string, volume: number): void {
    // A missing asset (e.g. failed load) must never break gameplay.
    if (!this.sound.game.cache.audio.exists(key)) return;
    this.sound.play(key, { volume });
  }
}
