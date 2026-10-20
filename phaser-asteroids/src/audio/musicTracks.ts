import type { Rng } from '../core/rng';
import {
  DEFAULT_MUSIC_CHOICE,
  MUSIC_TRACKS,
  MUSIC_TRACK_STORAGE_KEY,
  type MusicChoice,
  type MusicTrackDef,
  type MusicTrackId,
} from './audioConfig';
import type { StorageLike } from './audioSettings';

/** The order the menus cycle through: the tracks as listed, then Random. */
export const MUSIC_CHOICES: readonly MusicChoice[] = [...MUSIC_TRACKS.map((t) => t.id), 'random'];

export function trackDef(id: MusicTrackId): MusicTrackDef {
  const def = MUSIC_TRACKS.find((t) => t.id === id);
  if (!def) throw new Error(`unknown music track: ${id}`);
  return def;
}

export function isTrackId(value: unknown): value is MusicTrackId {
  return MUSIC_TRACKS.some((t) => t.id === value);
}

export function isMusicChoice(value: unknown): value is MusicChoice {
  return value === 'random' || isTrackId(value);
}

/** Text for menus: `Mega Man`, `Random`. */
export function choiceLabel(choice: MusicChoice): string {
  return choice === 'random' ? 'Random' : trackDef(choice).label;
}

/** The next / previous entry of `MUSIC_CHOICES`, wrapping around. */
export function cycleChoice(choice: MusicChoice, direction: 1 | -1): MusicChoice {
  const at = Math.max(0, MUSIC_CHOICES.indexOf(choice));
  return MUSIC_CHOICES[(at + direction + MUSIC_CHOICES.length) % MUSIC_CHOICES.length] ?? DEFAULT_MUSIC_CHOICE;
}

/**
 * A uniformly random track, never `previous` while another one exists. This is the whole of Random mode's
 * choosing, so it is easy to test with a seeded generator.
 */
export function pickRandomTrack(rng: Rng, previous?: MusicTrackId): MusicTrackId {
  const candidates = MUSIC_TRACKS.filter((t) => t.id !== previous);
  const pool = candidates.length > 0 ? candidates : MUSIC_TRACKS;
  const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  return (pool[index] as MusicTrackDef).id;
}

/** The saved choice, or the default (Original) when nothing, something stale or something unreadable is stored. */
export function loadMusicChoice(storage: StorageLike | null): MusicChoice {
  try {
    const raw = storage?.getItem(MUSIC_TRACK_STORAGE_KEY);
    return isMusicChoice(raw) ? raw : DEFAULT_MUSIC_CHOICE;
  } catch {
    return DEFAULT_MUSIC_CHOICE;
  }
}

export function saveMusicChoice(storage: StorageLike | null, choice: MusicChoice): void {
  try {
    storage?.setItem(MUSIC_TRACK_STORAGE_KEY, choice);
  } catch {
    // Private mode / blocked or full storage: the choice simply is not remembered.
  }
}

export interface StartupMusic {
  choice: MusicChoice;
  /** The track the first game will play (for Random: a pick made now, so the boot screen loads the right file). */
  track: MusicTrackId;
}

/** Decided once at start-up so the boot screen knows which single music file to download before the title appears. */
export function resolveStartupMusic(storage: StorageLike | null, rng: Rng): StartupMusic {
  const choice = loadMusicChoice(storage);
  return { choice, track: choice === 'random' ? pickRandomTrack(rng) : choice };
}
