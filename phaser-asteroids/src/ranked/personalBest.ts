import { fetchScoreDetail, type Ranks } from './api';
import { forgetScore, localBest, rememberScore, type LocalScore, type StorageLike } from './localScores';

export interface PersonalBest {
  best: LocalScore;
  /** The server's current ranks for that score, or null when they could not be fetched (offline): the local figure is still shown. */
  ranks: Ranks | null;
}

type DetailFetcher = typeof fetchScoreDetail;

/**
 * This device's best server-confirmed score, refreshed from `GET /scores/:id` when the service is reachable. A score the server no
 * longer lists (404: hidden, or removed) is forgotten here and the next best is tried, so the figure shown is always one the board
 * itself knows. Offline, the remembered figure is returned as it is. Nothing is ever added here: only an acceptance does that.
 */
export async function refreshPersonalBest(
  base: string | null,
  storage?: StorageLike,
  fetchDetail: DetailFetcher = fetchScoreDetail,
): Promise<PersonalBest | null> {
  for (let tries = 0; tries < 3; tries++) {
    const best = localBest(storage);
    if (!best) return null;
    if (!base) return { best, ranks: null };
    try {
      const detail = await fetchDetail(base, best.id);
      if (detail === null) {
        forgetScore(best.id, storage);
        continue;
      }
      const confirmed = { ...best, score: detail.score.score, nickname: detail.score.nickname, rulesVersion: detail.score.rulesVersion ?? best.rulesVersion };
      if (confirmed.score !== best.score || confirmed.nickname !== best.nickname || confirmed.rulesVersion !== best.rulesVersion) rememberScore(confirmed, storage);
      return { best: confirmed, ranks: detail.ranks };
    } catch {
      return { best, ranks: null };
    }
  }
  return null;
}
