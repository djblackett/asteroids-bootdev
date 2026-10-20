import { describe, expect, it } from 'vitest';
import {
  browserFullscreenEnvironment,
  detectSupport,
  FullscreenController,
  fullscreenButtonSpec,
  HOME_SCREEN_TIP,
  type FullscreenDocument,
  type FullscreenElement,
  type FullscreenEnvironment,
  type FullscreenState,
} from '../src/input/fullscreen';
import { CountingTarget } from './touchFakes';

/**
 * Fullscreen, against a fake document that behaves like the Fullscreen API: a request is accepted or refused (a promise that
 * resolves or rejects), acceptance sets `fullscreenElement` and fires `fullscreenchange`, a refusal may also fire `fullscreenerror`.
 */

class FakeDocument extends CountingTarget implements FullscreenDocument {
  fullscreenEnabled: boolean | undefined = true;
  webkitFullscreenEnabled: boolean | undefined;
  fullscreenElement: unknown = null;
  webkitFullscreenElement: unknown;
  exits = 0;
  exitRejects = false;
  exitFullscreen = (): Promise<void> => {
    this.exits++;
    if (this.exitRejects) return Promise.reject(new Error('NotAllowed'));
    this.fullscreenElement = null;
    this.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  };
}

class FakeRoot implements FullscreenElement {
  requests: unknown[] = [];
  mode: 'accept' | 'reject' | 'throw' = 'accept';
  /** Also fire `fullscreenerror` when refusing, as browsers do. */
  fireError = true;
  constructor(private readonly doc: FakeDocument) {}
  requestFullscreen = (options?: unknown): Promise<void> => {
    this.requests.push(options);
    if (this.mode === 'throw') throw new TypeError('Fullscreen is not allowed');
    if (this.mode === 'reject') {
      if (this.fireError) this.doc.dispatchEvent(new Event('fullscreenerror'));
      return Promise.reject(new TypeError('Permissions check failed'));
    }
    this.doc.fullscreenElement = this;
    this.doc.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  };
}

function rig(standalone = false) {
  const doc = new FakeDocument();
  const root = new FakeRoot(doc);
  const env: FullscreenEnvironment = { document: doc, root, standalone };
  const controller = new FullscreenController(env);
  const states: FullscreenState[] = [];
  controller.onChange((s) => states.push(s));
  return { doc, root, env, controller, states };
}

describe('fullscreen support detection', () => {
  it('a browser that allows fullscreen and can be asked is available', () => {
    const { env } = rig();
    expect(detectSupport(env)).toBe('available');
  });

  it('document.fullscreenEnabled === false (disabled by policy, iframe without allow=fullscreen) is unsupported', () => {
    const { doc, env } = rig();
    doc.fullscreenEnabled = false;
    expect(detectSupport(env)).toBe('unsupported');
  });

  it('iPhone Safari: no standard API at all -> unsupported, so no Fullscreen button is offered', () => {
    const doc = new FakeDocument();
    doc.fullscreenEnabled = undefined; // property does not exist
    const root: FullscreenElement = {}; // no requestFullscreen either
    expect(detectSupport({ document: doc, root, standalone: false })).toBe('unsupported');
  });

  it('an element that cannot be asked is unsupported even if the document claims it is enabled', () => {
    const doc = new FakeDocument();
    expect(detectSupport({ document: doc, root: {}, standalone: false })).toBe('unsupported');
  });

  it('the old webkit names are honoured (iPad Safari)', () => {
    const doc = new FakeDocument();
    doc.fullscreenEnabled = undefined;
    doc.webkitFullscreenEnabled = true;
    const root: FullscreenElement = { webkitRequestFullscreen: () => undefined };
    expect(detectSupport({ document: doc, root, standalone: false })).toBe('available');
    doc.webkitFullscreenEnabled = false;
    expect(detectSupport({ document: doc, root, standalone: false })).toBe('unsupported');
  });

  it('already running as an installed web app: nothing to hide, nothing to offer', () => {
    const { env } = rig(true);
    expect(detectSupport(env)).toBe('standalone');
  });

  it('reads the real browser facts defensively: no matchMedia, navigator.standalone, display-mode', () => {
    const doc = { documentElement: {} } as unknown as Document;
    const nav = {} as Navigator;
    expect(browserFullscreenEnvironment(doc, { matchMedia: () => { throw new Error('nope'); } } as unknown as Window, nav).standalone).toBe(false);
    expect(browserFullscreenEnvironment(doc, { matchMedia: () => ({ matches: true }) } as unknown as Window, nav).standalone).toBe(true);
    expect(browserFullscreenEnvironment(doc, { matchMedia: () => ({ matches: false }) } as unknown as Window, { standalone: true } as unknown as Navigator).standalone).toBe(true);
    expect(browserFullscreenEnvironment(doc, { matchMedia: () => ({ matches: false }) } as unknown as Window, nav).standalone).toBe(false);
  });
});

describe('entering and leaving fullscreen', () => {
  it('request() asks the browser straight away, synchronously (inside the user gesture), for the root element', async () => {
    const { root, controller } = rig();
    const pending = controller.request();
    expect(root.requests).toHaveLength(1); // the call happened before any await
    expect(root.requests[0]).toEqual({ navigationUI: 'hide' });
    expect(await pending).toBe(true);
  });

  it('entering: active becomes true and listeners hear about it once', async () => {
    const { controller, states } = rig();
    expect(controller.active).toBe(false);
    await controller.request();
    expect(controller.active).toBe(true);
    expect(states).toHaveLength(1);
    expect(states[0]).toEqual({ support: 'available', active: true, failure: null });
  });

  it('leaving with exit(): active becomes false', async () => {
    const { doc, controller, states } = rig();
    await controller.request();
    expect(await controller.exit()).toBe(true);
    expect(doc.exits).toBe(1);
    expect(controller.active).toBe(false);
    expect(states.at(-1)).toEqual({ support: 'available', active: false, failure: null });
  });

  it('exit() when not fullscreen does nothing', async () => {
    const { doc, controller, states } = rig();
    expect(await controller.exit()).toBe(true);
    expect(doc.exits).toBe(0);
    expect(states).toHaveLength(0);
  });

  it('toggle() enters, then leaves', async () => {
    const { controller } = rig();
    await controller.toggle();
    expect(controller.active).toBe(true);
    await controller.toggle();
    expect(controller.active).toBe(false);
  });

  it('the system leaving fullscreen (back gesture, Esc) is noticed from the document, not assumed', async () => {
    const { doc, controller, states } = rig();
    await controller.request();
    doc.fullscreenElement = null; // the user swiped back
    doc.dispatchEvent(new Event('fullscreenchange'));
    expect(controller.active).toBe(false);
    expect(states.at(-1)?.active).toBe(false);
  });

  it('a webkit-prefixed change event works too', async () => {
    const { doc, controller, states } = rig();
    doc.webkitFullscreenElement = {};
    doc.dispatchEvent(new Event('webkitfullscreenchange'));
    expect(controller.active).toBe(true);
    expect(states).toHaveLength(1);
  });

  it('a duplicate change event that changes nothing is not news', async () => {
    const { doc, controller, states } = rig();
    await controller.request();
    doc.dispatchEvent(new Event('fullscreenchange'));
    doc.dispatchEvent(new Event('fullscreenchange'));
    expect(states).toHaveLength(1);
    expect(controller.active).toBe(true);
  });

  it('old webkit (returns nothing instead of a promise) still resolves', async () => {
    const doc = new FakeDocument();
    doc.fullscreenEnabled = undefined;
    doc.webkitFullscreenEnabled = true;
    let called = 0;
    const root: FullscreenElement = { webkitRequestFullscreen: () => void called++ };
    const controller = new FullscreenController({ document: doc, root, standalone: false });
    expect(await controller.request()).toBe(true);
    expect(called).toBe(1);
  });
});

describe('fullscreen refusals', () => {
  it('a rejected request is reported as blocked, never thrown, and the game carries on in its window', async () => {
    const { root, controller, states } = rig();
    root.mode = 'reject';
    expect(await controller.request()).toBe(false);
    expect(controller.active).toBe(false);
    expect(controller.state.failure).toBe('blocked');
    expect(states.length).toBeGreaterThan(0);
    expect(states.at(-1)?.failure).toBe('blocked');
  });

  it('a request that throws synchronously (some browsers do) is reported the same way', async () => {
    const { root, controller } = rig();
    root.mode = 'throw';
    expect(await controller.request()).toBe(false);
    expect(controller.state).toEqual({ support: 'available', active: false, failure: 'blocked' });
  });

  it('fullscreenerror alone (no promise rejection seen) is also a visible failure', () => {
    const { doc, controller, states } = rig();
    doc.dispatchEvent(new Event('fullscreenerror'));
    expect(controller.state.failure).toBe('blocked');
    expect(states.at(-1)?.failure).toBe('blocked');
  });

  it('asking where fullscreen is unavailable fails cleanly without calling the browser', async () => {
    const { doc, root, controller } = rig();
    doc.fullscreenEnabled = false;
    expect(await controller.request()).toBe(false);
    expect(root.requests).toHaveLength(0);
    expect(controller.state.failure).toBe('unavailable');
  });

  it('the next attempt clears an old failure, and entering fullscreen clears it too', async () => {
    const { root, controller } = rig();
    root.mode = 'reject';
    await controller.request();
    expect(controller.state.failure).toBe('blocked');
    root.mode = 'accept';
    await controller.request();
    expect(controller.state.failure).toBeNull();
    expect(controller.active).toBe(true);
  });

  it('clearFailure() forgets a shown refusal and tells listeners; with nothing to forget it is silent', async () => {
    const { root, controller, states } = rig();
    root.mode = 'reject';
    await controller.request();
    const before = states.length;
    controller.clearFailure();
    expect(controller.state.failure).toBeNull();
    expect(states).toHaveLength(before + 1);
    controller.clearFailure();
    expect(states).toHaveLength(before + 1);
  });

  it('a refused exit is reported and leaves the state alone', async () => {
    const { doc, controller } = rig();
    await controller.request();
    doc.exitRejects = true;
    expect(await controller.exit()).toBe(false);
    expect(controller.active).toBe(true);
    expect(controller.state.failure).toBe('blocked');
  });
});

describe('fullscreen cleanup', () => {
  it('destroy removes every document listener and every subscriber', () => {
    const { doc, controller, states } = rig();
    expect(doc.listenerTotal).toBeGreaterThan(0);
    controller.destroy();
    expect(doc.listenerTotal).toBe(0);
    expect(controller.listenerCount).toBe(0);
    doc.dispatchEvent(new Event('fullscreenchange'));
    expect(states).toHaveLength(0);
  });

  it('onChange returns an unsubscribe function', async () => {
    const { controller } = rig();
    const seen: boolean[] = [];
    const stop = controller.onChange((s) => seen.push(s.active));
    await controller.request();
    stop();
    await controller.exit();
    expect(seen).toEqual([true]);
  });
});

describe('what the Fullscreen button shows', () => {
  const state = (over: Partial<FullscreenState>): FullscreenState => ({ support: 'available', active: false, failure: null, ...over });

  it('FULLSCREEN to enter, EXIT FULLSCREEN to leave', () => {
    expect(fullscreenButtonSpec(state({}))).toEqual({ visible: true, label: 'FULLSCREEN', action: 'toggle', warning: false });
    expect(fullscreenButtonSpec(state({ active: true }))).toEqual({ visible: true, label: 'EXIT FULLSCREEN', action: 'toggle', warning: false });
  });

  it('where fullscreen is impossible there is no Fullscreen button: a tip about the Home Screen instead', () => {
    const spec = fullscreenButtonSpec(state({ support: 'unsupported' }));
    expect(spec.action).toBe('tip');
    expect(spec.label).not.toMatch(/^FULLSCREEN/);
    expect(HOME_SCREEN_TIP.lines.join(' ')).toMatch(/Home Screen/);
    expect(HOME_SCREEN_TIP.lines.join(' ')).toMatch(/Share/);
  });

  it('a refusal is said out loud for a moment', () => {
    expect(fullscreenButtonSpec(state({ failure: 'blocked' }))).toMatchObject({ label: 'FULLSCREEN BLOCKED', warning: true, visible: true });
  });

  it('an installed web app has no address bar to hide, so nothing is shown', () => {
    expect(fullscreenButtonSpec(state({ support: 'standalone' })).visible).toBe(false);
  });
});
