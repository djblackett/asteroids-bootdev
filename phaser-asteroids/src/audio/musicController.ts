import type { Rng } from '../core/rng';
import {
  DEFAULT_MUSIC_TRACK,
  DEFAULT_MUSIC_VOLUME,
  MEGA_POWER_MUSIC_SPEED,
  MEGA_POWER_MUSIC_SPEEDUP_ENABLED,
  type MusicChoice,
  type MusicTrackId,
} from './audioConfig';
import { clampVolume, trackMusicGain } from './audioSettings';
import { choiceLabel, cycleChoice, isMusicChoice, pickRandomTrack } from './musicTracks';

/**
 * The one looping music player. It holds a single sound at a time: `setSource` picks which track it is, and `stop`
 * releases the sound that is playing so that switching never leaves two behind.
 */
export interface MusicTrack {
  /** Starts the current source from its beginning (or does nothing if it already has a sound). May need to load it first. */
  play(): void;
  pause(): void;
  resume(): void;
  /** Ends and releases the sound (if any). A later `play` starts the source again from the beginning. */
  stop(): void;
  /** Chooses which track `play` starts. The controller always `stop`s first; any load of a previous source is abandoned. */
  setSource(track: MusicTrackId): void;
  setRate(rate: number): void;
  /** The real gain of the track (Music setting x master gain x the track's own level); applies at once to a playing, paused or not yet created track. */
  setVolume(gain: number): void;
  /** Warm the existing player's cache without changing the selected source. */
  prepare?(track: MusicTrackId): void;
}

export type MusicState = 'stopped' | 'playing' | 'paused';

export interface MusicControllerOptions {
  muted?: boolean;
  /** The Music setting, 0..1 (not the gain; see `musicGain`). */
  volume?: number;
  megaPowerSpeedup?: boolean;
  megaPowerSpeed?: number;
  /** The soundtrack setting (saved by the owner). The controller itself defaults to Original; the game's default for new players is `DEFAULT_MUSIC_CHOICE` (MegaPop), applied where settings are loaded. */
  choice?: MusicChoice;
  /** The track the first game plays when that was already decided (Random picked early, so the right file could be loaded). */
  track?: MusicTrackId;
  /** Used by Random only. */
  rng?: Rng;
  onMuteChanged?: (muted: boolean) => void;
  onVolumeChanged?: (volume: number) => void;
  onChoiceChanged?: (choice: MusicChoice) => void;
  /** Where problems (a track that could not be loaded) are reported. Default `console.warn`. */
  warn?: (message: string) => void;
}

/**
 * Decides when the music should be audible. The track plays only while the audio has started, the user has
 * not muted it, the game is not paused and the window is visible and focused. Speed changes (Mega Power)
 * are applied by changing the playback rate of the *same* track, so nothing is ever restarted or duplicated.
 * Volume is independent of all of that: it is pushed to the track whenever it changes, whether the track is
 * playing, paused (by the game or by mute) or not created yet, and muting never alters the stored volume.
 *
 * Soundtrack: the player's `choice` is one track or Random. `currentTrack` is what is actually loaded into the
 * player. An explicit choice switches to that track at once. Random never switches by itself: it picks a new track
 * (never the one just played) in `beginRun`, which the game calls when a run starts, so one run keeps one track through
 * pause, resume, focus loss and scene changes. Choosing Random mid-run keeps the current track until the next run.
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
  private readonly onChoiceChanged: ((choice: MusicChoice) => void) | undefined;
  private readonly warn: (message: string) => void;
  private readonly rng: Rng;
  private soundtrack: MusicChoice;
  private current: MusicTrackId;
  private regular: MusicTrackId;
  private override: MusicTrackId | null = null;
  private presentationGain = 1;
  /** Random mode: `current` was picked for a run that has not started yet, so `beginRun` keeps it (the title screen already plays it). */
  private freshPick: boolean;

  constructor(
    private readonly track: MusicTrack,
    options: MusicControllerOptions = {},
  ) {
    this.muted = options.muted ?? false;
    this.speedup = options.megaPowerSpeedup ?? MEGA_POWER_MUSIC_SPEEDUP_ENABLED;
    this.megaSpeed = options.megaPowerSpeed ?? MEGA_POWER_MUSIC_SPEED;
    this.onMuteChanged = options.onMuteChanged;
    this.onVolumeChanged = options.onVolumeChanged;
    this.onChoiceChanged = options.onChoiceChanged;
    this.warn = options.warn ?? ((message) => console.warn(`[asteroids] ${message}`));
    this.rng = options.rng ?? Math.random;
    this.volume = clampVolume(options.volume ?? DEFAULT_MUSIC_VOLUME, DEFAULT_MUSIC_VOLUME);
    this.soundtrack = isMusicChoice(options.choice) ? options.choice : DEFAULT_MUSIC_TRACK;
    this.current = options.track ?? (this.soundtrack === 'random' ? pickRandomTrack(this.rng) : this.soundtrack);
    this.regular = this.current;
    this.freshPick = this.soundtrack === 'random';
    this.track.setSource(this.current);
    this.track.setVolume(this.gain);
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
  /** The soundtrack setting: a track or Random. */
  get choice(): MusicChoice {
    return this.soundtrack;
  }
  /** The track that plays (or will play) now. */
  get currentTrack(): MusicTrackId {
    return this.current;
  }
  /** The real gain of the current track, as pushed to the player. */
  get gain(): number {
    return trackMusicGain(this.volume, this.current) * this.presentationGain;
  }

  /** Transient encounter state: never writes preferences or consumes Random's RNG. */
  setTemporaryTrack(track: MusicTrackId | null): void {
    if (track === this.override) return;
    this.override = track;
    this.switchTo(track ?? this.regular);
  }

  prepare(track: MusicTrackId): void { this.track.prepare?.(track); }

  /** Driven by the scene's fixed cinematic clock, so pause freezes the fade too. */
  setPresentationGain(gain: number): void {
    const next = clampVolume(gain, 1);
    if (next === this.presentationGain) return;
    this.presentationGain = next;
    this.track.setVolume(this.gain);
  }

  private selectRegular(track: MusicTrackId): void {
    this.regular = track;
    if (!this.override) this.switchTo(track);
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
    this.track.setVolume(this.gain);
    this.onVolumeChanged?.(next);
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /**
   * Changes the soundtrack setting (and tells the owner to save it). A track starts playing at once, from its beginning,
   * if the music is audible (otherwise when it next becomes audible); Random keeps the current track until the next run.
   */
  setChoice(choice: MusicChoice): void {
    if (!isMusicChoice(choice) || choice === this.soundtrack) return;
    this.soundtrack = choice;
    this.onChoiceChanged?.(choice);
    if (choice === 'random') this.freshPick = false;
    else this.selectRegular(choice);
  }

  /** Steps through Original, MegaPop, Gatekeeper, Random (wrapping). Returns the new setting. */
  cycleChoice(direction: 1 | -1): MusicChoice {
    this.setChoice(cycleChoice(this.soundtrack, direction));
    return this.soundtrack;
  }

  /**
   * A new game begins (first run, retry, or a run started from the title screen): the only moment Random picks a track.
   * The pick made at start-up (before anything played) is kept, so the title screen's music carries on into the first game.
   */
  beginRun(): void {
    this.setTemporaryTrack(null);
    this.setPresentationGain(1);
    if (this.soundtrack !== 'random') {
      // Already the chosen track, except after a fall-back to the original: try the chosen one again.
      this.selectRegular(this.soundtrack);
    } else if (this.freshPick) {
      this.freshPick = false;
    } else {
      this.selectRegular(pickRandomTrack(this.rng, this.regular));
    }
  }

  /**
   * The player reports that `track` cannot be played (download or decode failed). If it is the one in use, the original
   * plays instead for now; the saved setting is left alone so a temporary network problem does not change it.
   */
  reportUnavailable(track: MusicTrackId): void {
    if (track !== this.current) return;
    if (track === DEFAULT_MUSIC_TRACK) {
      this.warn('the original music could not be loaded; the game continues without music');
      return;
    }
    const fallback = this.override && this.regular !== track ? this.regular : DEFAULT_MUSIC_TRACK;
    this.warn(`music track "${choiceLabel(track)}" could not be loaded; playing "${choiceLabel(fallback)}" instead`);
    if (this.override) this.switchTo(fallback);
    else this.selectRegular(DEFAULT_MUSIC_TRACK);
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

  /** Replaces the loaded track: the old sound is released and the new one starts from the top as soon as the music is audible. */
  private switchTo(next: MusicTrackId): void {
    if (next === this.current) return;
    this.current = next;
    this.track.stop();
    this.state = 'stopped';
    this.rate = 1;
    this.track.setSource(next);
    this.track.setVolume(this.gain);
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
