import { browserStorage } from '../audio/audioSettings';
import type { StorageLike } from './localScores';

export type ReportReason = 'offensive' | 'personal_info' | 'other' | 'suspicious_score';
export const BLOCKED_NAMES_KEY = 'asteroids.blockedNicknames';

/** No player accounts exist: a block covers this nickname, including other people who use it. */
export class NicknameBlocks {
  private readonly names = new Set<string>();
  version = 0;

  constructor(private readonly storage: StorageLike | null = browserStorage()) {
    try {
      const saved: unknown = JSON.parse(storage?.getItem(BLOCKED_NAMES_KEY) ?? '[]');
      if (Array.isArray(saved)) saved.filter((n): n is string => typeof n === 'string').forEach((n) => this.names.add(n.toLowerCase()));
    } catch { /* Storage may be unavailable; session blocks still work. */ }
  }

  has(name: string): boolean { return this.names.has(name.toLowerCase()); }

  toggle(name: string): void {
    const key = name.toLowerCase();
    if (this.names.has(key)) this.names.delete(key);
    else this.names.add(key);
    this.version++;
    try { this.storage?.setItem(BLOCKED_NAMES_KEY, JSON.stringify([...this.names])); } catch { /* session only */ }
  }
}

export async function sendScoreReport(base: string, scoreId: string, reason: ReportReason, fetchFn: typeof fetch = fetch): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchFn(`${base}/api/v1/scores/${encodeURIComponent(scoreId)}/report`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }), signal: controller.signal,
    });
    if (!response.ok) throw new Error(response.status === 429 ? 'TOO MANY REPORTS. TRY LATER.' : 'REPORT NOT SENT. PLEASE RETRY.');
  } finally { clearTimeout(timer); }
}
