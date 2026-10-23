/**
 * What this browser remembers about its own ranked play, with no account: the public ids of scores the SERVER accepted (plus the score
 * and nickname it reported) and the last nickname that was successfully submitted. It is a convenience only: it proves nothing about
 * who played, a score id is not a credential, and clearing site data forgets it all. The authoritative entries live on the server.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LocalScore {
  id: string;
  score: number;
  at: string;
  /** The nickname the server stored with it. Several can exist on one device; none identifies a person. */
  nickname?: string;
}

export const LOCAL_SCORES_KEY = 'asteroids.rankedScores';
export const NICKNAME_KEY = 'asteroids.rankedNickname';
const KEEP = 20;

export function readLocalScores(storage: StorageLike | undefined = safeStorage()): LocalScore[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(LOCAL_SCORES_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is LocalScore => !!s && typeof s.id === 'string' && Number.isFinite(s.score) && typeof s.at === 'string')
      .map((s) => ({ id: s.id, score: s.score, at: s.at, ...(typeof s.nickname === 'string' ? { nickname: s.nickname } : {}) }));
  } catch {
    return [];
  }
}

function write(scores: LocalScore[], storage: StorageLike | undefined): void {
  try {
    storage?.setItem(LOCAL_SCORES_KEY, JSON.stringify(scores.slice(0, KEEP)));
  } catch {
    /* private mode or blocked storage: the score is still on the server */
  }
}

/** Call only with a score the server has just confirmed. */
export function rememberScore(score: LocalScore, storage: StorageLike | undefined = safeStorage()): void {
  const all = readLocalScores(storage).filter((s) => s.id !== score.id);
  all.push(score);
  all.sort((a, b) => b.score - a.score);
  write(all, storage);
}

/** Drops a score the server no longer lists (hidden or removed), so the device never shows a "best" that the board does not have. */
export function forgetScore(id: string, storage: StorageLike | undefined = safeStorage()): void {
  write(readLocalScores(storage).filter((s) => s.id !== id), storage);
}

/** This device's best server-confirmed score, whatever nickname it was posted under. */
export function localBest(storage?: StorageLike): LocalScore | null {
  return readLocalScores(storage)[0] ?? null;
}

export function lastNickname(storage: StorageLike | undefined = safeStorage()): string {
  try {
    return storage?.getItem(NICKNAME_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Call only after the server accepted a submission made under this nickname. */
export function rememberNickname(nickname: string, storage: StorageLike | undefined = safeStorage()): void {
  try {
    storage?.setItem(NICKNAME_KEY, nickname);
  } catch {
    /* ignore */
  }
}

/** The name field's starting text: the last submitted nickname, or `?nick=` on a development page. Nothing is stored here. */
export function startingNickname(search: string, storage: StorageLike | undefined = safeStorage()): string {
  return new URLSearchParams(search).get('nick') || lastNickname(storage);
}

function safeStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
