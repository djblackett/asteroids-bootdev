import { fetchLeaderboard, type BoardPage, type BoardScope } from './api';

/** Entries per screen: a classic arcade table. The server allows up to 100 per request and offsets up to 1000; this never asks for more than one screen. */
export const BOARD_PAGE_SIZE = 10;
/** The server refuses offsets beyond this (see `settings.page.maxOffset`), so the last reachable screen starts here. */
const MAX_OFFSET = 1000;

export type ScoresStatus = 'loading' | 'ready' | 'empty' | 'error' | 'unavailable';

type Fetcher = typeof fetchLeaderboard;

/**
 * What the High Scores screen is showing: which board, which screen of it, and whether it is loading, empty, failed or unavailable.
 * The screen only draws this. Every answer comes from the server's public leaderboard endpoints; nothing is computed here, and a
 * slow answer for a board or page the player has already left is ignored.
 */
export class ScoresModel {
  scope: BoardScope = 'weekly';
  offset = 0;
  status: ScoresStatus;
  page: BoardPage | null = null;
  /** Increases on every change, so the page can tell cheaply when to redraw. */
  version = 0;
  private request = 0;

  constructor(
    private readonly base: string | null,
    private readonly fetcher: Fetcher = fetchLeaderboard,
  ) {
    this.status = base ? 'loading' : 'unavailable';
  }

  get pageNumber(): number {
    return Math.floor(this.offset / BOARD_PAGE_SIZE) + 1;
  }

  get pageCount(): number {
    const total = this.page?.total ?? 0;
    return Math.max(1, Math.ceil(Math.min(total, MAX_OFFSET + BOARD_PAGE_SIZE) / BOARD_PAGE_SIZE));
  }

  get canPrev(): boolean {
    return this.status !== 'unavailable' && this.offset > 0;
  }

  get canNext(): boolean {
    const total = this.page?.total ?? 0;
    return this.status === 'ready' && this.offset + BOARD_PAGE_SIZE < total && this.offset + BOARD_PAGE_SIZE <= MAX_OFFSET;
  }

  /** Fetches the current board and screen again (opening the screen, the Retry button). */
  async load(): Promise<void> {
    if (!this.base) {
      this.status = 'unavailable';
      this.bump();
      return;
    }
    const mine = ++this.request;
    this.status = 'loading';
    this.bump();
    try {
      const page = await this.fetcher(this.base, this.scope, { limit: BOARD_PAGE_SIZE, offset: this.offset });
      if (mine !== this.request) return;
      this.page = page;
      this.status = page.entries.length === 0 && page.offset === 0 ? 'empty' : 'ready';
    } catch {
      if (mine !== this.request) return;
      this.status = 'error';
    }
    this.bump();
  }

  setScope(scope: BoardScope): Promise<void> {
    if (scope === this.scope) return Promise.resolve();
    this.scope = scope;
    this.offset = 0;
    this.page = null;
    return this.load();
  }

  next(): Promise<void> {
    if (!this.canNext) return Promise.resolve();
    this.offset += BOARD_PAGE_SIZE;
    return this.load();
  }

  prev(): Promise<void> {
    if (!this.canPrev) return Promise.resolve();
    this.offset = Math.max(0, this.offset - BOARD_PAGE_SIZE);
    return this.load();
  }

  private bump(): void {
    this.version++;
  }
}

/** "OCT 19 - OCT 25" for a weekly page, in the server's own time zone and from the server's own boundaries (never the browser's idea of a week). */
export function weekLabel(page: Pick<BoardPage, 'timeZone' | 'weekStart' | 'weekEnd'>): string | null {
  if (!page.weekStart || !page.weekEnd) return null;
  const start = Date.parse(page.weekStart);
  const end = Date.parse(page.weekEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: page.timeZone || 'UTC', month: 'short', day: 'numeric' });
    // The week runs [start, end): its last day is the one containing end - 1 ms.
    return `${fmt.format(start)} - ${fmt.format(end - 1)}`.toUpperCase();
  } catch {
    return null;
  }
}

/** 12,345 for 12345: fixed grouping whatever the device's locale, so columns of scores line up the same everywhere. */
export function formatScore(score: number): string {
  return Math.trunc(score)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
