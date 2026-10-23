import type Phaser from 'phaser';
import { ConfirmTap } from '../confirmTap';
import { addText, COLORS, type TextOptions } from '../text';
import type { Rect } from './focusNav';
import type { MenuItem } from './menuController';

/**
 * The drawn pieces of a menu page: buttons, slider rows and segmented choices, plus `PageKit`, the bag that owns everything one page
 * made so it can be thrown away in one go. They only draw and report; what a press does is in `menuController.ts` and the page builders.
 *
 * The look is the game's own: a black screen, thin bright vector outlines, green for "on / chosen / go", gold for "you are here".
 * Every target is at least `MIN_TARGET` game pixels tall (about 44 CSS px on the smallest phone this game supports).
 */

/** 90 game px: about 47 CSS px on a 667x375 phone, 49 on an 844x390 one. */
export const MIN_TARGET = 90;
export const ROW_GAP = 16;

export const PALETTE = {
  fill: 0x0b1020,
  fillHot: 0x1a2440,
  fillPressed: 0x2e3d66,
  edge: 0xaab4cc,
  white: 0xffffff,
  gold: 0xffc800,
  good: 0x1d6b3a,
  goodHot: 0x2a8a4d,
  armed: 0x7a2a12,
  offFill: 0x08080c,
  offEdge: 0x555566,
} as const;

/** Type sizes in game px. At the phone's ~0.5 scale 24 is still a readable 12 CSS px; nothing the player needs is smaller than `SMALL`. */
export const TEXT = { title: 56, heading: 30, label: 30, button: 30, body: 26, small: 22, hint: 20 } as const;

type Graphics = Phaser.GameObjects.Graphics;
type Text = Phaser.GameObjects.Text;

/** How a widget is drawn right now. `focused` is already "the focus ring is visible AND this one has it". */
export interface ViewState {
  focused: boolean;
  pressed: boolean;
}

export interface Widget extends MenuItem {
  /** Redraws when something it shows (text, selection, focus, pressed) changed since last time. Cheap to call every frame. */
  sync(view: ViewState, now: number): void;
  destroy(): void;
}

type BoxLook = { fill: number; edge: number; edgeWidth: number; focusRing: boolean };

function paintBox(g: Graphics, r: Rect, look: BoxLook): void {
  g.fillStyle(look.fill, 1);
  g.fillRect(r.x, r.y, r.w, r.h);
  const w = look.edgeWidth;
  g.lineStyle(w, look.edge, 1);
  g.strokeRect(r.x + w / 2, r.y + w / 2, r.w - w, r.h - w);
  if (look.focusRing) {
    g.lineStyle(3, PALETTE.gold, 0.35);
    g.strokeRect(r.x - 5, r.y - 5, r.w + 10, r.h + 10);
  }
}

interface LookInput {
  selected?: boolean;
  enabled: boolean;
  focused: boolean;
  pressed: boolean;
  primary?: boolean;
  armed?: boolean;
}

function lookOf({ selected = false, enabled, focused, pressed, primary = false, armed = false }: LookInput): BoxLook {
  if (!enabled) return { fill: PALETTE.offFill, edge: PALETTE.offEdge, edgeWidth: 3, focusRing: false };
  const green = selected || primary;
  const fill = armed ? PALETTE.armed : pressed ? PALETTE.fillPressed : green ? (focused ? PALETTE.goodHot : PALETTE.good) : focused ? PALETTE.fillHot : PALETTE.fill;
  const edge = focused ? PALETTE.gold : armed ? PALETTE.gold : green ? PALETTE.white : PALETTE.edge;
  return { fill, edge, edgeWidth: focused ? 6 : primary ? 4 : 3, focusRing: focused };
}

/** Shrinks a Text that is too wide for its box (a long translation, a big system font) instead of letting it spill over the edge. */
function fit(text: Text, maxWidth: number): void {
  text.setScale(1);
  if (text.width > maxWidth) text.setScale(maxWidth / text.width);
}

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** The clock the menus' animated icons (the pulsing power-ups) run on: frozen at full size when the player's system asks for reduced motion. */
export function iconClock(now: number): number {
  return reducedMotion() ? 0 : now;
}

/** Owns everything one page created, so closing the page is one `destroy`. */
export class PageKit {
  readonly container: Phaser.GameObjects.Container;
  readonly widgets: Widget[] = [];
  private readonly frameHooks: Array<(now: number) => void> = [];

  constructor(
    readonly scene: Phaser.Scene,
    depth: number,
  ) {
    this.container = scene.add.container(0, 0).setDepth(depth);
  }

  text(x: number, y: number, content: string, options: TextOptions): Text {
    const t = addText(this.scene, x, y, content, options);
    this.container.add(t);
    return t;
  }

  graphics(): Graphics {
    const g = this.scene.add.graphics();
    this.container.add(g);
    return g;
  }

  /** Runs every frame while the page is open (animated icons). */
  onFrame(hook: (now: number) => void): void {
    this.frameHooks.push(hook);
  }

  add<T extends Widget>(widget: T): T {
    this.widgets.push(widget);
    return widget;
  }

  sync(focusId: string | null, focusVisible: boolean, pressedId: string | null, now: number): void {
    for (const w of this.widgets) w.sync({ focused: focusVisible && w.id === focusId, pressed: w.id === pressedId }, now);
    for (const hook of this.frameHooks) hook(now);
  }

  destroy(): void {
    for (const w of this.widgets) w.destroy();
    this.widgets.length = 0;
    this.frameHooks.length = 0;
    this.container.destroy(true);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------------------------------------------------

export interface ButtonOptions {
  id: string;
  rect: Rect;
  label: string | (() => string);
  onTap: () => void;
  size?: number;
  /** Green and bold: the one action the screen is for (PLAY, RESUME, TURN TOUCH CONTROLS ON). */
  primary?: boolean;
  /** Lit green while true (a toggle that is ON). */
  selected?: () => boolean;
  enabled?: () => boolean;
  /** Two-step: the first activation only shows `armedLabel`; a second one within a few seconds does it. For actions that cost something to do by accident. */
  confirm?: { armedLabel: string };
  /** A tiny caption under the label (`SPACE`, a key hint). */
  hint?: string;
  /** A larger caption when it explains the action rather than just naming a shortcut. */
  hintSize?: number;
  color?: string;
  /** Only a key or a controller button may press it; a click or tap does nothing (PLAY on a phone that has no touch controls, where a tap would start a run nobody can steer). */
  keysOnly?: boolean;
  /** What tests and the debug snapshot call it, when the button's drawn label is empty or decorative (a card the page draws into). */
  name?: string;
}

export class MenuButton implements Widget {
  readonly id: string;
  readonly rect: Rect;
  private readonly g: Graphics;
  private readonly text: Text;
  private readonly confirm: ConfirmTap | null;
  private shown = '';
  private key = '';
  private armed = false;
  private enabledNow = true;

  constructor(
    kit: PageKit,
    private readonly opts: ButtonOptions,
  ) {
    this.id = opts.id;
    this.rect = opts.rect;
    this.confirm = opts.confirm ? new ConfirmTap() : null;
    this.g = kit.graphics();
    const cx = this.rect.x + this.rect.w / 2;
    const cy = this.rect.y + this.rect.h / 2;
    this.text = kit.text(cx, cy - (opts.hint ? 10 : 0), '', { size: opts.size ?? TEXT.button, originX: 0.5, originY: 0.5, color: opts.color ?? COLORS.white }).setAlign('center');
    if (opts.hint) {
      const hint = kit.text(cx, this.rect.y + this.rect.h - 20, opts.hint, { size: opts.hintSize ?? TEXT.hint, originX: 0.5, originY: 0.5, color: COLORS.dim, bold: false });
      fit(hint, this.rect.w - 16); // a long hint in a narrow button shrinks instead of spilling over the edge
    }
    kit.add(this);
  }

  get label(): string {
    const label = typeof this.opts.label === 'function' ? this.opts.label() : this.opts.label;
    return this.opts.name ?? label.replace(/\n/g, ' ');
  }

  get enabled(): boolean {
    return this.opts.enabled ? this.opts.enabled() : true;
  }

  private currentLabel(): string {
    if (this.armed && this.opts.confirm) return this.opts.confirm.armedLabel;
    return typeof this.opts.label === 'function' ? this.opts.label() : this.opts.label;
  }

  activate(at: { x: number; y: number } | null): void {
    if (this.opts.keysOnly && at !== null) return;
    if (this.confirm) {
      const now = performance.now();
      if (!this.confirm.tap(now)) {
        this.armed = this.confirm.isArmed(now);
        return;
      }
      this.armed = false;
    }
    this.opts.onTap();
  }

  sync(view: ViewState, _now: number): void {
    if (this.armed && this.confirm && !this.confirm.isArmed(performance.now())) this.armed = false;
    const enabled = this.enabled;
    const selected = this.opts.selected?.() ?? false;
    const label = this.currentLabel();
    const key = `${label}|${selected}|${enabled}|${view.focused}|${view.pressed}|${this.armed}`;
    if (key === this.key) return;
    this.key = key;
    this.enabledNow = enabled;
    if (label !== this.shown) {
      this.shown = label;
      this.text.setText(label);
      fit(this.text, this.rect.w - 24);
    }
    const look = lookOf({ selected, enabled, focused: view.focused, pressed: view.pressed, primary: this.opts.primary, armed: this.armed });
    this.g.clear();
    paintBox(this.g, this.rect, look);
    this.text.setColor(!enabled ? '#7a7a88' : this.armed || (selected && view.focused) ? COLORS.heading : (this.opts.color ?? COLORS.white));
  }

  destroy(): void {
    // The kit's container destroys the display objects; nothing else to release.
  }

  /** For tests: whether the last drawn state was enabled. */
  get drawnEnabled(): boolean {
    return this.enabledNow;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Rows: a label on the left, a control on the right
// ---------------------------------------------------------------------------------------------------------------------

export const ROW_X = 40;
export const ROW_W = 1200;
const LABEL_X = 70;
const BOX = 96;
const BOX_GAP = 14;

export interface RowGeometry {
  y: number;
  /** Left edge of the control area (the label has everything to its left). */
  controlX: number;
  controlW: number;
}

/** The standard settings row: full width, `MIN_TARGET` tall, the control on the right 600 px. */
export function rowGeometry(y: number, controlW = 600, h = MIN_TARGET): { rect: Rect; control: Rect } {
  const rect = { x: ROW_X, y, w: ROW_W, h };
  return { rect, control: { x: ROW_X + ROW_W - 20 - controlW, y, w: controlW, h } };
}

abstract class RowWidget implements Widget {
  readonly id: string;
  protected readonly g: Graphics;
  protected readonly labelText: Text;
  protected key = '';

  constructor(
    kit: PageKit,
    id: string,
    readonly rect: Rect,
    protected readonly control: Rect,
    private readonly labelOf: string | (() => string),
  ) {
    this.id = id;
    this.g = kit.graphics();
    this.labelText = kit.text(LABEL_X, rect.y + rect.h / 2, '', { size: TEXT.label, originX: 0, originY: 0.5, color: COLORS.hint });
    kit.add(this);
  }

  get label(): string {
    return typeof this.labelOf === 'function' ? this.labelOf() : this.labelOf;
  }

  readonly enabled = true;

  protected rowBackground(view: ViewState): void {
    if (view.focused) {
      this.g.fillStyle(PALETTE.fillHot, 0.55);
      this.g.fillRect(this.rect.x, this.rect.y, this.rect.w, this.rect.h);
    }
  }

  /** The gold frame of the focused row, drawn last so the controls inside it do not cover it. */
  protected rowRing(view: ViewState): void {
    if (!view.focused) return;
    this.g.lineStyle(5, PALETTE.gold, 1);
    this.g.strokeRect(this.rect.x + 2.5, this.rect.y + 2.5, this.rect.w - 5, this.rect.h - 5);
  }

  protected setLabel(view: ViewState): void {
    const label = this.label;
    if (this.labelText.text !== label) this.labelText.setText(label);
    fit(this.labelText, this.control.x - LABEL_X - 20);
    this.labelText.setColor(view.focused ? COLORS.white : COLORS.hint);
  }

  abstract activate(at: { x: number; y: number } | null): void;
  abstract sync(view: ViewState, now: number): void;

  destroy(): void {
    // The kit's container destroys the display objects.
  }
}

// --- slider / stepper ----------------------------------------------------------------------------------------------------

const BAR_CELLS = 10;

export interface StepperOptions {
  id: string;
  label: string;
  y: number;
  /** The value as text (`80%`, `RANDOM`). */
  value: () => string;
  /** 0..1 fill of the bar; omit for a text stepper (`<  RANDOM  >`). */
  level?: () => number;
  /** Greyed (the music's volume while muted). */
  dim?: () => boolean;
  onAdjust: (direction: 1 | -1) => void;
  controlW?: number;
}

/** `-  [bar] 80%  +` or `<  RANDOM  >`: Left / Right (or the - / + boxes, or a tap) change it; every change applies at once. */
export class MenuStepper extends RowWidget {
  private readonly valueText: Text;
  private readonly bar: boolean;

  constructor(
    kit: PageKit,
    private readonly opts: StepperOptions,
  ) {
    const geo = rowGeometry(opts.y, opts.controlW);
    super(kit, opts.id, geo.rect, geo.control, opts.label);
    this.bar = opts.level !== undefined;
    const c = this.control;
    const my = c.y + c.h / 2;
    kit.text(c.x + BOX / 2, my, this.bar ? '-' : '<', { size: 44, originX: 0.5, originY: 0.5 });
    kit.text(c.x + c.w - BOX / 2, my, this.bar ? '+' : '>', { size: 44, originX: 0.5, originY: 0.5 });
    const valueX = this.bar ? c.x + c.w - BOX - BOX_GAP - 44 : c.x + c.w / 2;
    this.valueText = kit.text(valueX, my, '', { size: 32, originX: 0.5, originY: 0.5 });
  }

  adjust(direction: 1 | -1): boolean {
    this.opts.onAdjust(direction);
    return true;
  }

  zones(): ReadonlyArray<{ name: string; rect: Rect }> {
    const c = this.control;
    const zones = [
      { name: this.bar ? '-' : '<', rect: { x: c.x, y: c.y, w: BOX, h: c.h } },
      { name: this.bar ? '+' : '>', rect: { x: c.x + c.w - BOX, y: c.y, w: BOX, h: c.h } },
    ];
    // A text stepper's name box is a target too (it steps forward).
    if (!this.bar) zones.push({ name: 'name', rect: { x: c.x + BOX + BOX_GAP, y: c.y, w: c.w - 2 * (BOX + BOX_GAP), h: c.h } });
    return zones;
  }

  activate(at: { x: number; y: number } | null): void {
    const c = this.control;
    if (at === null) {
      if (!this.bar) this.opts.onAdjust(1); // Enter on a text stepper steps to the next entry; a slider needs Left / Right
      return;
    }
    if (at.x >= c.x && at.x <= c.x + BOX + BOX_GAP / 2) this.opts.onAdjust(-1);
    else if (at.x >= c.x + c.w - BOX - BOX_GAP / 2 && at.x <= c.x + c.w) this.opts.onAdjust(1);
    else if (!this.bar && at.x >= c.x && at.x <= c.x + c.w) this.opts.onAdjust(1); // tapping the name itself steps forward
  }

  sync(view: ViewState, _now: number): void {
    const value = this.opts.value();
    const level = this.opts.level?.() ?? 0;
    const dim = this.opts.dim?.() ?? false;
    const key = `${value}|${level}|${dim}|${view.focused}|${view.pressed}`;
    if (key === this.key) return;
    this.key = key;
    this.setLabel(view);
    if (this.valueText.text !== value) this.valueText.setText(value);
    this.valueText.setColor(dim ? '#7a7a88' : COLORS.white);
    fit(this.valueText, this.bar ? 90 : this.control.w - 2 * (BOX + BOX_GAP) - 20);

    this.g.clear();
    this.rowBackground(view);
    const c = this.control;
    const box = (x: number): void => paintBox(this.g, { x, y: c.y, w: BOX, h: c.h }, lookOf({ enabled: true, focused: false, pressed: false }));
    box(c.x);
    box(c.x + c.w - BOX);
    if (this.bar) {
      const left = c.x + BOX + BOX_GAP;
      const cell = 22;
      const gap = 5;
      const filled = Math.round(Math.min(1, Math.max(0, level)) * BAR_CELLS);
      for (let i = 0; i < BAR_CELLS; i++) {
        const on = i < filled;
        this.g.fillStyle(on ? (dim ? 0x555566 : PALETTE.white) : 0x2a3350, 1);
        this.g.fillRect(left + i * (cell + gap), c.y + c.h / 2 - 17, cell, 34);
      }
    } else {
      paintBox(this.g, { x: c.x + BOX + BOX_GAP, y: c.y, w: c.w - 2 * (BOX + BOX_GAP), h: c.h }, lookOf({ enabled: true, focused: false, pressed: false }));
    }
    this.rowRing(view);
  }
}

// --- segmented choice -----------------------------------------------------------------------------------------------------

export interface ChoiceOptions {
  id: string;
  label: string;
  y: number;
  options: readonly string[];
  selected: () => number;
  /** Applies the choice at once. */
  onSelect: (index: number) => void;
  controlW?: number;
  size?: number;
  /** A bare segmented control with no row and no label, filling this rectangle (the 1 / 2 PLAYERS switch on the title screen). */
  frame?: Rect;
}

/** `[ ON | OFF ]`: every option is a full-height target and the chosen one is lit green; Left / Right pick the neighbour. */
export class MenuChoice extends RowWidget {
  private readonly segmentText: Text[];

  constructor(
    kit: PageKit,
    private readonly opts: ChoiceOptions,
  ) {
    const geo = opts.frame ? { rect: opts.frame, control: opts.frame } : rowGeometry(opts.y, opts.controlW);
    super(kit, opts.id, geo.rect, geo.control, opts.label);
    const n = opts.options.length;
    const w = this.control.w / n;
    this.segmentText = opts.options.map((name, i) =>
      kit.text(this.control.x + w * i + w / 2, this.control.y + this.control.h / 2, name, { size: opts.size ?? TEXT.button, originX: 0.5, originY: 0.5 }).setAlign('center'),
    );
    this.segmentText.forEach((t) => fit(t, w - 16));
  }

  adjust(direction: 1 | -1): boolean {
    const next = this.opts.selected() + direction;
    if (next < 0 || next >= this.opts.options.length) return false;
    this.opts.onSelect(next);
    return true;
  }

  zones(): ReadonlyArray<{ name: string; rect: Rect }> {
    const w = this.control.w / this.opts.options.length;
    return this.opts.options.map((name, i) => ({ name, rect: { x: this.control.x + w * i, y: this.control.y, w, h: this.control.h } }));
  }

  activate(at: { x: number; y: number } | null): void {
    const n = this.opts.options.length;
    if (at === null) {
      this.opts.onSelect((this.opts.selected() + 1) % n);
      return;
    }
    const c = this.control;
    if (at.x < c.x || at.x > c.x + c.w) return;
    this.opts.onSelect(Math.min(n - 1, Math.floor(((at.x - c.x) / c.w) * n)));
  }

  sync(view: ViewState, _now: number): void {
    const chosen = this.opts.selected();
    const key = `${chosen}|${view.focused}|${view.pressed}`;
    if (key === this.key) return;
    this.key = key;
    const bare = this.opts.frame !== undefined;
    if (!bare) this.setLabel(view);
    this.g.clear();
    if (!bare) this.rowBackground(view);
    const n = this.opts.options.length;
    const w = this.control.w / n;
    this.opts.options.forEach((_, i) => {
      const seg = { x: this.control.x + w * i, y: this.control.y, w: w - (i < n - 1 ? 4 : 0), h: this.control.h };
      paintBox(this.g, seg, lookOf({ selected: i === chosen, enabled: true, focused: bare && view.focused, pressed: false }));
      this.segmentText[i]?.setColor(i === chosen ? COLORS.heading : COLORS.white);
    });
    if (!bare) this.rowRing(view);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Text field (the DOM <input> from ui/nicknameInput.ts lies on top of its frame)
// ---------------------------------------------------------------------------------------------------------------------

/** The part of the DOM input a field widget needs; `NicknameInput` is the real one. */
export interface FieldInput {
  readonly hasFocus: boolean;
  show(rect: Rect): void;
  focus(): void;
  place(): void;
}

export interface FieldOptions {
  id: string;
  /** What tests and the debug snapshot call it. */
  name: string;
  rect: Rect;
  input: FieldInput;
}

/**
 * A focusable frame for a text field. The typed text is drawn by the DOM input itself (so the phone's keyboard, selection and screen
 * readers all work); this widget only draws the frame and hands over to the input when it is pressed or activated (Enter, A, a tap that
 * did not already land on the input). Keys typed while the input has the focus never reach the menu (see `NicknameInput`).
 */
export class MenuField implements Widget {
  readonly id: string;
  readonly rect: Rect;
  readonly enabled = true;
  private readonly g: Graphics;
  private key = '';

  constructor(
    kit: PageKit,
    private readonly opts: FieldOptions,
  ) {
    this.id = opts.id;
    this.rect = opts.rect;
    this.g = kit.graphics();
    kit.add(this);
    opts.input.show(opts.rect);
  }

  get label(): string {
    return this.opts.name;
  }

  activate(): void {
    this.opts.input.focus();
  }

  sync(view: ViewState, _now: number): void {
    this.opts.input.place(); // every frame: the canvas may have been resized or the keyboard opened since the last one
    const hot = view.focused || this.opts.input.hasFocus;
    const key = `${hot}`;
    if (key === this.key) return;
    this.key = key;
    this.g.clear();
    paintBox(this.g, this.rect, { fill: PALETTE.fill, edge: hot ? PALETTE.gold : PALETTE.edge, edgeWidth: hot ? 6 : 3, focusRing: hot });
  }

  destroy(): void {
    // The kit's container destroys the display objects; the DOM input outlives the page on purpose (see NicknameInput).
  }
}
