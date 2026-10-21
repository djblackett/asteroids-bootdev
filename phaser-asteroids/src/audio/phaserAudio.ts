import Phaser from 'phaser';
import { defaultRng } from '../core/rng';
import {
  DEFAULT_MUSIC_TRACK,
  DEFAULT_MUSIC_VOLUME,
  MAX_DECODED_MUSIC_TRACKS,
  MUSIC_FADE_SECONDS,
  type MusicChoice,
  type MusicTrackId,
  type SfxKey,
} from './audioConfig';
import { adjustVolume, createAudioParts, volumeOf, type AudioParts } from './audioSetup';
import { browserStorage, musicGain, type VolumeChannel } from './audioSettings';
import type { MusicController, MusicTrack } from './musicController';
import { trackDef, type StartupMusic } from './musicTracks';
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

type LoadResult = 'ok' | 'failed' | 'aborted';
type AdjustableSound = Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound;

/**
 * The single looping music player. It owns at most one sound at a time (`sound`), created lazily the first time the
 * music is wanted, and never duplicated. A track that is not in Phaser's audio cache yet is downloaded and decoded on
 * demand (the boot screen only loads the one needed first); a download for a track nobody wants any more is abandoned.
 * When the track changes, the old sound is faded out over a few milliseconds (a hard cut mid-wave clicks) and then
 * destroyed, so no orphan stays behind. Only `MAX_DECODED_MUSIC_TRACKS` decoded tracks are kept in memory.
 */
export class PhaserMusicTrack implements MusicTrack {
  private source: MusicTrackId = DEFAULT_MUSIC_TRACK;
  private sound: Phaser.Sound.BaseSound | null = null;
  private intent: 'idle' | 'playing' | 'paused' = 'idle';
  /** Remembered so a sound created later (after a download, or on the first key press) starts at the right level and speed. */
  private gain = musicGain(DEFAULT_MUSIC_VOLUME);
  private rate = 1;
  private awaitingUnlock = false;
  private readonly pending = new Map<MusicTrackId, AbortController>();
  /** Tracks that could not be loaded; not retried until that track is chosen again (so pausing never re-downloads a broken file). */
  private readonly failed = new Set<MusicTrackId>();
  /** Tracks whose decoded audio is in the cache, most recently used last. */
  private readonly decoded: MusicTrackId[] = [];
  /** Sounds on their way out (fading); each is destroyed by its own timer. */
  private readonly fading = new Set<Phaser.Sound.BaseSound>();

  constructor(
    private readonly manager: Sound,
    private readonly onUnavailable: (track: MusicTrackId) => void,
  ) {}

  play(): void {
    this.intent = 'playing';
    this.begin();
  }

  pause(): void {
    this.intent = 'paused';
    this.sound?.pause();
  }

  resume(): void {
    this.intent = 'playing';
    if (this.sound) this.sound.resume();
    else this.begin();
  }

  stop(): void {
    this.intent = 'idle';
    const sound = this.sound;
    this.sound = null;
    if (sound) this.release(sound);
  }

  setSource(track: MusicTrackId): void {
    this.source = track;
    this.failed.delete(track);
    // A download for any other track is no longer wanted.
    for (const [id, controller] of this.pending) {
      if (id === track) continue;
      controller.abort();
      this.pending.delete(id);
    }
  }

  setRate(rate: number): void {
    this.rate = rate;
    (this.sound as AdjustableSound | null)?.setRate(rate);
  }

  setVolume(gain: number): void {
    this.gain = gain;
    (this.sound as AdjustableSound | null)?.setVolume(gain);
  }

  /** The sound that is playing or paused now (null until music was requested, and while a track is downloading). For tests and diagnostics. */
  get instance(): Phaser.Sound.BaseSound | null {
    return this.sound;
  }

  /** Sounds still fading out after a track change. They are gone within a fraction of a second. */
  get fadingCount(): number {
    return this.fading.size;
  }

  /** Whether a track is being downloaded. */
  get loading(): boolean {
    return this.pending.size > 0;
  }

  /** Creates the sound if the music is wanted and the source is ready; otherwise starts the download that will get us back here. */
  private begin(): void {
    if (this.sound || this.intent !== 'playing' || this.failed.has(this.source)) return;
    const id = this.source;
    const def = trackDef(id);
    if (!this.manager.game.cache.audio.exists(def.key)) {
      if (this.pending.has(id)) return;
      void this.load(id).then((result) => {
        if (result === 'ok') this.begin();
        else if (result === 'failed') this.fail(id);
      });
      return;
    }
    if (this.manager.locked) {
      // Never queue a play behind the browser's autoplay lock (Phaser would replay it later, possibly after a track change).
      if (!this.awaitingUnlock) {
        this.awaitingUnlock = true;
        this.manager.once(Phaser.Sound.Events.UNLOCKED, () => {
          this.awaitingUnlock = false;
          this.begin();
        });
      }
      return;
    }
    try {
      const sound = this.manager.add(def.key, { loop: true, volume: this.gain, rate: this.rate });
      if (!sound.play()) {
        sound.destroy();
        throw new Error('the browser refused to play it');
      }
      this.sound = sound;
      this.touch(id);
    } catch (error) {
      console.warn(`[asteroids] could not start music "${id}"`, error);
      this.sound = null;
      this.fail(id);
    }
  }

  private fail(id: MusicTrackId): void {
    this.failed.add(id);
    if (this.source === id) this.onUnavailable(id);
  }

  /** Marks `id` as the most recently used decoded track and drops the oldest ones beyond the memory limit. */
  private touch(id: MusicTrackId): void {
    const at = this.decoded.indexOf(id);
    if (at >= 0) this.decoded.splice(at, 1);
    this.decoded.push(id);
    while (this.decoded.length > MAX_DECODED_MUSIC_TRACKS) {
      const oldest = this.decoded.shift();
      if (oldest !== undefined && oldest !== this.source) this.manager.game.cache.audio.remove(trackDef(oldest).key);
    }
  }

  /** Ends a sound that is leaving: a quick fade (no click), then it is destroyed and nothing of it remains. */
  private release(sound: Phaser.Sound.BaseSound): void {
    const web = sound as Phaser.Sound.WebAudioSound;
    const context = this.manager instanceof Phaser.Sound.WebAudioSoundManager ? this.manager.context : null;
    if (!sound.isPlaying || !context || !web.volumeNode) {
      sound.destroy();
      return;
    }
    const gain = web.volumeNode.gain;
    const now = context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + MUSIC_FADE_SECONDS);
    this.fading.add(sound);
    setTimeout(
      () => {
        this.fading.delete(sound);
        sound.destroy();
      },
      MUSIC_FADE_SECONDS * 1000 + 20,
    );
  }

  /** Downloads and decodes a track into Phaser's audio cache (the file is fetched once; a repeat is served from the browser cache). */
  private async load(id: MusicTrackId): Promise<LoadResult> {
    const manager = this.manager;
    const def = trackDef(id);
    if (!(manager instanceof Phaser.Sound.WebAudioSoundManager)) return 'failed';
    const controller = new AbortController();
    this.pending.set(id, controller);
    try {
      const response = await fetch(def.file, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${def.file}`);
      const data = await response.arrayBuffer();
      const buffer = await manager.context.decodeAudioData(data);
      if (controller.signal.aborted) return 'aborted';
      manager.game.cache.audio.add(def.key, buffer);
      return 'ok';
    } catch (error) {
      if (controller.signal.aborted) return 'aborted';
      console.warn(`[asteroids] failed to load ${def.file}`, error);
      return 'failed';
    } finally {
      if (this.pending.get(id) === controller) this.pending.delete(id);
    }
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

  /** `startup` is the soundtrack decision the boot screen made when it chose which music file to load. */
  constructor(
    private readonly game: Phaser.Game,
    startup?: StartupMusic,
  ) {
    const manager = game.sound;
    manager.pauseOnBlur = false;

    this.track = new PhaserMusicTrack(manager, (id) => this.parts.music.reportUnavailable(id));
    this.parts = createAudioParts(browserStorage(), this.track, new PhaserSfxBackend(manager), defaultRng, startup);

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

  /** The soundtrack setting: a track or Random. */
  get musicChoice(): MusicChoice {
    return this.parts.music.choice;
  }

  /** The track that plays (or will play) now; for Random, the one picked for this run. */
  get currentTrack(): MusicTrackId {
    return this.parts.music.currentTrack;
  }

  /** Steps the soundtrack setting one entry (Original, MegaPop, Gatekeeper, Random): saved at once, and a track starts playing. */
  cycleMusicChoice(direction: 1 | -1): MusicChoice {
    return this.parts.music.cycleChoice(direction);
  }

  setMusicChoice(choice: MusicChoice): void {
    this.parts.music.setChoice(choice);
  }

  /** The live music sound object (null until playback was requested, and while a track is downloading). Exposed for browser tests. */
  get musicSound(): Phaser.Sound.BaseSound | null {
    return this.track.instance;
  }

  /** Music sound objects that exist right now: the playing one, plus any still fading out after a track change. For browser tests. */
  get musicSoundCount(): number {
    return (this.track.instance ? 1 : 0) + this.track.fadingCount;
  }

  /** Whether a music download is in progress. For browser tests. */
  get musicLoading(): boolean {
    return this.track.loading;
  }

  destroy(): void {
    this.detach();
    this.sfx.stopAll();
    this.track.stop();
  }
}

export function getAudio(scene: Phaser.Scene): AudioDirector {
  return scene.registry.get(AUDIO_REGISTRY_KEY) as AudioDirector;
}
