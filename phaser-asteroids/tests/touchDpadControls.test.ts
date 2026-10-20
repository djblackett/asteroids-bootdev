import { describe, expect, it } from 'vitest';
import { TouchControls } from '../src/input/touchControls';
import { FakeDoc, FakeHost, FakeView, LAYOUT, pointer } from './touchFakes';
import { centre } from './touchFakes';

/**
 * The D-pad through the whole touch stack: DOM-style pointer events on a fake pad element -> binding -> model -> facade -> view.
 * Covers the lifecycle rules (release, cancel, focus loss, rotation, pause, restart, fullscreen) and multi-touch with the buttons.
 * Pad rectangle (see touchFakes): 20..190 x 190..360, centre (105, 275), radius 85.
 */

const CX = 105;
const CY = 275;
const R = 85;
const NEUTRAL = { rotate: 0, move: 0, shoot: false, laser: false, boost: false };

function at(angle: number, distance = 0.7): { x: number; y: number } {
  const a = (angle * Math.PI) / 180;
  return { x: CX + Math.sin(a) * distance * R, y: CY - Math.cos(a) * distance * R };
}

function rig(steering: 'dpad' | 'joystick' = 'dpad') {
  const view = new FakeView();
  const host = new FakeHost();
  const doc = new FakeDoc();
  const touch = new TouchControls(view, host, doc);
  touch.setActive(true);
  touch.setSteering(steering);
  touch.setLayer('play');
  const down = (id: number, x: number, y: number) => {
    const event = pointer('pointerdown', id, x, y);
    view.elements.dpad.dispatchEvent(event);
    return event;
  };
  const pad = (id: number, angle: number, distance = 0.7) => {
    const p = at(angle, distance);
    return down(id, p.x, p.y);
  };
  const button = (control: 'fire' | 'laser' | 'boost' | 'pause', id: number): void => {
    const p = centre(LAYOUT[control]);
    view.elements[control].dispatchEvent(pointer('pointerdown', id, p.x, p.y));
  };
  const move = (id: number, x: number, y: number): void => void host.dispatchEvent(pointer('pointermove', id, x, y));
  const slide = (id: number, angle: number, distance = 0.7): void => {
    const p = at(angle, distance);
    move(id, p.x, p.y);
  };
  const up = (id: number, x = 0, y = 0): void => void host.dispatchEvent(pointer('pointerup', id, x, y));
  const cancel = (id: number): void => void host.dispatchEvent(pointer('pointercancel', id));
  const turn = (portrait: boolean): void => {
    host.innerWidth = portrait ? 390 : 844;
    host.innerHeight = portrait ? 844 : 390;
    host.dispatchEvent(new Event('resize'));
  };
  return { view, host, doc, touch, down, pad, button, move, slide, up, cancel, turn };
}

describe('D-pad through the browser wiring', () => {
  it('the pad reads its direction from where the thumb lands, for all eight directions', () => {
    const expected: Array<[number, number, number]> = [
      [0, 0, 1],
      [45, 1, 1],
      [90, 1, 0],
      [135, 1, -1],
      [180, 0, -1],
      [225, -1, -1],
      [270, -1, 0],
      [315, -1, 1],
    ];
    for (const [angle, rotate, move] of expected) {
      const r = rig();
      r.pad(1, angle);
      expect(r.touch.command()).toEqual({ ...NEUTRAL, rotate, move });
    }
  });

  it('prevents the default on pointer down and asks for capture on the pad', () => {
    const r = rig();
    expect(r.pad(1, 0).prevented).toBe(true);
    expect(r.view.elements.dpad.captured.has(1)).toBe(true);
  });

  it('works when pointer capture is refused (the window listeners still track the finger)', () => {
    const r = rig();
    r.view.elements.dpad.captureThrows = true;
    r.pad(1, 270);
    r.slide(1, 90);
    expect(r.touch.command().rotate).toBe(1);
  });

  it('short taps: down and up with no move in between still steer, and let go cleanly', () => {
    const r = rig();
    const seen: number[] = [];
    for (const angle of [90, 270, 0]) {
      r.pad(1, angle);
      seen.push(r.touch.command().rotate * 10 + r.touch.command().move);
      const p = at(angle);
      r.up(1, p.x, p.y);
      seen.push(r.touch.command().rotate + r.touch.command().move);
    }
    expect(seen).toEqual([10, 0, -10, 0, 1, 0]);
  });

  it('sliding between directions changes the command without lifting', () => {
    const r = rig();
    r.pad(1, 0);
    r.slide(1, 45);
    expect(r.touch.command()).toMatchObject({ rotate: 1, move: 1 });
    r.slide(1, 90);
    expect(r.touch.command()).toMatchObject({ rotate: 1, move: 0 });
    r.slide(1, 225);
    expect(r.touch.command()).toMatchObject({ rotate: -1, move: -1 });
    r.slide(1, 315);
    expect(r.touch.command()).toMatchObject({ rotate: -1, move: 1 });
  });

  it('sliding outside the pad keeps the direction, and lifting outside releases it', () => {
    const r = rig();
    r.pad(1, 0);
    r.move(1, CX, 5); // far above the pad, over the playfield
    expect(r.touch.command()).toMatchObject({ rotate: 0, move: 1 });
    r.move(1, 600, 40); // far to the right, across the screen
    expect(r.touch.command().rotate).toBe(1);
    r.up(1, 600, 40);
    expect(r.touch.command()).toEqual(NEUTRAL);
  });

  it('a finger that leaves the pad over FIRE does not press FIRE', () => {
    const r = rig();
    r.pad(1, 90);
    const fire = centre(LAYOUT.fire);
    r.move(1, fire.x, fire.y);
    expect(r.touch.command().shoot).toBe(false);
  });

  it('a cancelled pointer (a system gesture took it) releases at once and never counts as a tap', () => {
    const r = rig();
    r.pad(1, 45);
    r.cancel(1);
    expect(r.touch.command()).toEqual(NEUTRAL);
    expect(r.touch.model.activePointers).toBe(0);
  });

  it('a lost capture releases too (the pad was hidden under the finger)', () => {
    const r = rig();
    r.pad(1, 45);
    r.host.dispatchEvent(pointer('lostpointercapture', 1));
    expect(r.touch.command()).toEqual(NEUTRAL);
  });

  it('events from a pointer that is not ours are ignored', () => {
    const r = rig();
    r.pad(1, 270);
    r.move(99, 500, 50);
    r.up(99);
    r.cancel(99);
    expect(r.touch.command().rotate).toBe(-1);
  });

  it('the pad is measured at the moment of the touch, so a pad that has moved (fullscreen, resize) is still aimed correctly', () => {
    const r = rig();
    // Fullscreen made the pad 40 px lower and bigger: new rectangle 20..240 x 240..460, centre (130, 350), radius 110.
    r.view.elements.dpad.rect = { left: 20, top: 240, right: 240, bottom: 460 };
    r.down(1, 130 + 80, 350); // 80 px right of the new centre: Right
    expect(r.touch.command()).toMatchObject({ rotate: 1, move: 0 });
    r.up(1);
    r.down(2, 130, 350 - 80); // 80 px above the new centre: Up
    expect(r.touch.command()).toMatchObject({ rotate: 0, move: 1 });
  });

  it('a resize under a held thumb re-aims it instead of leaving a stale direction', () => {
    const r = rig();
    r.pad(1, 0); // Up
    r.view.elements.dpad.rect = { left: 20, top: -200, right: 190, bottom: -30 }; // the pad jumps far above the thumb
    r.host.dispatchEvent(new Event('resize'));
    expect(r.touch.command()).toMatchObject({ rotate: 0, move: -1 });
  });
});

describe('D-pad with FIRE, LASER and BOOST (multi-touch)', () => {
  it('D-pad + FIRE: steering and shooting at once, each on its own pointer', () => {
    const r = rig();
    r.pad(1, 270);
    r.button('fire', 2);
    expect(r.touch.command()).toEqual({ ...NEUTRAL, rotate: -1, shoot: true });
    expect(r.touch.model.activePointers).toBe(2);
  });

  it('D-pad diagonal + FIRE + LASER + BOOST', () => {
    const r = rig();
    r.pad(1, 45);
    r.button('fire', 2);
    r.button('laser', 3);
    r.button('boost', 4);
    expect(r.touch.command()).toEqual({ rotate: 1, move: 1, shoot: true, laser: true, boost: true });
  });

  it('lifting FIRE keeps steering; lifting the pad keeps FIRE', () => {
    const r = rig();
    r.pad(1, 0);
    r.button('fire', 2);
    r.up(2);
    expect(r.touch.command()).toEqual({ ...NEUTRAL, move: 1 });
    r.button('fire', 3);
    r.up(1);
    expect(r.touch.command()).toEqual({ ...NEUTRAL, shoot: true });
  });

  it('draws the arms that are held and the buttons that are down', () => {
    const r = rig();
    r.pad(1, 315);
    r.button('laser', 2);
    expect(r.view.dpad).toEqual({ active: true, up: true, down: false, left: true, right: false });
    expect(r.view.pressed.laser).toBe(true);
    r.slide(1, 180);
    expect(r.view.dpad).toMatchObject({ up: false, down: true, left: false, right: false });
    r.up(1);
    expect(r.view.dpad).toEqual({ active: false, up: false, down: false, left: false, right: false });
  });
});

describe('D-pad lifecycle', () => {
  it('pause (the scene lets go of everything) leaves a neutral pad, and the pad works again after resuming', () => {
    const r = rig();
    r.pad(1, 270);
    r.touch.releaseAll();
    expect(r.touch.command()).toEqual(NEUTRAL);
    r.up(1); // the late lift of the old finger changes nothing
    expect(r.touch.command()).toEqual(NEUTRAL);
    r.pad(2, 90);
    expect(r.touch.command().rotate).toBe(1);
  });

  it('leaving the play layer (pause, game over) hides the controls and releases the pad; a restart begins neutral', () => {
    const r = rig();
    r.pad(1, 0);
    r.button('fire', 2);
    r.touch.setLayer('menu');
    expect(r.view.layer).toBe('menu');
    expect(r.touch.command()).toEqual(NEUTRAL);
    r.touch.setLayer('off');
    r.touch.setLayer('play');
    expect(r.view.layer).toBe('play');
    expect(r.touch.command()).toEqual(NEUTRAL);
    r.up(1);
    r.up(2);
    expect(r.touch.command()).toEqual(NEUTRAL);
  });

  it('lost window focus, a hidden tab and pagehide each release the pad', () => {
    for (const how of ['blur', 'pagehide', 'hidden'] as const) {
      const r = rig();
      r.pad(1, 45);
      r.button('fire', 2);
      if (how === 'hidden') {
        r.doc.hidden = true;
        r.doc.dispatchEvent(new Event('visibilitychange'));
      } else {
        r.host.dispatchEvent(new Event(how));
      }
      expect(r.touch.command()).toEqual(NEUTRAL);
      expect(r.touch.model.activePointers).toBe(0);
    }
  });

  it('turning to portrait releases the pad, hides the controls and asks the game to pause; turning back leaves it neutral', () => {
    const r = rig();
    let portraitEvents = 0;
    r.touch.onPortrait(() => portraitEvents++);
    r.pad(1, 90);
    r.turn(true);
    expect(portraitEvents).toBe(1);
    expect(r.view.layer).toBe('off');
    expect(r.touch.command()).toEqual(NEUTRAL);
    r.up(1);
    r.turn(false);
    expect(r.view.layer).toBe('play');
    expect(r.touch.command()).toEqual(NEUTRAL);
    r.pad(2, 270);
    expect(r.touch.command().rotate).toBe(-1);
  });

  it('a plain resize (a toolbar sliding away) does not drop the thumb', () => {
    const r = rig();
    r.pad(1, 90);
    r.host.innerHeight = 420;
    r.host.dispatchEvent(new Event('resize'));
    expect(r.touch.command().rotate).toBe(1);
  });

  it('entering or leaving fullscreen releases the pad and tells the game the viewport changed', () => {
    const r = rig();
    r.pad(1, 90);
    r.button('fire', 2);
    r.doc.dispatchEvent(new Event('fullscreenchange'));
    expect(r.touch.command()).toEqual(NEUTRAL);
    r.pad(3, 0);
    r.doc.dispatchEvent(new Event('webkitfullscreenchange'));
    expect(r.touch.command()).toEqual(NEUTRAL);
  });

  it('fullscreen changes while nothing is held do not disturb anything', () => {
    const r = rig();
    r.doc.dispatchEvent(new Event('fullscreenchange'));
    expect(r.view.layer).toBe('play');
    expect(r.touch.command()).toEqual(NEUTRAL);
  });

  it('after a fullscreen change the stick radius follows the new viewport', () => {
    const r = rig();
    r.host.innerWidth = 932;
    r.host.innerHeight = 430;
    r.doc.dispatchEvent(new Event('fullscreenchange'));
    expect(r.touch.model.stickRadius).toBe(65);
  });

  it('destroy removes every listener the D-pad added', () => {
    const r = rig();
    r.pad(1, 0);
    r.touch.destroy();
    expect(r.host.listenerTotal).toBe(0);
    expect(r.doc.listenerTotal).toBe(0);
    for (const element of Object.values(r.view.elements)) expect(element.listenerTotal).toBe(0);
  });
});

describe('switching between joystick and D-pad', () => {
  it('the live control is shown and the other is removed (the view is told which)', () => {
    const r = rig('joystick');
    expect(r.view.steering).toBe('joystick');
    r.touch.setSteering('dpad');
    expect(r.view.steering).toBe('dpad');
    expect(r.touch.steering).toBe('dpad');
    r.touch.setSteering('joystick');
    expect(r.view.steering).toBe('joystick');
  });

  it('switching while the joystick is held releases it and the pad works straight away', () => {
    const r = rig('joystick');
    r.view.elements.stick.dispatchEvent(pointer('pointerdown', 1, 100, 300));
    r.move(1, 40, 250);
    r.button('fire', 2);
    expect(r.touch.command().rotate).toBeLessThan(0);
    r.touch.setSteering('dpad');
    expect(r.touch.command()).toEqual(NEUTRAL);
    expect(r.view.stick?.active).toBe(false);
    r.move(1, 10, 10); // the old finger keeps moving: ignored
    expect(r.touch.command()).toEqual(NEUTRAL);
    r.pad(3, 0);
    expect(r.touch.command().move).toBe(1);
  });

  it('switching while the pad is held releases the turn, and the joystick works afterwards', () => {
    const r = rig('dpad');
    r.pad(1, 270);
    r.touch.setSteering('joystick');
    expect(r.touch.command()).toEqual(NEUTRAL);
    expect(r.view.dpad?.active).toBe(false);
    r.view.elements.stick.dispatchEvent(pointer('pointerdown', 2, 100, 300));
    r.move(2, 100 + 70, 300);
    expect(r.touch.command().rotate).toBe(1);
  });

  it('the hidden control is inert: the joystick zone ignores touches in D-pad mode and the pad ignores them in joystick mode', () => {
    const dpadMode = rig('dpad');
    dpadMode.view.elements.stick.dispatchEvent(pointer('pointerdown', 1, 100, 300));
    expect(dpadMode.touch.model.activePointers).toBe(0);
    const stickMode = rig('joystick');
    stickMode.pad(1, 0);
    expect(stickMode.touch.model.activePointers).toBe(0);
  });

  it('both modes work with FIRE, LASER and BOOST', () => {
    for (const mode of ['joystick', 'dpad'] as const) {
      const r = rig(mode);
      if (mode === 'dpad') r.pad(1, 0);
      else {
        r.view.elements.stick.dispatchEvent(pointer('pointerdown', 1, 100, 300));
        r.move(1, 100, 240);
      }
      r.button('fire', 2);
      r.button('laser', 3);
      r.button('boost', 4);
      expect(r.touch.command()).toMatchObject({ move: expect.any(Number), shoot: true, laser: true, boost: true });
      expect(r.touch.command().move).toBeGreaterThan(0);
    }
  });

  it('switching does not affect the touch mode (still active) or the layer', () => {
    const r = rig('joystick');
    r.touch.setSteering('dpad');
    expect(r.touch.isActive).toBe(true);
    expect(r.view.layer).toBe('play');
  });
});

describe('the menu layer', () => {
  it('shows only in touch mode and not under the rotate prompt, and never holds a finger', () => {
    const r = rig();
    r.touch.setLayer('menu');
    expect(r.view.layer).toBe('menu');
    r.turn(true);
    expect(r.view.layer).toBe('off');
    r.turn(false);
    expect(r.view.layer).toBe('menu');
    r.touch.setActive(false);
    expect(r.view.layer).toBe('off');
    r.touch.setActive(true);
    expect(r.view.layer).toBe('menu');
  });
});
