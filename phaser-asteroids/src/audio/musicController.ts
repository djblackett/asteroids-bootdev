import { MEGA_POWER_MUSIC_SPEED, MEGA_POWER_MUSIC_SPEEDUP_ENABLED } from './audioConfig';

/** The one looping music track. */
export interface MusicTrack {
  play(): void;
  pause(): void;
  resume(): void;
  setRate(rate: number): void;
}

export type MusicState = 'stopped' | 'playing' | 'paused';

export interface MusicControllerOptions {
  muted?: boolean;
  megaPowerSpeedup?: boolean;
  megaPowerSpeed?: number;
  onMuteChanged?: (muted: boolean) => void;
}

/**
 * Decides when the music should be audible. The track plays only while the audio has started, the user has
 * not muted it, the game is not paused and the window is visible and focused. Speed changes (Mega Power)
 * are applied by changing the playback rate of the *same* track, so nothing is ever restarted or duplicated.
 */
export class MusicController {
  private state: MusicState = 'stopped';
  private started = false;
  private muted: boolean;
  private gamePaused = false;
  private windowActive = true;
  private megaPower = false;
  private rate = 1;
  private readonly speedup: boolean;
  private readonly megaSpeed: number;
  private readonly onMuteChanged: ((muted: boolean) => void) | undefined;

  constructor(
    private readonly track: MusicTrack,
    options: MusicControllerOptions = {},
  ) {
    this.muted = options.muted ?? false;
    this.speedup = options.megaPowerSpeedup ?? MEGA_POWER_MUSIC_SPEEDUP_ENABLED;
    this.megaSpeed = options.megaPowerSpeed ?? MEGA_POWER_MUSIC_SPEED;
    this.onMuteChanged = options.onMuteChanged;
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
