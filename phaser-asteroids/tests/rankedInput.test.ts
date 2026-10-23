import { describe, expect, it } from 'vitest';
import { INPUT_MODE_STORAGE_KEY, InputModeController } from '../src/input/inputMode';
import { rankedInputAvailable } from '../src/input/rankedInput';
import { makeHub, plugIn } from './padFakes';

describe('ranked input readiness', () => {
  for (const mobile of [false, true]) for (const touch of [false, true]) for (const keyboard of [false, true]) for (const controller of [false, true]) {
    it(`mobile=${mobile}, touch=${touch}, keyboard=${keyboard}, assigned controller=${controller}`, () => {
      const stored = new Map([[INPUT_MODE_STORAGE_KEY, touch ? 'touch' : 'desktop']]);
      const mode = new InputModeController({ coarsePrimaryPointer: mobile, touchCapable: mobile }, '', {
        getItem: (key) => stored.get(key) ?? null,
        setItem: () => { throw new Error('readiness must not write preferences'); },
      });
      const rig = makeHub();
      if (controller) {
        plugIn(rig);
        rig.hub.join(rig.hub.pads()[0]!.key, 1);
      }
      expect(rankedInputAvailable(mode, rig.hub, keyboard)).toBe(touch || !mobile || keyboard || controller);
      expect(mode.isTouch).toBe(touch);
      expect(stored.get(INPUT_MODE_STORAGE_KEY)).toBe(touch ? 'touch' : 'desktop');
    });
  }

  it('requires assignment to the solo ship, and stops trusting a disconnected controller', () => {
    const mode = new InputModeController({ coarsePrimaryPointer: true, touchCapable: true }, '?touch=off', null);
    const rig = makeHub();
    plugIn(rig);
    const pad = rig.hub.pads()[0]!;
    expect(rankedInputAvailable(mode, rig.hub, false)).toBe(false);
    rig.hub.assign(pad.key, 1, 2); // either assigned slot can drive a solo run
    expect(rankedInputAvailable(mode, rig.hub, false)).toBe(true);
    rig.pads.set(null);
    rig.hub.poll();
    expect(rankedInputAvailable(mode, rig.hub, false)).toBe(false);
  });
});
