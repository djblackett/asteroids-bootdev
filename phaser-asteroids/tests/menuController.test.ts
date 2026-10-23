import { describe, expect, it } from 'vitest';
import type { Rect } from '../src/ui/menu/focusNav';
import { MenuController, TRANSITION_LOCK_MS, type MenuItem, type MenuPageSpec } from '../src/ui/menu/menuController';

/** A test item that records what happened to it. */
class Item implements MenuItem {
  readonly log: string[] = [];
  enabled = true;
  constructor(
    readonly id: string,
    readonly rect: Rect,
    private readonly onActivate: (at: { x: number; y: number } | null) => void = () => undefined,
    readonly label = id,
  ) {}
  activate(at: { x: number; y: number } | null): void {
    this.log.push(at ? `tap@${at.x},${at.y}` : 'press');
    this.onActivate(at);
  }
}

class Slider extends Item {
  value = 5;
  adjust(direction: 1 | -1): boolean {
    this.value += direction;
    return true;
  }
}

const row = (y: number): Rect => ({ x: 40, y, w: 1200, h: 90 });

/** Two pages, `title` -> `audio`, like the real menu: the title has Play (Space), Audio, Controls; audio has a slider, a toggle and Back. */
function makeMenu() {
  const clock = { now: 0 };
  const built: string[] = [];
  const disposed: string[] = [];
  const state = { started: 0, muted: false };
  let menu!: MenuController;
  const slider = new Slider('volume', row(118));
  const pages: Record<string, () => MenuPageSpec> = {
    title: () => ({
      id: 'title',
      items: [new Item('play', row(112), () => state.started++), new Item('audio', row(250), () => menu.open('audio')), new Item('controls', row(350), () => menu.open('controls'))],
      hotkeys: { Space: () => state.started++, KeyZ: () => (state.muted = !state.muted) },
      dispose: () => disposed.push('title'),
    }),
    audio: () => ({
      id: 'audio',
      items: [slider, new Item('mute', row(220)), new Item('back', { x: 450, y: 596, w: 380, h: 90 }, () => menu.back())],
      dispose: () => disposed.push('audio'),
    }),
    controls: () => ({ id: 'controls', items: [new Item('steer', row(118)), new Item('back', { x: 450, y: 596, w: 380, h: 90 }, () => menu.back())], defaultFocus: 'back' }),
  };
  menu = new MenuController(
    (id) => {
      built.push(id);
      return (pages[id] as () => MenuPageSpec)();
    },
    'title',
    () => clock.now,
  );
  menu.start();
  return { menu, clock, built, disposed, state, slider };
}

describe('MenuController: keyboard and controller', () => {
  it('starts on the first item with the focus visible, and Down / Up move it', () => {
    const { menu } = makeMenu();
    expect(menu.focusId).toBe('play');
    expect(menu.focusVisible).toBe(true);
    menu.key('ArrowDown');
    expect(menu.focusId).toBe('audio');
    menu.key('ArrowUp');
    expect(menu.focusId).toBe('play');
    menu.pad('down');
    expect(menu.focusId).toBe('audio');
  });

  it('Enter, Space and A press the focused item; a page hotkey takes the key first', () => {
    const { menu, state } = makeMenu();
    menu.key('Enter');
    menu.pad('a');
    expect(state.started).toBe(2);
    menu.key('Space'); // the title page's own hotkey (PLAY from anywhere on it)
    expect(state.started).toBe(3);
    menu.key('ArrowDown');
    menu.key('Space'); // still the hotkey: Space on the title page always means PLAY
    expect(state.started).toBe(4);
    expect(menu.currentPage).toBe('title');
  });

  it('opens a submenu with Enter and returns with Escape, B or the BACK button to the same focused button', () => {
    const { menu } = makeMenu();
    menu.key('ArrowDown'); // audio
    menu.key('Enter');
    expect(menu.currentPage).toBe('audio');
    expect(menu.depth).toBe(2);
    expect(menu.key('Escape')).toBe(true);
    expect(menu.currentPage).toBe('title');
    expect(menu.focusId).toBe('audio'); // restored
    menu.pad('a');
    menu.pad('b');
    expect(menu.currentPage).toBe('title');
    menu.pad('a');
    menu.key('ArrowDown');
    menu.key('ArrowDown');
    expect(menu.focusId).toBe('back');
    menu.key('Enter');
    expect(menu.currentPage).toBe('title');
  });

  it('Escape at the root is not consumed (the title screen ignores it; the pause screen resumes on it, see backNavigation.test.ts)', () => {
    const { menu } = makeMenu();
    expect(menu.key('Escape')).toBe(false);
    expect(menu.pad('b')).toBe(false);
    expect(menu.currentPage).toBe('title');
  });

  it('Left / Right change a slider; on an item that does not adjust they try to move sideways, and an unused key is left alone', () => {
    const { menu, slider } = makeMenu();
    menu.key('ArrowDown');
    menu.key('Enter'); // audio page, focus on the slider
    expect(menu.focusId).toBe('volume');
    menu.key('ArrowRight');
    menu.key('ArrowRight');
    menu.pad('left');
    expect(slider.value).toBe(6);
    expect(menu.key('KeyQ')).toBe(false);
  });

  it('a disabled item takes the focus but does nothing when pressed', () => {
    const { menu, state } = makeMenu();
    (menu.items[0] as Item).enabled = false;
    menu.key('Enter');
    expect(state.started).toBe(0);
    expect(menu.items[0]?.id).toBe('play');
  });

  it('honours a page\'s default focus', () => {
    const { menu } = makeMenu();
    menu.key('ArrowDown');
    menu.key('ArrowDown');
    menu.key('Enter');
    expect(menu.currentPage).toBe('controls');
    expect(menu.focusId).toBe('back');
  });

  it('uses explicit page neighbours for mixed-width rows with both keys and gamepad', () => {
    const menu = new MenuController(() => ({
      id: 'mobile',
      items: [
        new Item('play', { x: 680, y: 112, w: 560, h: 120 }),
        new Item('practice', { x: 680, y: 244, w: 272, h: 90 }),
        new Item('scores', { x: 968, y: 244, w: 272, h: 90 }),
        new Item('controls', { x: 872, y: 346, w: 176, h: 90 }),
      ],
      focusNeighbours: { play: { down: 'practice' }, scores: { up: 'play' } },
    }), 'mobile', () => 0);
    menu.start();
    menu.key('ArrowDown');
    expect(menu.focusId).toBe('practice');
    menu.pad('right'); // No override: geometric navigation still works within the row.
    expect(menu.focusId).toBe('scores');
    menu.pad('up');
    expect(menu.focusId).toBe('play');
    menu.pad('down');
    expect(menu.focusId).toBe('practice');
  });

  it('ignores an explicit neighbour missing from the current page', () => {
    const menu = new MenuController(() => ({
      id: 'p', items: [new Item('a', row(0)), new Item('b', row(100))],
      focusNeighbours: { a: { down: 'missing' } },
    }), 'p', () => 0);
    menu.start();
    menu.key('ArrowDown');
    expect(menu.focusId).toBe('b');
  });
});

describe('MenuController: mouse and touch', () => {
  it('a click presses the item under it and focuses it; a click on nothing does nothing', () => {
    const { menu, state } = makeMenu();
    expect(menu.pointerDown(600, 700, 'mouse')).toBe(false);
    expect(state.started).toBe(0);
    expect(menu.pointerDown(600, 150, 'mouse')).toBe(true);
    expect(state.started).toBe(1);
    expect(menu.pressedId).toBe('play');
    menu.pointerUp();
    expect(menu.pressedId).toBeNull();
  });

  it('hover moves the focus for a mouse, never for a finger', () => {
    const { menu } = makeMenu();
    menu.pointerMove(600, 280, 'mouse');
    expect(menu.focusId).toBe('audio');
    expect(menu.source).toBe('pointer');
    menu.pointerMove(600, 380, 'touch');
    expect(menu.focusId).toBe('audio');
  });

  it('a finger tap hides the focus ring, and the next key shows it again', () => {
    const { menu } = makeMenu();
    menu.pointerDown(600, 150, 'touch');
    expect(menu.focusVisible).toBe(false);
    menu.key('ArrowDown');
    expect(menu.focusVisible).toBe(true);
  });

  it('a tap reports where it landed, so a row can tell its minus and plus apart', () => {
    const { menu } = makeMenu();
    const item = menu.items[1] as Item;
    menu.pointerDown(100, 280, 'touch');
    expect(item.log).toEqual(['tap@100,280']);
  });

  it('swallows taps right after a page change, so a double tap cannot hit the next page', () => {
    const { menu, clock } = makeMenu();
    clock.now = 1000;
    menu.pointerDown(600, 280, 'touch'); // AUDIO opens
    expect(menu.currentPage).toBe('audio');
    clock.now = 1000 + TRANSITION_LOCK_MS - 20;
    const volume = menu.items[0] as Slider;
    expect(menu.pointerDown(600, 150, 'touch')).toBe(true); // lands on the slider row: consumed, not pressed
    expect(volume.log).toEqual([]);
    clock.now = 1000 + TRANSITION_LOCK_MS + 20;
    menu.pointerDown(600, 150, 'touch');
    expect(volume.log).toHaveLength(1);
  });

  it('lockInput swallows taps the same way (a rebuild under the finger)', () => {
    const { menu, clock, state } = makeMenu();
    clock.now = 5000;
    menu.lockInput();
    menu.pointerDown(600, 150, 'touch');
    expect(state.started).toBe(0);
    clock.now = 5000 + TRANSITION_LOCK_MS + 1;
    menu.pointerDown(600, 150, 'touch');
    expect(state.started).toBe(1);
  });
});

describe('MenuController: pages come and go', () => {
  it('builds a page when it opens and disposes it when it closes, so nothing piles up', () => {
    const { menu, built, disposed } = makeMenu();
    expect(built).toEqual(['title']);
    for (let i = 0; i < 5; i++) {
      menu.open('audio');
      menu.key('Escape');
    }
    expect(built.filter((id) => id === 'audio')).toHaveLength(5);
    expect(disposed.filter((id) => id === 'audio')).toHaveLength(5);
    expect(disposed.filter((id) => id === 'title')).toHaveLength(5); // the parent is rebuilt on return
    expect(built.filter((id) => id === 'title')).toHaveLength(6);
  });

  it('closeAll drops every page and the stack, and start builds the root again', () => {
    const { menu, disposed, built } = makeMenu();
    menu.key('ArrowDown');
    menu.key('Enter');
    menu.closeAll();
    expect(disposed).toContain('audio');
    expect(menu.items).toEqual([]);
    menu.start();
    expect(menu.currentPage).toBe('title');
    expect(menu.depth).toBe(1);
    expect(built.at(-1)).toBe('title');
  });

  it('tells listeners about every page change, and a removed listener stops hearing', () => {
    const { menu } = makeMenu();
    const heard: string[] = [];
    const stop = menu.onPageChange((page, depth) => heard.push(`${page}:${depth}`));
    menu.key('ArrowDown');
    menu.key('Enter');
    menu.key('Escape');
    stop();
    menu.key('ArrowDown');
    menu.key('Enter');
    expect(heard).toEqual(['audio:2', 'title:1']);
  });

  it('refresh rebuilds a page whose signature changed and keeps the focus on the same item', () => {
    const clock = { now: 0 };
    let version = 1;
    let builds = 0;
    const menu = new MenuController(
      () => {
        builds++;
        return { id: 'p', items: [new Item('a', row(0)), new Item('b', row(100))], signature: () => String(version) };
      },
      'p',
      () => clock.now,
    );
    menu.start();
    menu.key('ArrowDown');
    menu.refresh();
    expect(builds).toBe(1);
    version = 2;
    menu.refresh();
    expect(builds).toBe(2);
    expect(menu.focusId).toBe('b');
    menu.refresh();
    expect(builds).toBe(2);
  });

  it('falls back to the default focus when the focused item disappears in a rebuild', () => {
    let wide = true;
    const menu = new MenuController(
      () => ({ id: 'p', items: wide ? [new Item('a', row(0)), new Item('extra', row(100))] : [new Item('a', row(0))], signature: () => String(wide) }),
      'p',
      () => 0,
    );
    menu.start();
    menu.key('ArrowDown');
    expect(menu.focusId).toBe('extra');
    wide = false;
    menu.refresh();
    expect(menu.focusId).toBe('a');
  });

  it('describes itself for browser tests', () => {
    const { menu } = makeMenu();
    const snap = menu.snapshot();
    expect(snap.page).toBe('title');
    expect(snap.focus).toBe('play');
    expect(snap.items.map((i) => i.label)).toEqual(['play', 'audio', 'controls']);
    expect(snap.items[0]).toMatchObject({ x: 40, y: 112, w: 1200, h: 90, enabled: true, focused: true });
  });

  it('a page hotkey runs and counts as keyboard use', () => {
    const { menu, state } = makeMenu();
    menu.pointerDown(600, 150, 'touch');
    expect(menu.key('KeyZ')).toBe(true);
    expect(state.muted).toBe(true);
    expect(menu.focusVisible).toBe(true);
  });
});
