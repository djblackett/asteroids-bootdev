import { describe, expect, it, vi } from 'vitest';
import { createKeyPressDispatcher, type KeyEventLike } from '../src/input/keyPress';

const press = (code: string, repeat = false): KeyEventLike => ({ code, repeat });

describe('one-shot key dispatcher', () => {
  it('runs the handler for its key and ignores other keys', () => {
    const pause = vi.fn();
    const dispatch = createKeyPressDispatcher({ KeyP: pause });
    dispatch(press('KeyP'));
    dispatch(press('KeyX'));
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('ignores browser auto-repeat while a key is held', () => {
    const pause = vi.fn();
    const dispatch = createKeyPressDispatcher({ KeyP: pause });
    dispatch(press('KeyP'));
    for (let i = 0; i < 10; i++) dispatch(press('KeyP', true));
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('acts once per physical press even when the engine replays the same event object', () => {
    // Phaser 4.2.1 replays earlier queued events when later ones arrive in the same frame.
    const pause = vi.fn();
    const menu = vi.fn();
    const dispatch = createKeyPressDispatcher({ KeyP: pause, Escape: menu });
    const p = press('KeyP');
    const esc = press('Escape');
    dispatch(p); // P down
    dispatch(p); // ...replayed when Escape arrives
    dispatch(esc);
    dispatch(p);
    dispatch(esc);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(menu).toHaveBeenCalledTimes(1);
  });

  it('a later, separate press of the same key still works', () => {
    const pause = vi.fn();
    const dispatch = createKeyPressDispatcher({ KeyP: pause });
    dispatch(press('KeyP'));
    dispatch(press('KeyP'));
    expect(pause).toHaveBeenCalledTimes(2);
  });
});
