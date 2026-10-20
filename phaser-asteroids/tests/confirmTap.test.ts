import { describe, expect, it } from 'vitest';
import { ConfirmTap } from '../src/ui/confirmTap';

describe('ConfirmTap (tap again to confirm)', () => {
  it('a single tap only arms it', () => {
    const c = new ConfirmTap(3000);
    expect(c.isArmed(0)).toBe(false);
    expect(c.tap(1000)).toBe(false);
    expect(c.isArmed(1001)).toBe(true);
  });

  it('a second tap inside the window confirms, and the confirmation is used up', () => {
    const c = new ConfirmTap(3000);
    c.tap(1000);
    expect(c.tap(2500)).toBe(true);
    expect(c.isArmed(2501)).toBe(false);
    expect(c.tap(2600)).toBe(false); // the next tap arms again
  });

  it('the arming lapses on its own: a late second tap only re-arms', () => {
    const c = new ConfirmTap(3000);
    c.tap(1000);
    expect(c.isArmed(3999)).toBe(true);
    expect(c.isArmed(4000)).toBe(false);
    expect(c.tap(4500)).toBe(false);
    expect(c.isArmed(4501)).toBe(true);
  });

  it('disarm cancels a pending confirmation', () => {
    const c = new ConfirmTap(3000);
    c.tap(0);
    c.disarm();
    expect(c.tap(10)).toBe(false);
  });

  it('a clock that goes backwards (a scene restart) never confirms by accident', () => {
    const c = new ConfirmTap(3000);
    c.tap(10_000);
    expect(c.isArmed(500)).toBe(false);
    expect(c.tap(500)).toBe(false);
  });
});
