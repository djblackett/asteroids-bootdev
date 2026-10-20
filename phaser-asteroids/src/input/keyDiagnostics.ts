import type { PlayerInput } from '../core/player';
import { readPlayerInput, type KeyScheme } from './keyboardControls';

/**
 * Development-only keyboard diagnostics. They are off unless the page URL contains `?keydebug`; without it nothing
 * in this file runs, no listener is added and no element is created.
 *
 * It answers "where did my key go?" by showing each stage side by side:
 *   1. raw browser events        - what `window` actually received (`KeyboardEvent.code`, `repeat`)
 *   2. the game's held-key set   - what gameplay reads (`HeldKeys`)
 *      and Phaser's own Key state, for comparison with how the game used to read input
 *   3. the `PlayerInput`         - what was handed to `GameSim.step()`
 *   4. the simulation's reaction - rotation, boost lock-out, shot cooldown
 * A key that is held but missing from stage 1 never reached the page: that is the keyboard, OS or browser, not the game.
 */
export function keyDiagnosticsEnabled(search: string): boolean {
  return new URLSearchParams(search).has('keydebug');
}

/** Maps `KeyboardEvent.code` to the name Phaser's `addKey` understands, for the keys the game reads. */
export const PHASER_KEY_NAMES: Readonly<Record<string, string>> = {
  KeyW: 'W',
  KeyA: 'A',
  KeyS: 'S',
  KeyD: 'D',
  KeyE: 'E',
  Space: 'SPACE',
  ShiftLeft: 'SHIFT',
  ShiftRight: 'SHIFT',
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  Enter: 'ENTER',
  Period: 'PERIOD',
  Semicolon: 'SEMICOLON',
  KeyI: 'I',
  KeyJ: 'J',
  KeyK: 'K',
  KeyL: 'L',
  KeyO: 'O',
  KeyU: 'U',
};

export interface RawKeyEvent {
  type: 'keydown' | 'keyup';
  code: string;
  repeat: boolean;
  timeStamp: number;
}

export interface SimSnapshot {
  rotation: number;
  boostActive: boolean;
  canShoot: boolean;
  shootTimer: number;
  shots: number;
}

export interface DiagnosticFrame {
  /** Held keys as Phaser's own `Key` objects report them (Phaser names, e.g. `SPACE`). */
  phaserHeld: readonly string[];
  /** Held keys as `HeldKeys` reports them. */
  trackerHeld: ReadonlySet<string>;
  /** The input that was handed to `GameSim.step()` this frame (Player 1's in a two-player game). */
  input: PlayerInput;
  /** Player 2's input in a two-player game. */
  input2?: PlayerInput;
  sim: SimSnapshot;
  /** Player 2's side of the simulation snapshot in a two-player game. */
  sim2?: SimSnapshot;
}

const sorted = (values: Iterable<string>): string[] => [...values].sort();
const list = (values: Iterable<string>): string => sorted(values).join(' ') || '-';
const diff = (a: Iterable<string>, b: ReadonlySet<string>): string[] => sorted([...a].filter((x) => !b.has(x)));

/** How much history the panel keeps, and a hard cap so memory stays bounded however fast keys arrive. */
export const HISTORY_WINDOW_MS = 10_000;
export const HISTORY_MAX_ENTRIES = 1500;

/** One line of the rolling history. `t` is `performance.now()`-style milliseconds. */
export type HistoryEntry =
  | { t: number; kind: 'key'; type: RawKeyEvent['type']; code: string; repeat: boolean; rawHeld: string[] }
  | { t: number; kind: 'note'; text: string }
  | {
      t: number;
      kind: 'state';
      rawHeld: string[];
      gameHeld: string[];
      input: PlayerInput;
      input2?: PlayerInput;
      boostActive: boolean;
      canShoot: boolean;
    };

const flag = (value: boolean | undefined): number => (value ? 1 : 0);
const inputText = (input: PlayerInput): string =>
  `rotate=${input.rotate} move=${input.move} shoot=${flag(input.shoot)} laser=${flag(input.laser)} boost=${flag(input.boost)}`;

/**
 * Event log, rolling history and freeze/capture state. Pure (no DOM), so the verdict and history logic are unit tested.
 *
 * History holds the last ~10 s of raw key events, window blur / focus notes, and a "state" entry each time the held keys
 * or the input handed to `GameSim.step()` changes (not one per frame, so it stays small). Recording stops while frozen:
 * releasing keys, pressing a screenshot shortcut or switching windows then cannot erase the evidence.
 */
export class KeyDiagnostics {
  private readonly raw = new Set<string>();
  private readonly history: HistoryEntry[] = [];
  private peak = 0;
  private lastSignature = '';
  private latest = 0;
  private frozenText: string | null = null;
  private frozenAt = 0;

  constructor(
    private readonly scheme: KeyScheme,
    /** Key events shown in the live panel. */
    private readonly maxEvents = 10,
    private readonly windowMs = HISTORY_WINDOW_MS,
    private readonly maxEntries = HISTORY_MAX_ENTRIES,
    /** Extra header lines for shared reports (capture time, page, browser...), read each time a report is built. */
    private readonly meta: () => readonly string[] = () => [],
    /** Player 2's key scheme in a two-player game. */
    private readonly scheme2: KeyScheme | null = null,
  ) {}

  get frozen(): boolean {
    return this.frozenText !== null;
  }

  /** The report text preserved at the moment of freezing, or null while live. */
  get frozenReport(): string | null {
    return this.frozenText;
  }

  get historyLength(): number {
    return this.history.length;
  }

  get rawHeld(): ReadonlySet<string> {
    return this.raw;
  }

  /**
   * Feed every raw `keydown` / `keyup` the window receives. The raw held set always follows the real keyboard (so it is
   * correct again the moment the capture is cleared); only the history stops growing while frozen.
   */
  record(event: RawKeyEvent): void {
    if (event.type === 'keydown') this.raw.add(event.code);
    else this.raw.delete(event.code);
    this.peak = Math.max(this.peak, this.raw.size);
    if (this.frozen) return;
    this.add({ t: event.timeStamp, kind: 'key', type: event.type, code: event.code, repeat: event.repeat, rawHeld: sorted(this.raw) });
  }

  /** Free-text marker in the timeline (window blur / focus...). Ignored while frozen. */
  note(text: string, t: number): void {
    if (!this.frozen) this.add({ t, kind: 'note', text });
  }

  /** Browser blur / hidden tab: the browser will not report releases, so the raw view forgets too. */
  forgetHeld(): void {
    this.raw.clear();
  }

  /** Call once per frame. Appends a history entry only when the held keys or the input changed. */
  observe(frame: DiagnosticFrame, t: number): void {
    if (this.frozen) return;
    this.latest = t;
    const gameHeld = sorted(frame.trackerHeld);
    const signature = `${gameHeld.join(',')}|${sorted(this.raw).join(',')}|${inputText(frame.input)}|${frame.input2 ? inputText(frame.input2) : ''}|${flag(frame.sim.boostActive)}${flag(frame.sim.canShoot)}`;
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.add({
        t,
        kind: 'state',
        rawHeld: sorted(this.raw),
        gameHeld,
        input: { ...frame.input },
        ...(frame.input2 ? { input2: { ...frame.input2 } } : {}),
        boostActive: frame.sim.boostActive,
        canShoot: frame.sim.canShoot,
      });
    } else {
      this.prune();
    }
  }

  /** Preserves the history and the current diagnostic state. Recording stops until `clearCapture`. */
  freeze(frame: DiagnosticFrame, t: number): void {
    if (this.frozen) return;
    this.observe(frame, t);
    this.frozenAt = t;
    this.frozenText = this.fullReport(frame, t);
  }

  /** Explicit reset: forgets the history and the frozen capture and resumes live recording. */
  clearCapture(): void {
    this.history.length = 0;
    this.frozenText = null;
    this.lastSignature = '';
    this.peak = this.raw.size;
  }

  private add(entry: HistoryEntry): void {
    this.history.push(entry);
    this.latest = Math.max(this.latest, entry.t);
    this.prune();
  }

  private prune(): void {
    const oldest = this.latest - this.windowMs;
    let drop = 0;
    while (drop < this.history.length && (this.history[drop] as HistoryEntry).t < oldest) drop++;
    drop = Math.max(drop, this.history.length - this.maxEntries);
    if (drop > 0) this.history.splice(0, drop);
  }

  /** Which stage first goes wrong, in plain words. */
  verdict(frame: DiagnosticFrame): string {
    const rawNames = new Set([...this.raw].map((code) => PHASER_KEY_NAMES[code]).filter((n): n is string => !!n));
    const lostByTracker = diff(this.raw, frame.trackerHeld);
    const extraInTracker = diff(frame.trackerHeld, this.raw);
    if (lostByTracker.length > 0 || extraInTracker.length > 0) {
      return `STAGE 2 PROBLEM - the game's held set differs from the raw events (missing: ${list(lostByTracker)}; stuck: ${list(extraInTracker)})`;
    }
    const rawHeld = { isAnyDown: (codes: readonly string[]) => codes.some((code) => this.raw.has(code)) };
    const checks: Array<[string, KeyScheme, PlayerInput | undefined]> = [['', this.scheme, frame.input]];
    if (this.scheme2) checks.push(['P2 ', this.scheme2, frame.input2]);
    for (const [who, scheme, actual] of checks) {
      if (!actual) continue;
      const expected = readPlayerInput(rawHeld, scheme);
      const mismatched = (Object.keys(expected) as (keyof PlayerInput)[]).filter((key) => expected[key] !== actual[key]);
      if (mismatched.length > 0) return `STAGE 3 PROBLEM - ${who}input mapping differs from the keys held: ${mismatched.join(', ')}`;
    }
    if (frame.input.shoot && frame.sim.boostActive) return 'OK - SPACE is held but the cannon is locked while boosting (as in the Python game)';
    if (frame.input.shoot && !frame.sim.canShoot) return 'OK - SPACE is held but shooting is disabled for the first moments of a run';
    const phaserOnly = diff(frame.phaserHeld, rawNames);
    const phaserMissing = diff(rawNames, new Set(frame.phaserHeld));
    const phaserNote =
      phaserOnly.length + phaserMissing.length > 0
        ? ` (Phaser's own Key state differs: missing ${list(phaserMissing)}, extra ${list(phaserOnly)}; gameplay no longer reads it)`
        : '';
    return `OK - every key the browser reported reached the simulation${phaserNote}`;
  }

  /** The state block: the four stages, the verdict and a short event list. This is the live panel text. */
  report(frame: DiagnosticFrame): string {
    const { input, sim } = frame;
    const recent = this.history.filter((e): e is Extract<HistoryEntry, { kind: 'key' }> => e.kind === 'key').slice(-this.maxEvents);
    const lines = [
      'KEY DIAGNOSTICS (?keydebug)',
      `1 raw browser held : ${list(this.raw)}   (peak at once: ${this.peak})`,
      `2 game held set    : ${list(frame.trackerHeld)}`,
      `  phaser Key held  : ${list(frame.phaserHeld)}`,
      `3 GameSim input${frame.input2 ? ' P1' : '   '}: ${inputText(input)}`,
      ...(frame.input2 ? [`3 GameSim input P2: ${inputText(frame.input2)}`] : []),
      `4 sim${frame.input2 ? ' P1' : '   '}          : rot=${sim.rotation.toFixed(0)} boostActive=${flag(sim.boostActive)} canShoot=${flag(sim.canShoot)} shootTimer=${sim.shootTimer.toFixed(2)} shots=${sim.shots}`,
      ...(frame.sim2
        ? [`4 sim P2          : rot=${frame.sim2.rotation.toFixed(0)} boostActive=${flag(frame.sim2.boostActive)} canShoot=${flag(frame.sim2.canShoot)} shootTimer=${frame.sim2.shootTimer.toFixed(2)}`]
        : []),
      `verdict: ${this.verdict(frame)}`,
      'A held key missing from line 1 never reached the page (keyboard / OS limit), not the game.',
      'recent events (newest last):',
      ...recent.map((e) => `  ${e.type === 'keydown' ? 'v' : '^'} ${e.code.padEnd(11)} repeat=${e.repeat ? 'yes' : 'no '} t=${e.t.toFixed(0)}ms`),
    ];
    return lines.join('\n');
  }

  /** The timeline, oldest first, with times in seconds before `at`. */
  timeline(at: number): string[] {
    if (this.history.length === 0) return ['  (nothing recorded yet)'];
    return this.history.map((e) => {
      const when = `${(-(at - e.t) / 1000).toFixed(3)}s`.padStart(9);
      if (e.kind === 'key') {
        return `${when}  ${e.type === 'keydown' ? 'v keydown' : '^ keyup  '} ${e.code.padEnd(11)} repeat=${e.repeat ? 'yes' : 'no '} raw held=[${e.rawHeld.join(' ')}]`;
      }
      if (e.kind === 'note') return `${when}  ! ${e.text}`;
      return `${when}  INPUT    ${inputText(e.input)}${e.input2 ? `  P2: ${inputText(e.input2)}` : ''}  | raw=[${e.rawHeld.join(' ')}] game=[${e.gameHeld.join(' ')}] boostActive=${flag(e.boostActive)} canShoot=${flag(e.canShoot)}`;
    });
  }

  /** The shareable report: header, the state at `t`, and the rolling history. */
  fullReport(frame: DiagnosticFrame, t: number): string {
    const keyCount = this.history.filter((e) => e.kind === 'key').length;
    return [
      'KEY DIAGNOSTIC REPORT',
      ...this.meta(),
      `history: last ${(this.windowMs / 1000).toFixed(0)} s before the capture (${this.history.length} entries, ${keyCount} raw key events)`,
      '',
      '-- state at capture --',
      this.report(frame),
      '',
      `-- timeline (time = seconds before the capture; v keydown, ^ keyup, INPUT = held keys / PlayerInput changed) --`,
      ...this.timeline(t),
    ].join('\n');
  }

  /** What "Copy" and the frozen panel use: the preserved report when frozen, otherwise a fresh one. */
  reportForSharing(frame: DiagnosticFrame, t: number): string {
    return this.frozenText ?? this.fullReport(frame, t);
  }

  /** Seconds-before-capture of the freeze, for the status line. */
  get frozenAtMs(): number {
    return this.frozenAt;
  }
}

export interface MountedDiagnostics {
  update(frame: DiagnosticFrame): void;
  destroy(): void;
}

/** Copies text with the async Clipboard API, falling back to a hidden textarea + execCommand (works over plain http). */
async function copyText(win: Window, text: string): Promise<boolean> {
  try {
    await win.navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = win.document.createElement('textarea');
    area.value = text;
    area.style.cssText = 'position:fixed;left:-9999px;top:0';
    win.document.body.appendChild(area);
    area.select();
    try {
      return win.document.execCommand('copy');
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

/** Live panel refresh rate. Rendering the text every frame would cost more than the diagnostics are worth. */
const PANEL_REFRESH_MS = 100;

/** Creates the panel and the raw listeners. Call only when `keyDiagnosticsEnabled` is true; `destroy` undoes everything. */
export function mountKeyDiagnostics(win: Window, scheme: KeyScheme, scheme2: KeyScheme | null = null): MountedDiagnostics {
  const doc = win.document;
  const meta = (): string[] => [`captured: ${new Date().toISOString()}`, `page: ${win.location.href}`, `browser: ${win.navigator.userAgent}`];
  const diagnostics = new KeyDiagnostics(scheme, 10, HISTORY_WINDOW_MS, HISTORY_MAX_ENTRIES, meta, scheme2);

  const root = doc.createElement('div');
  root.setAttribute('data-keydebug', '');
  // The panel ignores the mouse except for its buttons and, once frozen, its scrollable text.
  root.style.cssText =
    'position:fixed;top:8px;right:8px;z-index:10;max-width:88ch;pointer-events:none;display:flex;flex-direction:column;gap:4px;' +
    'font:12px/1.35 "Courier New",monospace';
  const bar = doc.createElement('div');
  bar.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;pointer-events:auto';
  const status = doc.createElement('div');
  status.style.cssText = 'color:#ffd54a;background:rgba(0,0,0,.72);padding:2px 8px';
  const text = doc.createElement('pre');
  text.style.cssText =
    'margin:0;padding:8px;background:rgba(0,0,0,.72);color:#7CFC00;white-space:pre-wrap;max-height:calc(100vh - 90px);overflow:auto';

  const makeButton = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    button.tabIndex = -1; // never focusable, so Space can never "press" it while playing
    button.style.cssText = 'font:inherit;padding:3px 8px;background:#222;color:#fff;border:1px solid #7CFC00;cursor:pointer';
    button.addEventListener('mousedown', (event) => event.preventDefault()); // keep keyboard focus off the button
    button.addEventListener('click', onClick);
    return button;
  };

  let lastFrame: DiagnosticFrame | null = null;
  let lastPaint = -Infinity;
  const now = (): number => win.performance.now();

  let shown: 'live' | 'frozen' | null = null;
  const paint = (): void => {
    if (!lastFrame) return;
    const t = now();
    if (diagnostics.frozen) {
      const age = ((t - diagnostics.frozenAtMs) / 1000).toFixed(0);
      status.textContent = `FROZEN ${age}s ago - release the keys and take your screenshot. Clear Capture to resume.`;
      if (shown !== 'frozen') {
        // Written once: rewriting the same text would reset the scroll position while the user reads it.
        text.textContent = diagnostics.frozenReport;
        text.scrollTop = 0;
        text.style.pointerEvents = 'auto';
        freezeButton.disabled = true;
        freezeButton.style.opacity = '0.5';
        shown = 'frozen';
      }
    } else {
      status.textContent = `LIVE - ${diagnostics.historyLength} history entries (last ${HISTORY_WINDOW_MS / 1000}s). Freeze Capture to keep them.`;
      text.textContent = diagnostics.report(lastFrame);
      text.style.pointerEvents = 'none';
      freezeButton.disabled = false;
      freezeButton.style.opacity = '1';
      shown = 'live';
    }
    lastPaint = t;
  };

  const freezeButton = makeButton('Freeze Capture', 'Keep the last 10 s of history and the current state', () => {
    if (!lastFrame) return;
    diagnostics.freeze(lastFrame, now());
    paint();
  });
  const copyButton = makeButton('Copy Diagnostic Report', 'Copy the report (frozen one if frozen) to the clipboard', () => {
    if (!lastFrame) return;
    const report = diagnostics.reportForSharing(lastFrame, now());
    void copyText(win, report).then((ok) => {
      copyButton.textContent = ok ? 'Copied!' : 'Copy failed - select the text instead';
      win.setTimeout(() => (copyButton.textContent = 'Copy Diagnostic Report'), 2000);
    });
  });
  const clearButton = makeButton('Clear Capture', 'Discard the history and any frozen capture, and resume', () => {
    diagnostics.clearCapture();
    if (lastFrame) diagnostics.observe(lastFrame, now());
    lastPaint = -Infinity;
    paint();
  });
  bar.append(freezeButton, copyButton, clearButton);
  root.append(bar, status, text);
  doc.body.appendChild(root);

  // Capture phase on window: sees the event before Phaser or anything else can touch it.
  const onKey = (event: KeyboardEvent): void => {
    const raw: RawKeyEvent = { type: event.type as RawKeyEvent['type'], code: event.code, repeat: event.repeat, timeStamp: event.timeStamp };
    diagnostics.record(raw);
    if (!diagnostics.frozen) console.debug('[keydebug]', raw.type, raw.code, `repeat=${raw.repeat}`, `held=[${list(diagnostics.rawHeld)}]`);
  };
  const onBlur = (): void => {
    diagnostics.note('window blur - the browser stops reporting releases; held keys forgotten', now());
    diagnostics.forgetHeld();
  };
  const onFocus = (): void => diagnostics.note('window focus', now());
  win.addEventListener('keydown', onKey, true);
  win.addEventListener('keyup', onKey, true);
  win.addEventListener('blur', onBlur);
  win.addEventListener('focus', onFocus);

  return {
    update(frame) {
      lastFrame = frame;
      const t = now();
      diagnostics.observe(frame, t);
      if (t - lastPaint >= PANEL_REFRESH_MS) paint();
    },
    destroy() {
      win.removeEventListener('keydown', onKey, true);
      win.removeEventListener('keyup', onKey, true);
      win.removeEventListener('blur', onBlur);
      win.removeEventListener('focus', onFocus);
      root.remove();
    },
  };
}
