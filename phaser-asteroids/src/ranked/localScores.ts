/**
 * A device-local record of this browser's accepted ranked scores, so a future UI can show "your best" without accounts. It is
 * a convenience only: it proves nothing about who played, and clearing site data forgets it. The authoritative entries live on the
 * server; these are just their public ids plus the score the server reported.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LocalScore {
  id: string;
  score: number;
  at: string;
}

export const LOCAL_SCORES_KEY = 'asteroids.rankedScores';
const KEEP = 20;

export function readLocalScores(storage: StorageLike | undefined = safeStorage()): LocalScore[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(LOCAL_SCORES_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is LocalScore => !!s && typeof s.id === 'string' && Number.isFinite(s.score) && typeof s.at === 'string',
    );
  } catch {
    return [];
  }
}

export function rememberScore(score: LocalScore, storage: StorageLike | undefined = safeStorage()): void {
  try {
    const all = readLocalScores(storage).filter((s) => s.id !== score.id);
    all.push(score);
    all.sort((a, b) => b.score - a.score);
    storage?.setItem(LOCAL_SCORES_KEY, JSON.stringify(all.slice(0, KEEP)));
  } catch {
    /* private mode or blocked storage: the score is still on the server */
  }
}

export function localBest(storage?: StorageLike): LocalScore | null {
  return readLocalScores(storage)[0] ?? null;
}

function safeStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export const NICKNAME_KEY = 'asteroids.rankedNickname';

/** The nickname to send: `?nick=` wins, then whatever was used last. The server validates and normalises it. */
export function chosenNickname(search: string, storage: StorageLike | undefined = safeStorage()): string | undefined {
  const fromUrl = new URLSearchParams(search).get('nick');
  if (fromUrl) {
    try {
      storage?.setItem(NICKNAME_KEY, fromUrl);
    } catch {
      /* ignore */
    }
    return fromUrl;
  }
  try {
    return storage?.getItem(NICKNAME_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
