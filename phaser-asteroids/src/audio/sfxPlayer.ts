import type { SimEvent } from '../core/game';
import { pick, type Rng } from '../core/rng';
import {
  DEFAULT_SFX_VOLUME,
  EXPLOSION_MAX_CONCURRENT,
  EXPLOSION_MAX_TOTAL,
  OVERLAP_FALLOFF,
  OVERLAP_FALLOFF_MAX_STEPS,
  OVERLAP_WINDOW_SECONDS,
  SFX_GAIN,
  SFX_GROUP,
  type SfxGroup,
  type SfxKey,
} from './audioConfig';
import { clampVolume } from './audioSettings';

/** `volume` is the sound's mix gain (`SFX_GAIN`); the SFX setting and overlap falloff are applied when it plays. */
export interface SoundCue {
  key: SfxKey;
  volume: number;
}

const SHOOT_KEYS: readonly SfxKey[] = ['shoot_low', 'shoot_mid', 'shoot_high'];

export function explosionKey(radius: number): SfxKey {
  if (radius >= 50) return 'explosion_large';
  if (radius >= 30) return 'explosion_medium';
  return 'explosion_small';
}

/**
 * Which sound, if any, a simulation event makes. Mirrors where Python calls its `play_*` functions:
 * shooting, an asteroid starting to break up (including one that crashed into the ship), losing a life,
 * the laser and the boost. Wall hits, armored-asteroid dings, pick-ups and game over are silent in Python.
 */
export function cueForEvent(event: SimEvent, rng: Rng): SoundCue | null {
  switch (event.type) {
    case 'shot_fired':
      {
      const key = pick(rng, SHOOT_KEYS);
      return { key, volume: SFX_GAIN[key] };
    }
    case 'asteroid_destroyed': {
      const key = explosionKey(event.radius);
      return { key, volume: SFX_GAIN[key] };
    }
    case 'player_hit':
      return { key: 'player_death', volume: SFX_GAIN.player_death };
    case 'laser_fired':
      return { key: 'laser', volume: SFX_GAIN.laser };
    case 'boost_started':
      return { key: 'boost', volume: SFX_GAIN.boost };
    default:
      return null;
  }
}

/** One playing sound. */
export interface PlayingSound {
  stop(): void;
}

/** What the player needs from the audio engine. Returns null when the sound could not be started. */
export interface SfxBackend {
  play(key: SfxKey, volume: number, onFinished: () => void): PlayingSound | null;
}

export interface SfxPlayerOptions {
  /** The SFX setting, 0..1. */
  volume?: number;
  onVolumeChanged?: (volume: number) => void;
  /** Seconds on any steady clock; only differences matter. Replaceable for tests. */
  clock?: () => number;
}

/**
 * Plays sound effects for simulation events. Any number of different sounds can overlap, but:
 * - an explosion is skipped when `EXPLOSION_MAX_CONCURRENT` copies of it, or `EXPLOSION_MAX_TOTAL` explosions of
 *   any size, are already playing (only ones started within `OVERLAP_WINDOW_SECONDS` count: the rest is a silent tail);
 * - every sound is quieter for each sound of its group still playing (`OVERLAP_FALLOFF`, shots and explosions only
 *   count while recent, `OVERLAP_WINDOW_SECONDS`), so Rapid Fire and piles of explosions do not add up to a wall of sound;
 * - the SFX setting is read when a sound starts. Sounds already playing keep their level (they are short).
 */
export class SfxPlayer {
  /** Playing sounds per effect, with the time each one started. */
  private readonly active = new Map<SfxKey, Map<PlayingSound, number>>();
  private volume: number;
  private readonly onVolumeChanged: ((volume: number) => void) | undefined;
  private readonly clock: () => number;
  /** Total cues actually started (useful for tests and diagnostics). */
  played = 0;

  constructor(
    private readonly backend: SfxBackend,
    private readonly rng: Rng,
    options: SfxPlayerOptions = {},
  ) {
    this.volume = clampVolume(options.volume ?? DEFAULT_SFX_VOLUME, DEFAULT_SFX_VOLUME);
    this.onVolumeChanged = options.onVolumeChanged;
    this.clock = options.clock ?? (() => performance.now() / 1000);
  }

  /** The SFX setting (0..1). At 0 no effect is started at all. */
  get sfxVolume(): number {
    return this.volume;
  }

  setVolume(volume: number): void {
    const next = clampVolume(volume, this.volume);
    if (next === this.volume) return;
    this.volume = next;
    this.onVolumeChanged?.(next);
  }

  /**
   * A sample effect (a shot) so a volume change can be heard. It always plays at the nominal level of the current
   * setting, even when tapped repeatedly, because its job is to show what that setting sounds like.
   */
  preview(): void {
    this.play({ key: 'shoot_mid', volume: SFX_GAIN.shoot_mid }, false);
  }

  handle(events: readonly SimEvent[]): void {
    for (const event of events) {
      const cue = cueForEvent(event, this.rng);
      if (cue) this.play(cue);
    }
  }

  playingCount(key?: SfxKey): number {
    if (key) return this.active.get(key)?.size ?? 0;
    let n = 0;
    for (const set of this.active.values()) n += set.size;
    return n;
  }

  playingInGroup(group: SfxGroup): number {
    let n = 0;
    for (const [key, voices] of this.active) if (SFX_GROUP[key] === group) n += voices.size;
    return n;
  }

  /** Sounds of the group (or just of `only`) that count as overlapping a sound starting at `now`. */
  private overlapping(group: SfxGroup, now: number, only?: SfxKey): number {
    const window = OVERLAP_WINDOW_SECONDS[group];
    let n = 0;
    for (const [key, voices] of this.active) {
      if (SFX_GROUP[key] !== group || (only !== undefined && key !== only)) continue;
      if (window === undefined) {
        n += voices.size;
        continue;
      }
      for (const startedAt of voices.values()) if (now - startedAt < window) n++;
    }
    return n;
  }

  /** Stops everything (used when a run ends or the scene is torn down). */
  stopAll(): void {
    for (const voices of [...this.active.values()]) for (const sound of [...voices.keys()]) sound.stop();
    this.active.clear();
  }

  private play(cue: SoundCue, attenuateOverlap = true): void {
    if (this.volume <= 0) return;
    const group = SFX_GROUP[cue.key];
    const now = this.clock();
    const voices = this.active.get(cue.key) ?? new Map<PlayingSound, number>();
    this.active.set(cue.key, voices);
    if (
      group === 'explosion' &&
      (this.overlapping(group, now, cue.key) >= EXPLOSION_MAX_CONCURRENT || this.overlapping(group, now) >= EXPLOSION_MAX_TOTAL)
    ) {
      return;
    }

    const overlapping = attenuateOverlap ? Math.min(this.overlapping(group, now), OVERLAP_FALLOFF_MAX_STEPS) : 0;
    const volume = cue.volume * this.volume * OVERLAP_FALLOFF[group] ** overlapping;
    let handle: PlayingSound | null = null;
    let finished = false;
    handle = this.backend.play(cue.key, volume, () => {
      finished = true;
      if (handle) voices.delete(handle);
    });
    if (!handle) return;
    this.played++;
    if (!finished) voices.set(handle, now);
  }
}
