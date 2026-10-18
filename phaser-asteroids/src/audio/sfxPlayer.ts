import type { SimEvent } from '../core/game';
import { pick, type Rng } from '../core/rng';
import { EXPLOSION_MAX_CONCURRENT, SFX_VOLUME, type SfxKey } from './audioConfig';

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
      return { key: pick(rng, SHOOT_KEYS), volume: SFX_VOLUME.shoot };
    case 'asteroid_destroyed':
      return { key: explosionKey(event.radius), volume: SFX_VOLUME.explosion };
    case 'player_hit':
      return { key: 'player_death', volume: SFX_VOLUME.player_death };
    case 'laser_fired':
      return { key: 'laser', volume: SFX_VOLUME.laser };
    case 'boost_started':
      return { key: 'boost', volume: SFX_VOLUME.boost };
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

/**
 * Plays sound effects for simulation events. Any number of different sounds can overlap, but an
 * explosion is skipped when `EXPLOSION_MAX_CONCURRENT` copies of it are already playing.
 */
export class SfxPlayer {
  private readonly active = new Map<SfxKey, Set<PlayingSound>>();
  /** Total cues actually started (useful for tests and diagnostics). */
  played = 0;

  constructor(
    private readonly backend: SfxBackend,
    private readonly rng: Rng,
  ) {}

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

  /** Stops everything (used when a run ends or the scene is torn down). */
  stopAll(): void {
    for (const set of [...this.active.values()]) for (const sound of [...set]) sound.stop();
    this.active.clear();
  }

  private play(cue: SoundCue): void {
    const set = this.active.get(cue.key) ?? new Set<PlayingSound>();
    this.active.set(cue.key, set);
    if (cue.key.startsWith('explosion') && set.size >= EXPLOSION_MAX_CONCURRENT) return;

    let handle: PlayingSound | null = null;
    let finished = false;
    handle = this.backend.play(cue.key, cue.volume, () => {
      finished = true;
      if (handle) set.delete(handle);
    });
    if (!handle) return;
    this.played++;
    if (!finished) set.add(handle);
  }
}
