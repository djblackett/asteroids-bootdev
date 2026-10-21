import { describe, expect, it } from 'vitest';
import type { GameSim } from '../src/core/game';
import { NO_INPUT } from '../src/core/player';
import { createKeyPressRouter, type KeyEventLike } from '../src/input/keyPress';
import { handleBack, type BackEnv, type BackOutcome } from '../src/ui/menu/backAction';
import type { Rect } from '../src/ui/menu/focusNav';
import { MenuController, type MenuItem, type MenuPageSpec } from '../src/ui/menu/menuController';
import { quietSim, runFor } from './helpers';

/**
 * Escape / BACK / B: the navigation rules from the menu brief. `GameScene` is Phaser glue, so this wires the same pieces it wires
 * (`handleBack`, a `MenuController` with the pause menu's page tree, the one-shot key filter, a real `GameSim`) around a small fake run.
 */

class Item implements MenuItem {
  enabled = true;
  constructor(
    readonly id: string,
    readonly rect: Rect,
    private readonly onActivate: () => void = () => undefined,
  ) {}
  get label(): string {
    return this.id;
  }
  activate(): void {
    this.onActivate();
  }
}

const row = (y: number): Rect => ({ x: 40, y, w: 600, h: 90 });
const BACK: Rect = { x: 450, y: 596, w: 380, h: 90 };

/** The pause menu: RESUME, AUDIO, CONTROLS (-> PADLAYOUT), RETURN TO MENU (two presses). Same shape as `GameScene.createPauseMenu`. */
function makeRun() {
  const clock = { now: 0 };
  const run = { paused: false, gameOver: false, menuShown: false, resumes: 0, toMenu: 0, guardRaised: 0, armed: false };
  let menu!: MenuController;
  const nav = { open: (id: string) => menu.open(id), back: () => void menu.back() };
  const backItem = () => new Item('back', BACK, () => nav.back());
  const pages: Record<string, () => MenuPageSpec> = {
    pause: () => ({
      id: 'pause',
      items: [
        new Item('resume', row(168), () => resumeFromMenu()),
        new Item('audio', row(288), () => nav.open('audio')),
        new Item('controls', row(394), () => nav.open('controls')),
        new Item('menu', row(500), () => {
          // RETURN TO MENU: the first press arms, the second leaves (the widget does this for real).
          if (run.armed) run.toMenu++;
          run.armed = !run.armed;
        }),
      ],
      defaultFocus: 'resume',
    }),
    audio: () => ({ id: 'audio', items: [new Item('music', row(118)), backItem()] }),
    controls: () => ({ id: 'controls', items: [new Item('steering', row(118)), new Item('pads', row(220), () => nav.open('padlayout')), backItem()] }),
    padlayout: () => ({ id: 'padlayout', items: [backItem()], defaultFocus: 'back' }),
  };
  menu = new MenuController((id) => (pages[id] as () => MenuPageSpec)(), 'pause', () => clock.now);

  const sim = quietSim(7);
  let simTime = 0;
  const frame = (seconds = 1 / 60): void => {
    // Mirrors GameScene.update: the menu is built a frame after the pause, and the sim only steps while playing.
    if (run.paused && !run.menuShown) {
      run.menuShown = true;
      menu.start();
    } else if (!run.paused && run.menuShown) {
      run.menuShown = false;
      menu.closeAll();
    }
    if (!run.paused) {
      runFor(sim, seconds, NO_INPUT);
      simTime += seconds;
    }
    clock.now += seconds * 1000;
  };
  const togglePause = (): void => void (run.paused = !run.paused);
  function resumeFromMenu(): void {
    if (!run.paused) return;
    run.guardRaised++;
    togglePause();
  }
  const env = (): BackEnv => ({
    gameOver: run.gameOver,
    paused: run.paused,
    menuShown: run.menuShown,
    menuBack: () => menu.back(),
    pause: togglePause,
    resume: resumeFromMenu,
    leaveFinishedRun: () => void run.toMenu++,
  });
  /** Escape and BACK; `B` is only ever sent while the pause menu is open (it is Boost otherwise). */
  const escape = (): BackOutcome => handleBack(env());
  const padB = (): BackOutcome | null => (run.paused && !run.gameOver ? handleBack(env()) : null);
  return { run, menu, sim, frame, escape, padB, togglePause, simTime: () => simTime, clock };
}

const key = (code: string, repeat = false): KeyEventLike => ({ code, repeat });

describe('handleBack', () => {
  const call = (state: Partial<Pick<BackEnv, 'gameOver' | 'paused' | 'menuShown'>>, menuBack = false) => {
    const log: string[] = [];
    const outcome = handleBack({
      gameOver: false,
      paused: false,
      menuShown: false,
      ...state,
      menuBack: () => (log.push('menuBack'), menuBack),
      pause: () => void log.push('pause'),
      resume: () => void log.push('resume'),
      leaveFinishedRun: () => void log.push('leave'),
    });
    return { outcome, log };
  };

  it('pauses a run in progress', () => expect(call({})).toEqual({ outcome: 'paused', log: ['pause'] }));
  it('resumes from the pause menu itself', () => expect(call({ paused: true, menuShown: true })).toEqual({ outcome: 'resumed', log: ['menuBack', 'resume'] }));
  it('closes an open pause page and does nothing else', () => expect(call({ paused: true, menuShown: true }, true)).toEqual({ outcome: 'closed-page', log: ['menuBack'] }));
  it('only leaves once the run is over', () => expect(call({ gameOver: true })).toEqual({ outcome: 'left', log: ['leave'] }));
  it('ignores a press that lands before the pause menu exists (P then Escape in the same frame)', () =>
    expect(call({ paused: true, menuShown: false })).toEqual({ outcome: 'ignored', log: [] }));
});

describe('Escape through a run', () => {
  it('1-2. pauses while playing, then resumes from the pause menu', () => {
    const t = makeRun();
    t.frame();
    expect(t.escape()).toBe('paused');
    expect(t.run.paused).toBe(true);
    t.frame();
    expect(t.menu.currentPage).toBe('pause');
    expect(t.escape()).toBe('resumed');
    expect(t.run.paused).toBe(false);
    t.frame();
    expect(t.run.toMenu).toBe(0);
  });

  it.each([
    ['audio', ['ArrowDown']],
    ['controls', ['ArrowDown', 'ArrowDown']],
  ])('3-4. Pause > %s > Escape returns to the pause menu: still paused, not resumed, not left, same button lit', (page, downs) => {
    const t = makeRun();
    t.escape();
    t.frame();
    for (const d of downs) t.menu.key(d);
    t.menu.key('Enter');
    expect(t.menu.currentPage).toBe(page);
    expect(t.escape()).toBe('closed-page');
    expect(t.menu.currentPage).toBe('pause');
    expect(t.menu.focusId).toBe(page);
    expect(t.run.paused).toBe(true);
    expect(t.run.guardRaised).toBe(0);
    expect(t.run.toMenu).toBe(0);
  });

  it('a page two levels down (CONTROLS > controller layout) takes one Escape per level', () => {
    const t = makeRun();
    t.escape();
    t.frame();
    t.menu.open('controls');
    t.menu.open('padlayout');
    expect(t.escape()).toBe('closed-page');
    expect(t.menu.currentPage).toBe('controls');
    expect(t.escape()).toBe('closed-page');
    expect(t.menu.currentPage).toBe('pause');
    expect(t.run.paused).toBe(true);
    expect(t.escape()).toBe('resumed');
  });

  it('9. Escape never abandons an active run, however often it is pressed', () => {
    const t = makeRun();
    t.frame();
    for (let i = 0; i < 40; i++) {
      t.escape();
      t.frame();
      if (i % 3 === 0 && t.run.paused) t.menu.open(i % 2 ? 'audio' : 'controls');
      t.frame();
    }
    expect(t.run.toMenu).toBe(0);
  });

  it('10. RETURN TO MENU still needs its second press, and only it leaves', () => {
    const t = makeRun();
    t.escape();
    t.frame();
    t.menu.key('ArrowDown');
    t.menu.key('ArrowDown');
    t.menu.key('ArrowDown');
    expect(t.menu.focusId).toBe('menu');
    t.menu.key('Enter');
    expect(t.run.toMenu).toBe(0);
    t.menu.key('Enter');
    expect(t.run.toMenu).toBe(1);
  });

  it('after Game Over Escape leaves for the title (the run is already over)', () => {
    const t = makeRun();
    t.run.gameOver = true;
    expect(t.escape()).toBe('left');
    expect(t.run.toMenu).toBe(1);
  });

  it('a controller press of B / BACK does the same as Escape on the pause menu, and B does nothing while playing', () => {
    const t = makeRun();
    expect(t.padB()).toBeNull(); // playing: B is Boost
    t.escape(); // BACK pauses just like Escape
    t.frame();
    t.menu.open('audio');
    expect(t.padB()).toBe('closed-page');
    expect(t.menu.currentPage).toBe('pause');
    expect(t.padB()).toBe('resumed');
    expect(t.run.paused).toBe(false);
    expect(t.run.toMenu).toBe(0);
  });

  it('11. the BACK button (mouse or finger) does what Escape does', () => {
    const t = makeRun();
    t.escape();
    t.frame();
    t.menu.open('controls');
    t.clock.now += 1000;
    const back = t.menu.items.find((i) => i.id === 'back') as MenuItem;
    t.menu.pointerDown(back.rect.x + 5, back.rect.y + 5, 'touch');
    expect(t.menu.currentPage).toBe('pause');
    expect(t.run.paused).toBe(true);
    expect(t.run.toMenu).toBe(0);
  });

  it('a second press that lands in the frame of the first, before the menu exists, does not resume or leave', () => {
    const t = makeRun();
    expect(t.escape()).toBe('paused');
    expect(t.escape()).toBe('ignored'); // same frame: no menu yet
    expect(t.run.paused).toBe(true);
    t.frame();
    expect(t.run.menuShown).toBe(true);
  });
});

describe('13. one physical press is one step', () => {
  it('holding Escape (auto-repeat) and engine replays go back exactly one page', () => {
    const t = makeRun();
    t.escape();
    t.frame();
    t.menu.open('controls');
    t.menu.open('padlayout');
    const outcomes: BackOutcome[] = [];
    const router = createKeyPressRouter((code) => {
      if (code === 'Escape') outcomes.push(t.escape());
    });
    const down = key('Escape');
    router(down);
    router(down); // Phaser 4.2.1 replays queued events when another key arrives in the same frame
    for (let i = 0; i < 20; i++) router(key('Escape', true)); // auto-repeat while it is held
    expect(outcomes).toEqual(['closed-page']);
    expect(t.menu.currentPage).toBe('controls');
    expect(t.run.paused).toBe(true);
    router(key('Escape')); // a second, separate press goes one more step
    expect(t.menu.currentPage).toBe('pause');
  });

  it('holding Escape on the pause menu resumes once and does not pause again', () => {
    const t = makeRun();
    t.escape();
    t.frame();
    const outcomes: BackOutcome[] = [];
    const router = createKeyPressRouter((code) => code === 'Escape' && outcomes.push(t.escape()));
    router(key('Escape'));
    for (let i = 0; i < 20; i++) {
      router(key('Escape', true));
      t.frame();
    }
    expect(outcomes).toEqual(['resumed']);
    expect(t.run.paused).toBe(false);
  });
});

describe('15. the paused game is untouched by menu navigation', () => {
  const snapshot = (sim: GameSim) => JSON.stringify({ t: sim.time, p: sim.player.position, a: sim.asteroids.map((a) => a.position), score: sim.player.score, lives: sim.player.lives });

  it('entering and leaving AUDIO / CONTROLS freezes the simulation; resuming continues from the same moment', () => {
    const t = makeRun();
    for (let i = 0; i < 30; i++) t.frame();
    t.escape();
    t.frame();
    const frozen = snapshot(t.sim);
    for (const page of ['audio', 'controls', 'audio']) {
      t.menu.open(page);
      for (let i = 0; i < 20; i++) t.frame();
      t.escape();
      for (let i = 0; i < 20; i++) t.frame();
    }
    expect(snapshot(t.sim)).toBe(frozen);
    expect(t.run.paused).toBe(true);
    t.escape();
    t.frame();
    t.frame();
    expect(snapshot(t.sim)).not.toBe(frozen);
  });

  it('14. resuming raises the shot guard once, so the key that resumed cannot also fire', () => {
    const t = makeRun();
    t.escape();
    t.frame();
    t.escape();
    expect(t.run.guardRaised).toBe(1);
    t.escape(); // pauses again
    t.frame();
    t.menu.open('audio');
    t.escape(); // closes the page: not a resume, so no guard
    expect(t.run.guardRaised).toBe(1);
  });
});

describe('5-8. the title screen: every sub-page returns to the title page, and the title page itself does nothing destructive', () => {
  function makeTitle() {
    const clock = { now: 0 };
    const state = { started: 0 };
    let menu!: MenuController;
    const nav = { open: (id: string) => menu.open(id), back: () => void menu.back() };
    const sub = (id: string): MenuPageSpec => ({ id, items: [new Item('setting', row(118)), new Item('back', BACK, () => nav.back())] });
    const pages: Record<string, () => MenuPageSpec> = {
      title: () => ({
        id: 'title',
        items: [
          new Item('play', row(112), () => state.started++),
          new Item('audio', row(250), () => nav.open('audio')),
          new Item('controls', row(350), () => nav.open('controls')),
          new Item('coop', row(450), () => nav.open('coop')),
          new Item('powerups', row(550), () => nav.open('powerups')),
        ],
      }),
      audio: () => sub('audio'),
      controls: () => sub('controls'),
      coop: () => sub('coop'),
      powerups: () => sub('powerups'),
    };
    menu = new MenuController((id) => (pages[id] as () => MenuPageSpec)(), 'title', () => clock.now);
    menu.start();
    return { menu, state };
  }

  it.each(['audio', 'controls', 'powerups', 'coop'])('Title > %s > Escape (or B / BACK) returns to the title page with that button lit', (page) => {
    for (const how of ['key', 'pad'] as const) {
      const { menu, state } = makeTitle();
      menu.focusId = page; // as if its button had been focused and pressed
      menu.open(page);
      expect(menu.depth).toBe(2);
      expect(how === 'key' ? menu.key('Escape') : menu.pad('b')).toBe(true);
      expect(menu.currentPage).toBe('title');
      expect(menu.atRoot).toBe(true);
      expect(menu.focusId).toBe(page); // restored to the button that opened it
      expect(state.started).toBe(0); // never starts a game
    }
  });

  it('Escape on the title page itself is not used and changes nothing', () => {
    const { menu, state } = makeTitle();
    menu.key('ArrowDown');
    const focus = menu.focusId;
    expect(menu.key('Escape')).toBe(false);
    expect(menu.pad('b')).toBe(false);
    expect(menu.currentPage).toBe('title');
    expect(menu.focusId).toBe(focus);
    expect(state.started).toBe(0);
  });
});
