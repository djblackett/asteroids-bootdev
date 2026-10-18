/** The few fields of a DOM `KeyboardEvent` that the dispatcher needs. */
export interface KeyEventLike {
  code: string;
  repeat: boolean;
}

export type KeyHandlers = Readonly<Record<string, () => void>>;

/**
 * Builds a handler for one-shot key presses (pause, menu, retry, mute...), keyed by `KeyboardEvent.code`.
 *
 * Phaser 4.2.1 re-processes its not-yet-cleared key queue every time another key event arrives within the
 * same frame, so a `keydown-P` listener can fire a second time when, say, Escape is pressed in the same
 * ~16 ms. Phaser's own string events also fire for the browser's auto-repeat while a key is held. This
 * dispatcher acts once per physical key press: it remembers which event objects it already handled and
 * ignores auto-repeat. (Continuous controls are polled through `Key.isDown` and are not affected.)
 */
export function createKeyPressDispatcher(handlers: KeyHandlers): (event: KeyEventLike) => void {
  const handled = new WeakSet<object>();
  return (event) => {
    if (handled.has(event)) return;
    handled.add(event);
    if (event.repeat) return;
    handlers[event.code]?.();
  };
}
