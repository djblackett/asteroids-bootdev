import { fullscreenButtonSpec, HOME_SCREEN_TIP, type FullscreenController, type FullscreenState } from '../input/fullscreen';

/**
 * The small system controls that live outside the game: the Fullscreen button (top right, shown over the title and pause screens
 * only) and the Home Screen tip it opens where fullscreen is impossible. Plain DOM, not Phaser objects, for one reason: the
 * browser only grants fullscreen from a genuine user-activation event, and a DOM `pointerup` is exactly that, handled
 * synchronously. Phaser queues its input and delivers it on the next frame, which is too late for some browsers.
 *
 * Touch: the action runs on `pointerup` when the finger is still on the button (a slide off cancels). Mouse: on `click`. A touch
 * never also sends a click (the touch events are cancelled below), and a short guard covers a browser that does.
 */

const FAILURE_SHOWN_MS = 2600;
const CLICK_AFTER_TOUCH_MS = 800;

function make<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, parent: Node, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  parent.appendChild(element);
  return element;
}

export class SystemOverlay {
  private readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly tip: HTMLElement;
  private shown = false;
  private action: 'toggle' | 'tip' = 'toggle';
  private armed: number | null = null;
  private lastTouchTap = -Infinity;
  private failureTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly stopFullscreenEvents: () => void;
  // Last written values: a write is skipped when nothing changed.
  private label = '';
  private visible = true;
  private warning = false;

  constructor(
    doc: Document,
    private readonly fullscreen: FullscreenController,
  ) {
    this.root = make(doc, 'div', doc.body, 'tc-system');
    this.button = make(doc, 'button', this.root, 'tc-sys-btn');
    this.button.type = 'button';
    this.button.tabIndex = -1; // never takes keyboard focus: Space must keep starting the game
    this.onTap(this.button, () => this.activate());

    this.tip = make(doc, 'div', this.root, 'tc-tip');
    this.tip.setAttribute('role', 'dialog');
    this.tip.setAttribute('aria-label', HOME_SCREEN_TIP.title);
    const panel = make(doc, 'div', this.tip, 'tc-tip-panel');
    make(doc, 'div', panel, 'tc-tip-title', HOME_SCREEN_TIP.title);
    for (const line of HOME_SCREEN_TIP.lines) make(doc, 'p', panel, 'tc-tip-text', line);
    const ok = make(doc, 'button', panel, 'tc-sys-btn tc-tip-ok', 'OK');
    ok.type = 'button';
    ok.tabIndex = -1;
    this.onTap(ok, () => this.setTip(false));

    // Phaser processes touches on the window unless they are default-prevented; these controls' touches are theirs alone.
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      this.root.addEventListener(type, (event) => void (event.cancelable && event.preventDefault()), { passive: false });
    }

    this.stopFullscreenEvents = fullscreen.onChange((state) => this.render(state));
    this.render(fullscreen.state);
  }

  /** Shown over the title and pause screens only; hiding also closes the tip. */
  setShown(shown: boolean): void {
    if (shown === this.shown) return;
    this.shown = shown;
    this.root.classList.toggle('tc-menu', shown);
    if (!shown) this.setTip(false);
    this.render(this.fullscreen.state);
  }

  get isTipOpen(): boolean {
    return this.tip.classList.contains('tc-tip-open');
  }

  private activate(): void {
    if (this.action === 'tip') this.setTip(true);
    else void this.fullscreen.toggle(); // called synchronously, inside the user's tap
  }

  private setTip(open: boolean): void {
    this.tip.classList.toggle('tc-tip-open', open);
  }

  private render(state: FullscreenState): void {
    const spec = fullscreenButtonSpec(state);
    this.action = spec.action;
    if (spec.visible !== this.visible) {
      this.visible = spec.visible;
      this.button.classList.toggle('tc-hidden', !spec.visible);
    }
    if (spec.label !== this.label) {
      this.label = spec.label;
      this.button.textContent = spec.label;
    }
    if (spec.warning !== this.warning) {
      this.warning = spec.warning;
      this.button.classList.toggle('tc-warn', spec.warning);
    }
    if (spec.warning && this.failureTimer === null) {
      this.failureTimer = setTimeout(() => {
        this.failureTimer = null;
        this.fullscreen.clearFailure();
      }, FAILURE_SHOWN_MS);
    }
  }

  private onTap(element: HTMLElement, tap: () => void): void {
    element.addEventListener('pointerdown', (event) => {
      if (event.button > 0) return;
      event.preventDefault(); // no focus, no compatibility mouse events
      this.armed = event.pointerId;
    });
    element.addEventListener('pointerup', (event) => {
      if (this.armed !== event.pointerId) return;
      this.armed = null;
      if (event.pointerType === 'mouse') return; // a mouse activates on `click`
      const r = element.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) return;
      this.lastTouchTap = performance.now();
      tap();
    });
    element.addEventListener('pointercancel', (event) => {
      if (this.armed === event.pointerId) this.armed = null;
    });
    element.addEventListener('click', () => {
      if (performance.now() - this.lastTouchTap < CLICK_AFTER_TOUCH_MS) return;
      tap();
    });
  }

  destroy(): void {
    this.stopFullscreenEvents();
    if (this.failureTimer !== null) clearTimeout(this.failureTimer);
    this.root.remove();
  }
}
