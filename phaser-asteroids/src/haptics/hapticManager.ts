import type { SimEvent } from '../core/game';
import {
  HAPTIC_ORDER,
  HAPTIC_PATTERNS,
  HAPTIC_PRIORITY,
  MEDIUM_PRIORITY_GAP_MS,
  TEST_PATTERN,
  hapticKindsOf,
  patternLength,
  type HapticKind,
} from './hapticPatterns';
import type { HapticSettings } from './hapticSettings';
import type { VibrationAdapter } from './vibrationAdapter';

/** What became of one request. Only `played` made the phone move; the rest say which rule said no (handy in tests and the debug hook). */
export type HapticOutcome = 'played' | 'disabled' | 'paused' | 'background' | 'unsupported' | 'cooldown' | 'busy' | 'failed';

export type TestResult = 'sent' | 'unsupported' | 'blocked';

/** The slice of `document` / `window` the lifecycle needs; tests pass plain event targets. */
export interface LifecycleDocument extends EventTarget {
  readonly hidden: boolean;
}

export interface HapticManagerOptions {
  adapter: VibrationAdapter;
  settings: HapticSettings;
  /** Monotonic milliseconds (default `performance.now`). Injected by tests so timing never needs a real sleep. */
  clock?: () => number;
}

/**
 * Turns simulation events into vibration requests, and decides when they are allowed. The simulation knows nothing about it; the scene
 * hands it each step's events (`handle`), exactly as it does for audio. Presentation only: it never changes what the game does.
 *
 * Rules, in the order they are checked:
 *   1. HAPTICS must be ON, the game not paused, the tab visible and focused, and the API present.
 *   2. Cooldown: the same effect is not repeated within its `cooldownMs`.
 *   3. Priority: while an effect is still running a new one may replace it only if its priority is strictly higher; otherwise it is
 *      dropped. Nothing is ever queued, because a buzz that arrives late feels unrelated to what caused it.
 *   4. Medium-priority effects also keep `MEDIUM_PRIORITY_GAP_MS` of silence after the previous effect.
 * `handle` asks for at most one effect per step, the top-ranked one, so damage + death in one step is a single death buzz.
 */
export class HapticManager {
  private readonly adapter: VibrationAdapter;
  private readonly settings: HapticSettings;
  private readonly clock: () => number;

  private activeUntil = 0;
  private activePriority = 0;
  private lastEnd = Number.NEGATIVE_INFINITY;
  private readonly lastStart = new Map<HapticKind, number>();

  private paused = false;
  private blurred = false;
  private document: LifecycleDocument | null = null;
  private detachLifecycle: (() => void) | null = null;
  private readonly stopSettings: () => void;
  private disposed = false;

  /** How many effects were actually sent to the adapter (for the debug hook and tests). */
  played = 0;

  constructor({ adapter, settings, clock }: HapticManagerOptions) {
    this.adapter = adapter;
    this.settings = settings;
    this.clock = clock ?? (() => performance.now());
    // Turning HAPTICS off must stop whatever is buzzing right now.
    this.stopSettings = settings.onChange((enabled) => {
      if (!enabled) this.cancel();
    });
  }

  get enabled(): boolean {
    return this.settings.enabled;
  }

  get supported(): boolean {
    return this.adapter.supported;
  }

  /** The HAPTICS switch in the menus; turning it off cancels whatever is buzzing (see the constructor). */
  setEnabled(enabled: boolean): void {
    this.settings.set(enabled);
  }

  /** True while an effect started by this manager is still running. */
  get isVibrating(): boolean {
    return this.activePriority > 0 && this.clock() < this.activeUntil;
  }

  // --- gameplay --------------------------------------------------------------

  /**
   * One simulation step's events. Plays the single top-ranked effect they ask for (death over damage over boost over laser); if that
   * one is refused, the step stays silent rather than falling back to a lesser effect.
   * @returns the outcome for that effect, or null when the step asked for none.
   */
  handle(events: readonly SimEvent[]): HapticOutcome | null {
    if (events.length === 0) return null;
    const kinds = hapticKindsOf(events);
    for (const kind of HAPTIC_ORDER) if (kinds.has(kind)) return this.request(kind);
    return null;
  }

  request(kind: HapticKind): HapticOutcome {
    if (!this.settings.enabled) return 'disabled';
    if (this.paused) return 'paused';
    if (this.inBackground()) return 'background';
    if (!this.adapter.supported) return 'unsupported';

    const spec = HAPTIC_PATTERNS[kind];
    const now = this.clock();
    const previous = this.lastStart.get(kind);
    if (previous !== undefined && now - previous < spec.cooldownMs) return 'cooldown';

    const running = now < this.activeUntil;
    if (running && spec.priority <= this.activePriority) return 'busy';
    if (!running && spec.priority < HAPTIC_PRIORITY.high && now - this.lastEnd < MEDIUM_PRIORITY_GAP_MS) return 'busy';

    // Replaces whatever is running: the API treats a new call as "cancel the old pattern, start this one".
    if (!this.adapter.vibrate(spec.pattern)) return 'failed';
    this.lastStart.set(kind, now);
    this.activePriority = spec.priority;
    this.activeUntil = now + patternLength(spec.pattern);
    this.lastEnd = this.activeUntil;
    this.played++;
    return 'played';
  }

  /**
   * The TEST VIBRATION button. Works whether HAPTICS is on or off (its job is to tell "this phone cannot" from "the game did not ask"),
   * ignores cooldowns, and must be called from the tap itself so the browser sees a user gesture.
   */
  testVibration(): TestResult {
    if (!this.adapter.supported) return 'unsupported';
    this.cancel();
    if (!this.adapter.vibrate(TEST_PATTERN)) return 'blocked';
    this.played++;
    this.activePriority = HAPTIC_PRIORITY.highest;
    this.activeUntil = this.clock() + patternLength(TEST_PATTERN);
    this.lastEnd = this.activeUntil;
    return 'sent';
  }

  // --- cleanup ---------------------------------------------------------------

  /** Stops a running vibration (`navigator.vibrate(0)`) if this manager started one that is still going. */
  cancel(): void {
    if (this.activePriority === 0) return;
    const wasRunning = this.clock() < this.activeUntil;
    this.activePriority = 0;
    this.activeUntil = 0;
    if (wasRunning) this.adapter.cancel();
  }

  /** The scene is paused (or resumed). Pausing cancels at once and holds every request until play resumes. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) this.cancel();
    // Resuming is a deliberate player action, so the window is plainly focused again even if its `focus` event never arrived.
    else this.blurred = false;
  }

  /** A run ended or the scene went away: stop buzzing and forget cooldowns and pause state, so nothing from that run reaches the next one. */
  reset(): void {
    this.cancel();
    this.lastStart.clear();
    this.lastEnd = Number.NEGATIVE_INFINITY;
    this.paused = false;
    this.blurred = false;
  }

  /**
   * Cancels on tab hide, page hide and focus loss, and holds requests while the tab is hidden or the window unfocused.
   * @returns the function that removes the listeners again (also called by `dispose`).
   */
  attachLifecycle(win: EventTarget, doc: LifecycleDocument): () => void {
    this.detachLifecycle?.();
    this.document = doc;
    const onHide = (): void => this.cancel();
    const onVisibility = (): void => {
      if (doc.hidden) this.cancel();
    };
    const onBlur = (): void => {
      this.blurred = true;
      this.cancel();
    };
    const onFocus = (): void => {
      this.blurred = false;
    };
    win.addEventListener('blur', onBlur);
    win.addEventListener('focus', onFocus);
    win.addEventListener('pagehide', onHide);
    doc.addEventListener('visibilitychange', onVisibility);
    const detach = (): void => {
      win.removeEventListener('blur', onBlur);
      win.removeEventListener('focus', onFocus);
      win.removeEventListener('pagehide', onHide);
      doc.removeEventListener('visibilitychange', onVisibility);
      if (this.document === doc) this.document = null;
      if (this.detachLifecycle === detach) this.detachLifecycle = null;
    };
    this.detachLifecycle = detach;
    return detach;
  }

  /** The game is being unloaded: stop, and drop every listener. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.detachLifecycle?.();
    this.stopSettings();
  }

  private inBackground(): boolean {
    return this.blurred || this.document?.hidden === true;
  }
}
