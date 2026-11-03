import { describe, expect, it, vi } from 'vitest';
import { isNativeApp, wireNativeApp, type AppPluginLike } from '../src/platform/nativeApp';
import { BackDispatcher } from '../src/platform/nativeBack';
import { handleBack, type BackEnv } from '../src/ui/menu/backAction';

type AppEvent = 'backButton' | 'pause' | 'resume';

/** A recording stand-in for `@capacitor/app`'s `App`. */
class FakeApp implements AppPluginLike {
  readonly listeners = new Map<AppEvent, Array<() => void>>();
  removed = 0;
  minimized = 0;
  failAddListener = false;
  addListener(eventName: AppEvent, listener: () => void) {
    if (this.failAddListener) return Promise.reject(new Error('plugin not implemented'));
    const list = this.listeners.get(eventName) ?? [];
    list.push(listener);
    this.listeners.set(eventName, list);
    return Promise.resolve({ remove: () => void this.removed++ });
  }
  minimizeApp() {
    this.minimized++;
    return Promise.resolve();
  }
  fire(eventName: AppEvent): void {
    for (const listener of this.listeners.get(eventName) ?? []) listener();
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0));

async function rig(bars?: { hide: () => Promise<void> }) {
  const app = new FakeApp();
  const win = new EventTarget();
  const seen: string[] = [];
  win.addEventListener('blur', () => seen.push('blur'));
  win.addEventListener('focus', () => seen.push('focus'));
  const back = new BackDispatcher();
  const stop = wireNativeApp(app, win, back, bars);
  await settle();
  return { app, win, seen, back, stop };
}

/** A run in GameScene, reduced to the state `handleBack` reads (the same object Escape uses). */
function run(): BackEnv & { log: string[]; state: { paused: boolean; gameOver: boolean; pageOpen: boolean } } {
  const state = { paused: false, gameOver: false, pageOpen: false };
  const log: string[] = [];
  return {
    state,
    log,
    get gameOver() { return state.gameOver; },
    get paused() { return state.paused; },
    get menuShown() { return state.paused; },
    menuBack: () => {
      if (!state.pageOpen) return false;
      state.pageOpen = false;
      log.push('closed-page');
      return true;
    },
    pause: () => ((state.paused = true), log.push('pause')),
    resume: () => ((state.paused = false), log.push('resume')),
    leaveFinishedRun: () => log.push('left'),
  };
}

describe('isNativeApp', () => {
  it('is true only when the Capacitor bridge says it is a native platform', () => {
    expect(isNativeApp({ Capacitor: { isNativePlatform: () => true } })).toBe(true);
    expect(isNativeApp({ Capacitor: { isNativePlatform: () => false } })).toBe(false);
    expect(isNativeApp({ Capacitor: {} })).toBe(false);
    expect(isNativeApp({})).toBe(false);
    expect(isNativeApp(undefined)).toBe(false);
    expect(isNativeApp({ Capacitor: { isNativePlatform: () => { throw new Error('x'); } } })).toBe(false);
  });
  it('is false in the test environment (no window): browsers never take the native paths', () => {
    expect(isNativeApp()).toBe(false);
  });
});

describe('BackDispatcher', () => {
  it('with no scene registered, Back leaves the app', () => {
    expect(new BackDispatcher().dispatch()).toBe('exit');
  });
  it('the handler decides: true is handled, false (nothing left to close) leaves', () => {
    const back = new BackDispatcher();
    let open = true;
    back.setHandler(() => {
      const had = open;
      open = false;
      return had;
    });
    expect(back.dispatch()).toBe('handled');
    expect(back.dispatch()).toBe('exit');
  });
  it('a scene shutting down after the next one registered cannot remove the newer handler', () => {
    const back = new BackDispatcher();
    const stopOld = back.setHandler(() => false);
    back.setHandler(() => true);
    stopOld();
    expect(back.dispatch()).toBe('handled');
  });
  it('a handler that throws never turns Back into leaving the app', () => {
    const back = new BackDispatcher();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    back.setHandler(() => {
      throw new Error('boom');
    });
    expect(back.dispatch()).toBe('handled');
    warn.mockRestore();
  });
});

describe('wireNativeApp: Back', () => {
  it('in a run, Back follows the Escape rules and never leaves the app', async () => {
    const { app, back } = await rig();
    const game = run();
    back.setHandler(() => (handleBack(game), true)); // what GameScene registers
    app.fire('backButton'); // playing -> pause
    game.state.pageOpen = true;
    app.fire('backButton'); // a pause page -> closes it
    app.fire('backButton'); // the pause root -> resume
    game.state.gameOver = true;
    app.fire('backButton'); // game over -> the title screen
    expect(game.log).toEqual(['pause', 'closed-page', 'resume', 'left']);
    expect(app.minimized).toBe(0);
  });
  it('on the title screen, Back closes pages and only minimizes from the root page', async () => {
    const { app, back } = await rig();
    let depth = 2;
    back.setHandler(() => (depth > 0 ? (depth--, true) : false)); // MenuController.back(): false on the root
    app.fire('backButton');
    app.fire('backButton');
    expect(app.minimized).toBe(0);
    app.fire('backButton');
    await settle();
    expect(app.minimized).toBe(1);
  });
});

describe('wireNativeApp: lifecycle', () => {
  it('app pause / resume become the window blur / focus every existing lifecycle listener handles', async () => {
    const { app, seen } = await rig();
    app.fire('pause');
    app.fire('resume');
    expect(seen).toEqual(['blur', 'focus']);
  });
  it('resume hides the system bars again', async () => {
    const hide = vi.fn(() => Promise.resolve());
    const { app } = await rig({ hide });
    app.fire('pause');
    expect(hide).not.toHaveBeenCalled();
    app.fire('resume');
    await settle();
    expect(hide).toHaveBeenCalledTimes(1);
  });
  it('a failing plugin is logged, not thrown, and the game carries on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = new FakeApp();
    app.failAddListener = true;
    expect(() => wireNativeApp(app, new EventTarget(), new BackDispatcher(), { hide: () => Promise.reject(new Error('no bars')) })).not.toThrow();
    await settle();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it('the returned function removes every listener', async () => {
    const { app, stop } = await rig();
    stop();
    await settle();
    expect(app.removed).toBe(3);
  });
});
