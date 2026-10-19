import Phaser from 'phaser';
import { defaultRng } from '../core/rng';
import { DEFAULT_MUSIC_VOLUME, MUSIC_KEY, type SfxKey } from './audioConfig';
import { adjustVolume, createAudioParts, volumeOf, type AudioParts } from './audioSetup';
import { browserStorage, musicGain, type VolumeChannel } from './audioSettings';
import type { MusicController, MusicTrack } from './musicController';
import type { SfxPlayer, PlayingSound, SfxBackend } from './sfxPlayer';

export const AUDIO_REGISTRY_KEY = 'audio';

type Sound = Phaser.Sound.BaseSoundManager;

/** Sound effects through Phaser's sound manager: one short-lived sound object per cue. */
class PhaserSfxBackend implements SfxBackend {
  constructor(private readonly manager: Sound) {}

  play(key: SfxKey, volume: number, onFinished: () => void): PlayingSound | null {
    // While the browser's autoplay lock is on, Phaser would queue the sound and replay it as a burst on
    // unlock. A shot that nobody could hear is better dropped.
    if (this.manager.locked) return null;
    if (!this.manager.game.cache.audio.exists(key)) return null;
    try {
      const sound = this.manager.add(key, { volume });
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        sound.destroy();
        onFinished();
      };
      sound.once(Phaser.Sound.Events.COMPLETE, finish);
      if (!sound.play()) {
        finish();
        return null;
      }
      return {
        stop: () => {
          sound.stop();
          finish();
        },
      };
    } catch (error) {
      console.warn(`[asteroids] could not play ${key}`, error);
      return null;
    }
  }
}

/** The single looping music track. Created lazily on first play; never duplicated. */
class PhaserMusicTrack implements MusicTrack {
  private sound: Phaser.Sound.BaseSound | null = null;
  /** Remembered so a track created later (first key press) starts at the right level. */
  private gain = musicGain(DEFAULT_MUSIC_VOLUME);

  constructor(private readonly manager: Sound) {}

  play(): void {
    if (this.sound) return;
    if (!this.manager.game.cache.audio.exists(MUSIC_KEY)) return;
    try {
      this.sound = this.manager.add(MUSIC_KEY, { loop: true, volume: this.gain });
      this.sound.play();
    } catch (error) {
      console.warn('[asteroids] could not start music', error);
      this.sound = null;
    }
  }

  pause(): void {
    this.sound?.pause();
  }

  resume(): void {
    this.sound?.resume();
  }

  setRate(rate: number): void {
    (this.sound as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound | null)?.setRate(rate);
  }

  setVolume(gain: number): void {
    this.gain = gain;
    (this.sound as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound | null)?.setVolume(gain);
  }

  /** For tests and diagnostics. */
  get instance(): Phaser.Sound.BaseSound | null {
    return this.sound;
  }
}

/**
 * Everything audio, created once per Phaser game and shared by all scenes through the registry, so music
 * keeps playing across scene changes and restarts and effects never pile up.
 *
 * Phaser's own pause-on-blur is switched off: this class decides when the music is audible (window focus,
 * tab visibility, game pause, mute) so a paused game does not start playing again just because the window
 * regained focus.
 */
export class AudioDirector {
  private readonly parts: AudioParts;
  private readonly track: PhaserMusicTrack;
  private blurred = false;
  private hidden = false;
  private waitingForUnlock = false;
  private readonly detach: () => void;

  constructor(private readonly game: Phaser.Game) {
    const manager = game.sound;
    manager.pauseOnBlur = false;

    this.track = new PhaserMusicTrack(manager);
    this.parts = createAudioParts(browserStorage(), this.track, new PhaserSfxBackend(manager), defaultRng);

    const events = game.events;
    const update = (): void => this.music.setWindowActive(!this.blurred && !this.hidden);
    const onBlur = (): void => ((this.blurred = true), update());
    const onFocus = (): void => ((this.blurred = false), update());
    const onHidden = (): void => ((this.hidden = true), update());
    const onVisible = (): void => ((this.hidden = false), update());
    events.on(Phaser.Core.Events.BLUR, onBlur);
    events.on(Phaser.Core.Events.FOCUS, onFocus);
    events.on(Phaser.Core.Events.HIDDEN, onHidden);
    events.on(Phaser.Core.Events.VISIBLE, onVisible);
    this.detach = () => {
      events.off(Phaser.Core.Events.BLUR, onBlur);
      events.off(Phaser.Core.Events.FOCUS, onFocus);
      events.off(Phaser.Core.Events.HIDDEN, onHidden);
      events.off(Phaser.Core.Events.VISIBLE, onVisible);
    };
    events.once(Phaser.Core.Events.DESTROY, () => this.destroy());
  }

  /**
   * Starts the music as soon as the browser allows audio: immediately if it is already unlocked, otherwise on
   * the first key press / click. Calling it again is harmless.
   */
  startMusicWhenUnlocked(): void {
    const manager = this.game.sound;
    if (!manager.locked) {
      this.music.start();
    } else if (!this.waitingForUnlock) {
      this.waitingForUnlock = true;
      manager.once(Phaser.Sound.Events.UNLOCKED, () => this.music.start());
    }
  }

  get music(): MusicController {
    return this.parts.music;
  }
  get sfx(): SfxPlayer {
    return this.parts.sfx;
  }

  /** The Music or SFX setting, 0..1. */
  volume(channel: VolumeChannel): number {
    return volumeOf(this.parts, channel);
  }

  /** Moves a setting one step: applies at once, is saved, and an SFX change plays a sample shot. */
  adjustVolume(channel: VolumeChannel, direction: 1 | -1): number {
    return adjustVolume(this.parts, channel, direction);
  }

  /** The live music sound object (null until playback was requested). Exposed for browser tests. */
  get musicSound(): Phaser.Sound.BaseSound | null {
    return this.track.instance;
  }

  destroy(): void {
    this.detach();
    this.sfx.stopAll();
  }
}

export function getAudio(scene: Phaser.Scene): AudioDirector {
  return scene.registry.get(AUDIO_REGISTRY_KEY) as AudioDirector;
}
