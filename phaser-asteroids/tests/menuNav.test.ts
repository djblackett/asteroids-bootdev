import { describe, expect, it } from 'vitest';
import { containsPoint, neighbour, PageStack, type NavTarget } from '../src/ui/menu/focusNav';

const box = (id: string, x: number, y: number, w = 100, h = 90): NavTarget => ({ id, rect: { x, y, w, h } });

/** The title screen's right column: PLAY, the player switch, then AUDIO | CONTROLS side by side. */
const title = [box('play', 680, 112, 560, 120), box('players', 680, 248, 560), box('audio', 680, 354, 272), box('controls', 968, 354, 272), box('powerups', 40, 482, 1200, 224)];
const at = (id: string): NavTarget => title.find((t) => t.id === id) as NavTarget;

describe('directional focus', () => {
  it('moves down a column and back up', () => {
    expect(neighbour(at('play'), title, 'down')).toBe('players');
    expect(neighbour(at('players'), title, 'up')).toBe('play');
  });

  it('moves along a row, and stops at its ends instead of jumping to another row', () => {
    expect(neighbour(at('audio'), title, 'right')).toBe('controls');
    expect(neighbour(at('controls'), title, 'left')).toBe('audio');
    expect(neighbour(at('controls'), title, 'right')).toBeNull();
    expect(neighbour(at('audio'), title, 'left')).toBeNull();
    expect(neighbour(at('play'), title, 'right')).toBeNull();
  });

  it('goes from a wide button to the nearest narrower one below it, preferring the one most in line', () => {
    expect(neighbour(at('players'), title, 'down')).toBe('audio'); // centres equidistant: the first listed wins
    const left = [box('wide', 0, 0, 600), box('a', 0, 120, 100), box('b', 500, 120, 100)];
    expect(neighbour(left[0] as NavTarget, left, 'down')).toBe('a'); // equally far; but see below for one that is in line
    const inLine = [box('wide', 0, 0, 200), box('a', 0, 120, 100), box('b', 100, 120, 100)];
    expect(neighbour(inLine[0] as NavTarget, inLine, 'down')).toBe('a');
    const offLine = [box('x', 400, 0, 100), box('near', 0, 120, 100), box('inline', 400, 240, 100)];
    expect(neighbour(offLine[0] as NavTarget, offLine, 'down')).toBe('inline'); // 400 px sideways outweighs 120 px less distance down
  });

  it('wraps from the last row to the first and back', () => {
    expect(neighbour(at('powerups'), title, 'down')).toBe('play');
    expect(neighbour(at('play'), title, 'up')).toBe('powerups');
  });

  it('never wraps sideways, and a single item has nowhere to go', () => {
    const only = [box('only', 0, 0)];
    for (const d of ['up', 'down', 'left', 'right'] as const) expect(neighbour(only[0] as NavTarget, only, d)).toBeNull();
  });

  it('reaches every item of a settings page with Down alone, in order', () => {
    const page = [box('music', 40, 118, 1200), box('track', 40, 220, 1200), box('vol', 40, 322, 1200), box('sfx', 40, 424, 1200), box('back', 450, 596, 380)];
    let at = page[0] as NavTarget;
    const seen = [at.id];
    for (let i = 0; i < page.length - 1; i++) {
      const next = neighbour(at, page, 'down');
      at = page.find((t) => t.id === next) as NavTarget;
      seen.push(at.id);
    }
    expect(seen).toEqual(['music', 'track', 'vol', 'sfx', 'back']);
  });
});

describe('containsPoint', () => {
  it('includes the edges and excludes the outside', () => {
    const r = { x: 10, y: 20, w: 100, h: 50 };
    expect(containsPoint(r, 10, 20)).toBe(true);
    expect(containsPoint(r, 110, 70)).toBe(true);
    expect(containsPoint(r, 9, 30)).toBe(false);
    expect(containsPoint(r, 50, 71)).toBe(false);
  });
});

describe('PageStack', () => {
  it('opens pages on top of the root and closes them one at a time', () => {
    const stack = new PageStack('title');
    expect(stack.current).toBe('title');
    expect(stack.atRoot).toBe(true);
    stack.push('controls', 'controls-button');
    stack.push('padlayout', 'layout-button');
    expect(stack.current).toBe('padlayout');
    expect(stack.depth).toBe(3);
    expect(stack.pop()).toBe('controls');
    expect(stack.pop()).toBe('title');
    expect(stack.pop()).toBeNull(); // nothing below the root
    expect(stack.current).toBe('title');
  });

  it('remembers what was focused on each page it left, so back returns to the same button', () => {
    const stack = new PageStack('title');
    stack.push('audio', 'audio');
    expect(stack.recall('title')).toBe('audio');
    stack.push('x', 'something');
    expect(stack.recall('audio')).toBe('something');
    stack.reset('pause');
    expect(stack.current).toBe('pause');
    expect(stack.recall('title')).toBeNull();
  });

  it('keeps an earlier memory when the page is left without a focused item', () => {
    const stack = new PageStack('title');
    stack.push('a', 'one');
    stack.pop();
    stack.push('b', null);
    expect(stack.recall('title')).toBe('one');
  });
});
