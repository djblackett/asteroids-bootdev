import { describe, expect, it } from 'vitest';
import { bindTouchControls, type ViewportChange } from '../src/input/touchBinding';
import { TouchModel } from '../src/input/touchModel';
import { centre, FakeDoc, FakeHost, fakeElements, LAYOUT, pointer } from './touchFakes';

/**
 * The browser wiring around the model, with fake elements, window and document: real Pointer Event semantics as far as they
 * matter here (down on an element, move / up / cancel / lost-capture reaching the window) and no browser.
 */

function rig() {
  const elements = fakeElements();
  const host = new FakeHost();
  const doc = new FakeDoc();
  const model = new TouchModel();
  const log = { pauseTaps: 0, viewports: [] as ViewportChange[], released: [] as string[] };
  const binding = bindTouchControls({
    elements,
    model,
    host,
    doc,
    onPauseTap: () => log.pauseTaps++,
    onViewport: (change) => log.viewports.push(change),
    onLifecycleRelease: (reason) => log.released.push(reason),
  });
  const down = (control: keyof typeof elements, id: number, at = centre(LAYOUT[control]), options = {}) => {
    const event = pointer('pointerdown', id, at.x, at.y, options);
    elements[control].dispatchEvent(event);
    return event;
  };
  const move = (id: number, x: number, y: number): void => void host.dispatchEvent(pointer('pointermove', id, x, y));
  const up = (id: number, x = 0, y = 0): void => void host.dispatchEvent(pointer('pointerup', id, x, y));
  const cancel = (id: number): void => void host.dispatchEvent(pointer('pointercancel', id));
  return { elements, host, doc, model, log, binding, down, move, up, cancel };
}

describe('multi-touch', () => {
  it('steer, fire and a special work together, each on its own pointer id', () => {
    const r = rig();
    r.down('stick', 11, { x: 150, y: 300 });
    r.move(11, 150 - 50, 300 - 50);
    r.down('fire', 12);
    r.down('laser', 13);
    expect(r.model.command()).toMatchObject({ shoot: true, laser: true, boost: false });
    expect(r.model.command().rotate).toBeLessThan(0);
    expect(r.model.command().move).toBeGreaterThan(0);
    expect(r.model.activePointers).toBe(3);
  });

  it('a finger that slides from FIRE onto LASER keeps holding FIRE and does not press LASER', () => {
    const r = rig();
    r.down('fire', 1);
    const laser = centre(LAYOUT.laser);
    r.move(1, laser.x, laser.y);
    expect(r.model.command()).toMatchObject({ shoot: true, laser: false });
  });

  it('a finger that leaves its button keeps holding it until it lifts, wherever it lifts', () => {
    const r = rig();
    r.down('fire', 1);
    r.move(1, 20, 20); // far outside the button, over the stick zone and the HUD
    expect(r.model.command().shoot).toBe(true);
    r.up(1, 20, 20);
    expect(r.model.command().shoot).toBe(false);
  });

  it('asks for pointer capture on the element the finger landed on, and works without it', () => {
    const r = rig();
    r.down('fire', 1);
    expect(r.elements.fire.captured.has(1)).toBe(true);
    r.elements.laser.captureThrows = true;
    r.down('laser', 2); // a refusing browser must not break the control
    expect(r.model.command().laser).toBe(true);
  });

  it('prevents the default on pointer down (no synthesised mouse events or click afterwards)', () => {
    const r = rig();
    expect(r.down('fire', 1).prevented).toBe(true);
  });

  it('ignores the right and middle mouse buttons, but takes any touch or pen', () => {
    const r = rig();
    r.down('fire', 1, centre(LAYOUT.fire), { pointerType: 'mouse', button: 2 });
    expect(r.model.activePointers).toBe(0);
    r.down('fire', 2, centre(LAYOUT.fire), { pointerType: 'mouse', button: 0 });
    r.down('laser', 3, centre(LAYOUT.laser), { pointerType: 'pen', button: 0 });
    expect(r.model.command()).toMatchObject({ shoot: true, laser: true });
  });

  it('events for pointers it never saw are ignored', () => {
    const r = rig();
    r.down('fire', 1);
    r.up(99);
    r.cancel(99);
    r.move(99, 5, 5);
    expect(r.model.command().shoot).toBe(true);
  });
});

describe('cancel, lost capture and release outside', () => {
  it('pointercancel lets go (a system gesture or the browser took the touch)', () => {
    const r = rig();
    r.down('stick', 1, { x: 100, y: 300 });
    r.move(1, 160, 300);
    r.down('fire', 2);
    r.cancel(1);
    r.cancel(2);
    expect(r.model.command()).toEqual({ rotate: 0, move: 0, shoot: false, laser: false, boost: false });
    expect(r.model.activePointers).toBe(0);
  });

  it('lostpointercapture lets go too (the element was hidden under the finger)', () => {
    const r = rig();
    r.down('boost', 4);
    r.host.dispatchEvent(pointer('lostpointercapture', 4));
    expect(r.model.command().boost).toBe(false);
  });

  it('after a cancel the stick is free for a new finger', () => {
    const r = rig();
    r.down('stick', 1, { x: 100, y: 300 });
    r.cancel(1);
    r.down('stick', 2, { x: 120, y: 280 });
    r.move(2, 180, 280);
    expect(r.model.command().rotate).toBeGreaterThan(0);
  });
});

describe('the PAUSE button is a tap', () => {
  it('fires when the finger lifts on the button', () => {
    const r = rig();
    const at = centre(LAYOUT.pause);
    r.down('pause', 1);
    expect(r.log.pauseTaps).toBe(0); // not on touch down: an accidental brush does nothing
    r.up(1, at.x, at.y);
    expect(r.log.pauseTaps).toBe(1);
  });

  it('does not fire when the finger slides off before lifting, or when the touch is cancelled', () => {
    const r = rig();
    r.down('pause', 1);
    r.up(1, 300, 300);
    r.down('pause', 2);
    r.cancel(2);
    r.down('pause', 3);
    r.host.dispatchEvent(pointer('lostpointercapture', 3));
    expect(r.log.pauseTaps).toBe(0);
  });

  it('never affects the ship command', () => {
    const r = rig();
    r.down('pause', 1);
    expect(r.model.command()).toEqual({ rotate: 0, move: 0, shoot: false, laser: false, boost: false });
  });
});

describe('lifecycle: nothing is ever left held', () => {
  const hold = (r: ReturnType<typeof rig>): void => {
    r.down('stick', 1, { x: 100, y: 300 });
    r.move(1, 160, 250);
    r.down('fire', 2);
    r.down('boost', 3);
  };
  const neutral = { rotate: 0, move: 0, shoot: false, laser: false, boost: false };

  it('losing window focus releases everything', () => {
    const r = rig();
    hold(r);
    r.host.dispatchEvent(new Event('blur'));
    expect(r.model.command()).toEqual(neutral);
    expect(r.log.released).toEqual(['blur']);
  });

  it('hiding the tab releases everything, becoming visible again does not invent anything', () => {
    const r = rig();
    hold(r);
    r.doc.hidden = true;
    r.doc.dispatchEvent(new Event('visibilitychange'));
    expect(r.model.command()).toEqual(neutral);
    r.doc.hidden = false;
    r.doc.dispatchEvent(new Event('visibilitychange'));
    expect(r.model.command()).toEqual(neutral);
    expect(r.log.released).toEqual(['hidden']);
  });

  it('pagehide (the page is being left or frozen) releases everything', () => {
    const r = rig();
    hold(r);
    r.host.dispatchEvent(new Event('pagehide'));
    expect(r.model.command()).toEqual(neutral);
  });

  it('turning the phone (landscape -> portrait) releases everything and reports the new orientation', () => {
    const r = rig();
    hold(r);
    r.host.innerWidth = 390;
    r.host.innerHeight = 844;
    r.host.dispatchEvent(new Event('resize'));
    expect(r.model.command()).toEqual(neutral);
    expect(r.log.viewports).toEqual([{ width: 390, height: 844, portrait: true, orientationChanged: true }]);
    expect(r.binding.isPortrait()).toBe(true);
    // ... and back: coherent state, nothing held, the stick usable again.
    r.host.innerWidth = 844;
    r.host.innerHeight = 390;
    r.host.dispatchEvent(new Event('orientationchange'));
    expect(r.log.viewports[1]).toEqual({ width: 844, height: 390, portrait: false, orientationChanged: true });
    expect(r.model.command()).toEqual(neutral);
    r.down('stick', 5, { x: 100, y: 300 });
    r.move(5, 100, 240);
    expect(r.model.command().move).toBeGreaterThan(0);
  });

  it('a plain resize (browser toolbar sliding away) keeps the fingers that are down', () => {
    const r = rig();
    hold(r);
    r.host.innerHeight = 360;
    r.host.dispatchEvent(new Event('resize'));
    expect(r.model.command().shoot).toBe(true);
    expect(r.log.viewports[0]).toMatchObject({ portrait: false, orientationChanged: false });
    expect(r.log.released).toEqual([]);
  });

  it('a late pointerup after a lifecycle release is harmless', () => {
    const r = rig();
    hold(r);
    r.host.dispatchEvent(new Event('blur'));
    r.up(2);
    r.cancel(1);
    expect(r.model.command()).toEqual(neutral);
  });

  it('a disabled model ignores touches that still reach an element', () => {
    const r = rig();
    r.model.setEnabled(false);
    expect(r.down('fire', 1).prevented).toBe(false); // not even claimed
    expect(r.model.activePointers).toBe(0);
  });

  it('destroy removes every listener it added and lets go of what was held', () => {
    const r = rig();
    hold(r);
    expect(r.host.listenerTotal).toBeGreaterThan(0);
    r.binding.destroy();
    expect(r.host.listenerTotal).toBe(0);
    expect(r.doc.listenerTotal).toBe(0);
    for (const element of Object.values(r.elements)) expect(element.listenerTotal).toBe(0);
    expect(r.model.activePointers).toBe(0);
    r.host.dispatchEvent(pointer('pointermove', 1, 300, 300));
    expect(r.model.command()).toEqual(neutral);
  });

  it('adds a bounded, fixed number of listeners however many touches there are', () => {
    const r = rig();
    const before = r.host.listenerTotal + r.doc.listenerTotal + Object.values(r.elements).reduce((n, e) => n + e.listenerTotal, 0);
    for (let i = 0; i < 200; i++) {
      r.down('fire', i);
      r.up(i);
    }
    const after = r.host.listenerTotal + r.doc.listenerTotal + Object.values(r.elements).reduce((n, e) => n + e.listenerTotal, 0);
    expect(after).toBe(before);
  });
});
