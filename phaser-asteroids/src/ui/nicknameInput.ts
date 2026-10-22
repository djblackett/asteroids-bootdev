import type Phaser from 'phaser';
import { SCREEN_WIDTH } from '../core/constants';
import './nickname.css';

/**
 * The one real text field in the game: where a ranked player types a nickname. It is a plain DOM `<input>` laid exactly over the
 * canvas field the result page draws, because only a real input gives a phone its on-screen keyboard reliably (the browser opens it
 * only for a tap that lands on the input itself), plus autocorrect off, IME, paste, selection and screen-reader support.
 *
 * Its lifetime is the scene's, not the page's: the result page is rebuilt whenever the submission state changes, and the typed name,
 * the focus and the keyboard must survive that. Every frame the page calls `place()`, which follows the canvas through resizes and
 * rotations, and "docks" the field just above the on-screen keyboard while it is focused, so what is being typed is never hidden.
 *
 * Keys typed in the field never reach the game: arrows, Space, Enter and letters are text here, not controls.
 */

export interface GameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The field, as the pages see it. */
export interface NameField {
  readonly value: string;
  readonly hasFocus: boolean;
  show(rect: GameRect): void;
  hide(): void;
  focus(): void;
  blur(): void;
  /** Follows the canvas; call every frame while shown. Cheap when nothing moved. */
  place(): void;
  setInvalid(invalid: boolean): void;
}

/** A keyboard this much shorter than the layout viewport is "open" (a desktop's browser chrome changes are far smaller). */
const KEYBOARD_MIN_PX = 120;
const MIN_FONT_PX = 16; // below 16 px iOS Safari zooms the page when the field takes focus

export class NicknameInput implements NameField {
  private readonly el: HTMLInputElement;
  private readonly live: HTMLElement;
  private rect: GameRect | null = null;
  private placed = '';
  private focused = false;
  private readonly cleanup: Array<() => void> = [];

  constructor(
    private readonly game: Phaser.Game,
    initial: string,
    /** Enter / the phone's "Done" key. */
    private readonly onEnter: () => void,
    private readonly doc: Document = document,
    /** Select the remembered name when the field is focused, so typing replaces it. Not on a phone, where the selection handles get in the way. */
    private readonly selectOnFocus = true,
  ) {
    this.el = this.doc.createElement('input');
    this.el.className = 'nick-input';
    this.el.type = 'text';
    this.el.value = initial;
    this.el.maxLength = 32; // room to paste something too long and be told so, rather than silently losing characters
    this.el.autocomplete = 'off';
    this.el.spellcheck = false;
    this.el.enterKeyHint = 'done';
    this.el.inputMode = 'text';
    this.el.setAttribute('autocapitalize', 'words');
    this.el.setAttribute('autocorrect', 'off');
    this.el.placeholder = 'YOUR NICKNAME';
    this.el.setAttribute('aria-label', 'Nickname for the leaderboard');
    this.el.setAttribute('data-testid', 'nickname-input');
    this.el.hidden = true;
    this.doc.body.appendChild(this.el);

    // Spoken status updates for screen-reader users ("Score verified. Weekly rank 3."): the canvas itself is invisible to them.
    this.live = this.doc.createElement('div');
    this.live.className = 'nick-sr';
    this.live.setAttribute('role', 'status');
    this.live.setAttribute('aria-live', 'polite');
    this.doc.body.appendChild(this.live);

    const stop = (event: Event): void => event.stopPropagation();
    this.listen('keydown', (event) => {
      event.stopPropagation(); // the game's key handlers listen on the window: typing must not steer, pause or retry
      const key = (event as KeyboardEvent).key;
      if (key === 'Enter') {
        event.preventDefault();
        this.el.blur(); // dismisses the phone keyboard; what was typed stays in the field
        this.onEnter();
      } else if (key === 'Escape') {
        this.el.blur();
      }
    });
    this.listen('keyup', stop);
    this.listen('keypress', stop);
    this.listen('focus', () => (this.focused = true));
    this.listen('blur', () => (this.focused = false));

    const vv = this.doc.defaultView?.visualViewport;
    for (const [target, type] of [
      [this.doc.defaultView, 'resize'],
      [this.doc.defaultView, 'orientationchange'],
      [vv, 'resize'],
      [vv, 'scroll'],
    ] as const) {
      const handler = (): void => this.place();
      target?.addEventListener(type, handler);
      this.cleanup.push(() => target?.removeEventListener(type, handler));
    }
  }

  private listen(type: string, handler: (event: Event) => void): void {
    this.el.addEventListener(type, handler);
    this.cleanup.push(() => this.el.removeEventListener(type, handler));
  }

  get value(): string {
    return this.el.value;
  }

  get hasFocus(): boolean {
    return this.focused;
  }

  show(rect: GameRect): void {
    this.rect = rect;
    this.el.hidden = false;
    this.place();
  }

  hide(): void {
    if (this.el.hidden) return;
    this.el.blur();
    this.el.hidden = true;
    this.rect = null;
    this.placed = '';
  }

  focus(): void {
    if (this.el.hidden) return;
    this.el.focus();
    if (this.selectOnFocus) this.el.select();
  }

  blur(): void {
    this.el.blur();
  }

  setInvalid(invalid: boolean): void {
    this.el.classList.toggle('nick-invalid', invalid);
    this.el.setAttribute('aria-invalid', String(invalid));
  }

  /** Text for screen readers only (the canvas shows the same words to everyone else). */
  announce(text: string): void {
    if (this.live.textContent !== text) this.live.textContent = text;
  }

  place(): void {
    const rect = this.rect;
    if (!rect || this.el.hidden) return;
    // The "rotate your phone" prompt covers the screen in portrait: the field steps aside (hidden elements cannot take focus) and keeps its text.
    const portrait = this.doc.body.classList.contains('tc-portrait');
    this.el.style.visibility = portrait ? 'hidden' : 'visible';
    const canvas = this.game.canvas.getBoundingClientRect();
    const scale = canvas.width / SCREEN_WIDTH;
    if (!(scale > 0)) return;

    let left = canvas.left + rect.x * scale;
    let top = canvas.top + rect.y * scale;
    let width = rect.w * scale;
    let height = rect.h * scale;
    const font = Math.max(MIN_FONT_PX, Math.round(rect.h * 0.36 * scale));

    // Keyboard up: keep the field in the part of the screen that is still visible, above the keyboard, instead of behind it.
    const win = this.doc.defaultView;
    const vv = win?.visualViewport;
    if (this.focused && win && vv && win.innerHeight - vv.height > KEYBOARD_MIN_PX) {
      height = Math.max(height, 44);
      width = Math.min(Math.max(width, 240), vv.width - 24);
      left = vv.offsetLeft + (vv.width - width) / 2;
      top = vv.offsetTop + vv.height - height - 10;
    }

    const key = `${left.toFixed(1)}|${top.toFixed(1)}|${width.toFixed(1)}|${height.toFixed(1)}|${font}`;
    if (key === this.placed) return;
    this.placed = key;
    const s = this.el.style;
    s.left = `${left}px`;
    s.top = `${top}px`;
    s.width = `${width}px`;
    s.height = `${height}px`;
    s.fontSize = `${font}px`;
  }

  destroy(): void {
    for (const stop of this.cleanup) stop();
    this.cleanup.length = 0;
    this.el.remove();
    this.live.remove();
  }
}
