import { DEFAULT_MUSIC_VOLUME, MEGA_POWER_MUSIC_SPEED, MEGA_POWER_MUSIC_SPEEDUP_ENABLED } from './audioConfig';
import { clampVolume, musicGain } from './audioSettings';

/** The one looping music track. */
export interface MusicTrack {
  play(): void;
  pause(): void;
  resume(): void;
  setRate(rate: number): void;
  /** The real gain (0..1) of the track; applies at once to a playing, paused or not yet created track. */
  setVolume(gain: number): void;
}

export type MusicState = 'stopped' | 'playing' | 'paused';

export interface MusicControllerOptions {
  muted?: boolean;
  /** The Music setting, 0..1 (not the gain; see `musicGain`). */
  volume?: number;
  megaPowerSpeedup?: boolean;
  megaPowerSpeed?: number;
  onMuteChanged?: (muted: boolean) => void;
  onVolumeChanged?: (volume: number) => void;
}

/**
 * Decides when the music should be audible. The track plays only while the audio has started, the user has
 * not muted it, the game is not paused and the window is visible and focused. Speed changes (Mega Power)
 * are applied by changing the playback rate of the *same* track, so nothing is ever restarted or duplicated.
 * Volume is independent of all of that: it is pushed to the track whenever it changes, whether the track is
 * playing, paused (by the game or by mute) or not created yet, and muting never alters the stored volume.
 */
export class MusicController {
  private state: MusicState = 'stopped';
  private started = false;
  private muted: boolean;
  private volume: number;
  private gamePaused = false;
  private windowActive = true;
  private megaPower = false;
  private rate = 1;
  private readonly speedup: boolean;
  private readonly megaSpeed: number;
  private readonly onMuteChanged: ((muted: boolean) => void) | undefined;
  private readonly onVolumeChanged: ((volume: number) => void) | undefined;

  constructor(
    private readonly track: MusicTrack,
    options: MusicControllerOptions = {},
  ) {
    this.muted = options.muted ?? false;
    this.speedup = options.megaPowerSpeedup ?? MEGA_POWER_MUSIC_SPEEDUP_ENABLED;
    this.megaSpeed = options.megaPowerSpeed ?? MEGA_POWER_MUSIC_SPEED;
    this.onMuteChanged = options.onMuteChanged;
    this.onVolumeChanged = options.onVolumeChanged;
    this.volume = clampVolume(options.volume ?? DEFAULT_MUSIC_VOLUME, DEFAULT_MUSIC_VOLUME);
    this.track.setVolume(musicGain(this.volume));
  }

  get currentState(): MusicState {
    return this.state;
  }
  get isMuted(): boolean {
    return this.muted;
  }
  private get hasStarted(): boolean {
    return this.state !== 'stopped';
  }
  /** The Music setting (0..1), kept while muted. */
  get musicVolume(): number {
    return this.volume;
  }
  get playbackRate(): number {
    return this.rate;
  }

  /** Call once audio is allowed to play (after the browser's autoplay lock has lifted). Idempotent. */
  start(): void {
    this.started = true;
    this.sync();
  }

  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    this.onMuteChanged?.(muted);
    this.sync();
  }

  setVolume(volume: number): void {
    const next = clampVolume(volume, this.volume);
    if (next === this.volume) return;
    this.volume = next;
    this.track.setVolume(musicGain(next));
    this.onVolumeChanged?.(next);
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setGamePaused(paused: boolean): void {
    this.gamePaused = paused;
    this.sync();
  }

  setWindowActive(active: boolean): void {
    this.windowActive = active;
    this.sync();
  }

  /** Speeds the music up while MEGA POWER is active (if enabled) and restores normal speed afterwards. */
  setMegaPowerActive(active: boolean): void {
    this.megaPower = active;
    this.sync();
  }

  private sync(): void {
    const audible = this.started && !this.muted && !this.gamePaused && this.windowActive;

    if (this.state === 'stopped') {
      if (!audible) return;
      this.track.play();
      this.state = 'playing';
    } else if (audible && this.state === 'paused') {
      this.track.resume();
      this.state = 'playing';
    } else if (!audible && this.state === 'playing') {
      this.track.pause();
      this.state = 'paused';
    }

    const wanted = this.speedup && this.megaPower ? this.megaSpeed : 1;
    if (wanted !== this.rate && this.hasStarted) {
      this.rate = wanted;
      this.track.setRate(wanted);
    }
  }
}
