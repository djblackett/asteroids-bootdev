import { containsPoint, neighbour, PageStack, type Direction, type NavTarget, type Rect } from './focusNav';

/**
 * The menu state machine, shared by the title screen and the pause screen: which page is open, which item has the focus, and what
 * every input device does to them. Pure logic (no Phaser, no DOM, time and pages are passed in), so keyboard, controller, mouse and
 * touch behaviour is unit tested. `menuView.ts` draws it; `pages/` describes each page.
 */

/** One thing on a page that can be focused and activated (a button, a slider row, a choice). */
export interface MenuItem {
  readonly id: string;
  /** What it says (for tests and the debug snapshot). */
  readonly label: string;
  readonly rect: Rect;
  /** A disabled item takes the focus and swallows taps, but does nothing. */
  readonly enabled: boolean;
  /** Enter, Space, A (`at` null) or a click / tap (`at`: where, in game pixels, so a row can tell its - and + halves apart). */
  activate(at: { x: number; y: number } | null): void;
  /** Left / Right on the item. Return true when it used the key (a slider changing its value); false lets the focus move sideways. */
  adjust?(direction: 1 | -1): boolean;
  /** The named parts inside the item that a tap can land on (`-`, `+`, `OFF`): for the debug snapshot, so tests tap what a player taps. */
  zones?(): ReadonlyArray<{ name: string; rect: Rect }>;
}

export interface MenuPageSpec {
  readonly id: string;
  readonly items: readonly MenuItem[];
  /** Keys that do something on this page only (`KeyM`, `Space` on the title screen...), by `KeyboardEvent.code`. Checked before the standard keys. */
  readonly hotkeys?: Readonly<Record<string, () => void>>;
  /** Escape / B / the BACK button. Return true if handled; leave it out for the default (close this page). */
  readonly onBack?: () => boolean;
  /** The item focused when the page opens (the first one by default). */
  readonly defaultFocus?: string;
  /** Changes whenever the page's content must be rebuilt (the player count, a controller being assigned...). */
  readonly signature?: () => string;
  /** Called once when the page is closed or rebuilt: removes everything it made. */
  readonly dispose?: () => void;
}

export type PadMenuButton = 'up' | 'down' | 'left' | 'right' | 'a' | 'b';
export type PointerKind = 'mouse' | 'touch';
/** Who moved the focus last: a keyboard / controller (the focus ring is shown), the mouse (hover) or a finger (no ring). */
export type FocusSource = 'keys' | 'pointer' | 'touch';

/** A page change swallows taps for this long: a double tap must not hit whatever button the next page has under the same thumb. */
export const TRANSITION_LOCK_MS = 220;

const NAV_KEYS: Readonly<Record<string, Direction>> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const ACTIVATE_KEYS: ReadonlySet<string> = new Set(['Enter', 'NumpadEnter', 'Space']);

export interface MenuSnapshot {
  page: string;
  depth: number;
  focus: string | null;
  focusVisible: boolean;
  items: Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    w: number;
    h: number;
    enabled: boolean;
    focused: boolean;
    zones: Array<{ name: string; x: number; y: number; w: number; h: number }>;
  }>;
}

export class MenuController {
  private stack: PageStack;
  private page: MenuPageSpec | null = null;
  private signature = '';
  private lockUntil = Number.NEGATIVE_INFINITY;
  private pageListeners = new Set<(page: string, depth: number) => void>();

  focusId: string | null = null;
  pressedId: string | null = null;
  source: FocusSource = 'keys';

  constructor(
    private readonly build: (id: string) => MenuPageSpec,
    private readonly root: string,
    private readonly clock: () => number,
  ) {
    this.stack = new PageStack(root);
  }

  /** Builds the root page. */
  start(): void {
    this.stack.reset(this.root);
    this.focusId = null;
    this.setPage(this.stack.current, null);
  }

  get currentPage(): string {
    return this.stack.current;
  }

  get depth(): number {
    return this.stack.depth;
  }

  get atRoot(): boolean {
    return this.stack.atRoot;
  }

  /** Whether the focus ring should be drawn (it is not after a finger tap, where it would only be noise). */
  get focusVisible(): boolean {
    return this.source !== 'touch' && this.focusId !== null;
  }

  get items(): readonly MenuItem[] {
    return this.page?.items ?? [];
  }

  /** Calls `listener` whenever a page opens, closes or is rebuilt. Returns the function that removes it. */
  onPageChange(listener: (page: string, depth: number) => void): () => void {
    this.pageListeners.add(listener);
    return () => this.pageListeners.delete(listener);
  }

  // --- navigation ----------------------------------------------------------------------------------------------------

  /** Opens a submenu on top of the current page. */
  open(id: string): void {
    this.stack.push(id, this.focusId);
    this.lockUntil = this.clock() + TRANSITION_LOCK_MS;
    this.setPage(id, null);
  }

  /** Closes the current page and returns to its parent, focused where it was. False at the root (nothing to close). */
  back(): boolean {
    if (this.page?.onBack?.()) return true;
    const parent = this.stack.pop();
    if (parent === null) return false;
    this.lockUntil = this.clock() + TRANSITION_LOCK_MS;
    this.setPage(parent, this.stack.recall(parent));
    return true;
  }

  /** Leaves every submenu at once (the pause menu closing). */
  closeAll(): void {
    this.page?.dispose?.();
    this.page = null;
    this.stack.reset(this.root);
    this.focusId = null;
    this.pressedId = null;
  }

  /** Swallows taps for a moment: called after something changed the page under the finger without opening or closing one. */
  lockInput(): void {
    this.lockUntil = this.clock() + TRANSITION_LOCK_MS;
  }

  /** Builds the current page again (its content changed), keeping the focus where it is if that item still exists. */
  rebuild(): void {
    this.setPage(this.stack.current, this.focusId);
  }

  /** Rebuilds when the page says its content changed. Cheap enough to call every frame. */
  refresh(): void {
    const signature = this.page?.signature?.();
    if (signature !== undefined && signature !== this.signature) this.rebuild();
  }

  private setPage(id: string, focus: string | null): void {
    this.page?.dispose?.();
    this.pressedId = null;
    const page = this.build(id);
    this.page = page;
    this.signature = page.signature?.() ?? '';
    const has = (item: string | null): item is string => item !== null && page.items.some((i) => i.id === item);
    this.focusId = has(focus) ? focus : has(page.defaultFocus ?? null) ? (page.defaultFocus as string) : (page.items[0]?.id ?? null);
    for (const listener of [...this.pageListeners]) listener(id, this.stack.depth);
  }

  // --- keyboard and controller ----------------------------------------------------------------------------------------

  /** A key press (`KeyboardEvent.code`, no auto-repeat). Returns true when the menu used it. */
  key(code: string): boolean {
    if (!this.page) return false;
    const hotkey = this.page.hotkeys?.[code];
    if (hotkey) {
      this.source = 'keys';
      hotkey();
      return true;
    }
    const direction = NAV_KEYS[code];
    if (direction) return this.move(direction);
    if (ACTIVATE_KEYS.has(code)) return this.activateFocused();
    if (code === 'Escape') return this.back();
    return false;
  }

  /** A controller button, as the menu sees it (D-pad, A, B). Returns true when the menu used it. */
  pad(button: PadMenuButton): boolean {
    if (!this.page) return false;
    switch (button) {
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        return this.move(button);
      case 'a':
        return this.activateFocused();
      case 'b':
        return this.back();
    }
  }

  private move(direction: Direction): boolean {
    this.source = 'keys';
    const items = this.items;
    const focused = items.find((i) => i.id === this.focusId);
    if (!focused) {
      this.focusId = items[0]?.id ?? null;
      return true;
    }
    if ((direction === 'left' || direction === 'right') && focused.adjust?.(direction === 'right' ? 1 : -1)) return true;
    const targets: NavTarget[] = items.map((i) => ({ id: i.id, rect: i.rect }));
    const next = neighbour({ id: focused.id, rect: focused.rect }, targets, direction);
    if (next !== null) this.focusId = next;
    return true;
  }

  private activateFocused(): boolean {
    this.source = 'keys';
    const item = this.items.find((i) => i.id === this.focusId);
    if (!item) return false;
    if (item.enabled) item.activate(null);
    return true;
  }

  // --- pointer ---------------------------------------------------------------------------------------------------------

  private itemAt(x: number, y: number): MenuItem | null {
    const items = this.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i] as MenuItem;
      if (containsPoint(item.rect, x, y)) return item;
    }
    return null;
  }

  /** A mouse click or a touch landing at (x, y) in game pixels. Returns true when it hit an item (so nothing else may react to it). */
  pointerDown(x: number, y: number, kind: PointerKind): boolean {
    const item = this.itemAt(x, y);
    if (!item) return false;
    this.focusId = item.id;
    this.source = kind === 'touch' ? 'touch' : 'pointer';
    if (this.clock() < this.lockUntil) return true; // swallowed: the same tap, or its double, as the one that opened this page
    this.pressedId = item.id;
    if (item.enabled) item.activate({ x, y });
    return true;
  }

  /** A mouse moving over the menu: the item under it takes the focus, so keys and mouse share one highlight. */
  pointerMove(x: number, y: number, kind: PointerKind): void {
    if (kind !== 'mouse') return;
    const item = this.itemAt(x, y);
    if (item && item.id !== this.focusId) {
      this.focusId = item.id;
      this.source = 'pointer';
    }
  }

  pointerUp(): void {
    this.pressedId = null;
  }

  // --- debugging ------------------------------------------------------------------------------------------------------

  /** Where everything is, in game pixels. Lets browser tests tap a button by its label instead of by coordinates. */
  snapshot(): MenuSnapshot {
    return {
      page: this.stack.current,
      depth: this.stack.depth,
      focus: this.focusId,
      focusVisible: this.focusVisible,
      items: this.items.map((i) => ({
        id: i.id,
        label: i.label,
        x: i.rect.x,
        y: i.rect.y,
        w: i.rect.w,
        h: i.rect.h,
        enabled: i.enabled,
        focused: i.id === this.focusId,
        zones: (i.zones?.() ?? []).map((z) => ({ name: z.name, x: z.rect.x, y: z.rect.y, w: z.rect.w, h: z.rect.h })),
      })),
    };
  }

  destroy(): void {
    this.page?.dispose?.();
    this.page = null;
    this.pageListeners.clear();
  }
}
