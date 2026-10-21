/**
 * Directional focus for a menu: which item gets the focus when Up / Down / Left / Right is pressed. Pure geometry (no Phaser, no DOM), so
 * every layout the menus use is unit tested. The rule is the one every console menu uses: the nearest item in that direction, preferring
 * the one most in line with where you are now.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface NavTarget {
  id: string;
  rect: Rect;
}

export const centreOf = (r: Rect): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function containsPoint(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** How much a sideways offset counts against a candidate, compared with distance in the direction of travel. */
const LATERAL_WEIGHT = 2.5;
/** A candidate must be at least this far past the current item's centre (px), so two items in one row never count as "below". */
const MIN_STEP = 4;
/** Items whose centres are within this many px of each other vertically count as one row when wrapping around. */
const WRAP_ROW_TOLERANCE = 30;

/**
 * The id of the item to focus when moving `direction` from `from`, or null when nothing lies that way. Up / Down wrap around (pressing Down
 * on the last row goes to the first); Left / Right do not, and only consider items in roughly the same row, so a Right press at the end of
 * a row never jumps to the next row by surprise.
 */
export function neighbour(from: NavTarget, targets: readonly NavTarget[], direction: Direction): string | null {
  const here = centreOf(from.rect);
  const vertical = direction === 'up' || direction === 'down';
  const sign = direction === 'down' || direction === 'right' ? 1 : -1;

  let best: { id: string; score: number } | null = null;
  const behind: Array<{ id: string; along: number; across: number }> = [];
  for (const t of targets) {
    if (t.id === from.id) continue;
    const c = centreOf(t.rect);
    const along = (vertical ? c.y - here.y : c.x - here.x) * sign;
    const across = Math.abs(vertical ? c.x - here.x : c.y - here.y);
    if (!vertical && across > Math.max(from.rect.h, t.rect.h) / 2) continue; // not in this row
    if (along > MIN_STEP) {
      const score = along + across * LATERAL_WEIGHT;
      if (!best || score < best.score) best = { id: t.id, score };
    } else if (vertical && along < -MIN_STEP) {
      behind.push({ id: t.id, along, across });
    }
  }
  if (best) return best.id;
  if (behind.length === 0) return null;
  // Wrap around: the row farthest behind us, and in it the item most in line with where we are.
  const farthest = Math.min(...behind.map((b) => b.along));
  const row = behind.filter((b) => b.along - farthest <= WRAP_ROW_TOLERANCE);
  return row.reduce((a, b) => (b.across < a.across ? b : a)).id;
}

/**
 * Which pages are open (a root, then each submenu on top of it) and which item was focused on each page when it was left, so "back"
 * returns to the parent menu with the same button lit. Pure bookkeeping.
 */
export class PageStack {
  private readonly pages: string[];
  private readonly memory = new Map<string, string>();

  constructor(root: string) {
    this.pages = [root];
  }

  get current(): string {
    return this.pages[this.pages.length - 1] as string;
  }

  get depth(): number {
    return this.pages.length;
  }

  get atRoot(): boolean {
    return this.pages.length === 1;
  }

  /** Opens `page` on top of the current one, remembering which item of the current page was focused. */
  push(page: string, focusedId: string | null): void {
    if (focusedId !== null) this.memory.set(this.current, focusedId);
    this.pages.push(page);
  }

  /** Closes the current page. Returns the page that is current again (null at the root, where nothing is closed). */
  pop(): string | null {
    if (this.pages.length === 1) return null;
    this.pages.pop();
    return this.current;
  }

  /** The item that was focused when `page` was last left. */
  recall(page: string): string | null {
    return this.memory.get(page) ?? null;
  }

  remember(page: string, focusedId: string | null): void {
    if (focusedId !== null) this.memory.set(page, focusedId);
  }

  reset(root: string): void {
    this.pages.length = 0;
    this.pages.push(root);
    this.memory.clear();
  }
}
