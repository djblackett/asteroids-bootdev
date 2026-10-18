/** The few fields of a DOM `KeyboardEvent` the tracker needs. */
interface CodeEvent {
  code: string;
}

/** The part of `document` the tracker uses to notice the tab being hidden. */
interface VisibilityTarget extends EventTarget {
  hidden: boolean;
}

/**
 * Which physical keys (`KeyboardEvent.code`) are down right now, for the whole game.
 *
 * Gameplay used to poll Phaser's per-scene `Key` objects. Those are rebuilt whenever a scene starts and were wiped
 * when the game paused, but the browser does not re-announce a key that is still held (OS auto-repeat only repeats the
 * most recently pressed key), so a ship held on W + D stopped dead after unpausing or retrying until the keys were
 * released and pressed again. This tracker lives outside any scene, only ever changes on real keydown / keyup events,
 * and is cleared only when the browser genuinely stops delivering keyups (blur, hidden tab, macOS Cmd).
 *
 * Every key is independent, so any combination the keyboard hardware can report is reported.
 * Using `code` rather than `keyCode` also keeps keys working under an IME (which reports `keyCode` 229).
 */
export class HeldKeys {
  private readonly down = new Set<string>();

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  isAnyDown(codes: readonly string[]): boolean {
    return codes.some((code) => this.down.has(code));
  }

  /** A copy of the keys currently held. */
  snapshot(): ReadonlySet<string> {
    return new Set(this.down);
  }

  press(code: string): void {
    this.down.add(code);
  }

  release(code: string): void {
    this.down.delete(code);
    // macOS never sends keyup for other keys while Cmd is held, so releasing Cmd is the last chance to forget them.
    if (code === 'MetaLeft' || code === 'MetaRight') this.down.clear();
  }

  clear(): void {
    this.down.clear();
  }

  /**
   * Starts tracking events from `win` (and tab visibility from `doc`). Returns a function that stops listening.
   * Browser auto-repeat keydowns are harmless: adding a held key again changes nothing, and it re-registers a key
   * that was cleared by a blur while still being held.
   */
  attach(win: EventTarget, doc?: VisibilityTarget): () => void {
    const onDown = (event: Event): void => this.press((event as unknown as CodeEvent).code);
    const onUp = (event: Event): void => this.release((event as unknown as CodeEvent).code);
    const onBlur = (): void => this.clear();
    const onVisibility = (): void => {
      if (doc?.hidden) this.clear();
    };
    win.addEventListener('keydown', onDown);
    win.addEventListener('keyup', onUp);
    win.addEventListener('blur', onBlur);
    doc?.addEventListener('visibilitychange', onVisibility);
    return () => {
      win.removeEventListener('keydown', onDown);
      win.removeEventListener('keyup', onUp);
      win.removeEventListener('blur', onBlur);
      doc?.removeEventListener('visibilitychange', onVisibility);
      this.clear();
    };
  }
}
