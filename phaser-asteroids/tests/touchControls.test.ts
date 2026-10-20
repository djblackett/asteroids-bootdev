import { describe, expect, it } from 'vitest';
import { LASER_BEAM_MAX_SHOTS } from '../src/core/constants';
import { createPlayer } from '../src/core/player';
import { TouchControls } from '../src/input/touchControls';
import { abilityLabels } from '../src/ui/touchLabels';
import { centre, FakeDoc, FakeHost, FakeView, LAYOUT, pointer } from './touchFakes';

/** The game-wide touch input: mode, layer (what is on screen), portrait handling, pause, cleanup. */

const NEUTRAL = { rotate: 0, move: 0, shoot: false, laser: false, boost: false };

function rig(active = true) {
  const view = new FakeView();
  const host = new FakeHost();
  const doc = new FakeDoc();
  const touch = new TouchControls(view, host, doc);
  touch.setActive(active);
  const down = (control: keyof typeof view.elements, id: number, at = centre(LAYOUT[control])): void =>
    void view.elements[control].dispatchEvent(pointer('pointerdown', id, at.x, at.y));
  const turn = (portrait: boolean): void => {
    host.innerWidth = portrait ? 390 : 844;
    host.innerHeight = portrait ? 844 : 390;
    host.dispatchEvent(new Event('resize'));
  };
  return { view, host, doc, touch, down, turn };
}

describe('TouchControls: mode and layer', () => {
  it('is inert and invisible until touch mode is on', () => {
    const r = rig(false);
    r.touch.setLayer('play');
    expect(r.view.layer).toBe('off');
    r.down('fire', 1);
    expect(r.touch.command()).toEqual(NEUTRAL);
    expect(r.view.active).toBe(false);
  });

  it('shows the controls only in touch mode while a run is being played', () => {
    const r = rig();
    expect(r.view.active).toBe(true);
    expect(r.view.layer).toBe('off'); // menus, before a run
    r.touch.setLayer('play');
    expect(r.view.layer).toBe('play');
    r.down('fire', 1);
    expect(r.touch.command().shoot).toBe(true);
  });

  it('taking the layer away (pause, game over, leaving the scene) lets go of every finger', () => {
    const r = rig();
    r.touch.setLayer('play');
    r.down('stick', 1, { x: 100, y: 300 });
    r.down('fire', 2);
    r.touch.setLayer('off');
    expect(r.touch.command()).toEqual(NEUTRAL);
    expect(r.view.layer).toBe('off');
    // Coming back starts from nothing.
    r.touch.setLayer('play');
    expect(r.touch.command()).toEqual(NEUTRAL);
  });

  it('switching touch mode off mid-hold releases everything and hides the controls', () => {
    const r = rig();
    r.touch.setLayer('play');
    r.down('fire', 1);
    r.touch.setActive(false);
    expect(r.touch.command()).toEqual(NEUTRAL);
    expect(r.view.layer).toBe('off');
    expect(r.view.active).toBe(false);
    r.touch.setActive(true);
    expect(r.view.layer).toBe('play'); // the scene's layer choice survives a mode round trip
    expect(r.touch.command()).toEqual(NEUTRAL);
  });

  it('releaseAll (pause) forgets every finger but keeps the controls shown', () => {
    const r = rig();
    r.touch.setLayer('play');
    r.down('fire', 1);
    r.touch.releaseAll();
    expect(r.touch.command()).toEqual(NEUTRAL);
    expect(r.view.layer).toBe('play');
  });

  it('draws what the model holds', () => {
    const r = rig();
    r.touch.setLayer('play');
    r.down('fire', 1);
    r.down('laser', 2);
    expect(r.view.pressed).toMatchObject({ fire: true, laser: true, boost: false, pause: false });
    r.down('stick', 3, { x: 100, y: 300 });
    expect(r.view.stick).toMatchObject({ active: true, anchorX: 100, anchorY: 300 });
    r.touch.releaseAll();
    expect(r.view.pressed).toMatchObject({ fire: false, laser: false });
    expect(r.view.stick?.active).toBe(false);
  });
});

describe('TouchControls: stick size', () => {
  it('follows the viewport from the start and when it changes, not only at the first touch', () => {
    const r = rig();
    expect(r.touch.model.stickRadius).toBe(59); // 15 % of 390
    r.host.innerWidth = 932;
    r.host.innerHeight = 430;
    r.host.dispatchEvent(new Event('resize'));
    expect(r.touch.model.stickRadius).toBe(65);
    expect(r.view.stick?.radius).toBe(65);
  });
});

describe('TouchControls: portrait', () => {
  it('shows the rotate prompt and hides the controls in portrait, and tells the game to pause', () => {
    const r = rig();
    r.touch.setLayer('play');
    r.down('fire', 1);
    let portraitEvents = 0;
    r.touch.onPortrait(() => portraitEvents++);
    r.turn(true);
    expect(r.view.portrait).toBe(true);
    expect(r.view.layer).toBe('off');
    expect(r.touch.command()).toEqual(NEUTRAL);
    expect(portraitEvents).toBe(1);
  });

  it('on turning back the controls return for the run still in progress, with nothing held and no fresh pause event', () => {
    const r = rig();
    r.touch.setLayer('play');
    let portraitEvents = 0;
    r.touch.onPortrait(() => portraitEvents++);
    r.turn(true);
    r.turn(false);
    expect(r.view.portrait).toBe(false);
    expect(r.view.layer).toBe('play');
    expect(r.touch.command()).toEqual(NEUTRAL);
    expect(portraitEvents).toBe(1);
  });

  it('a game that is paused (layer off) does not get its controls back by turning the phone', () => {
    const r = rig();
    r.touch.setLayer('play');
    r.turn(true);
    r.touch.setLayer('off'); // the scene paused in response
    r.turn(false);
    expect(r.view.layer).toBe('off');
  });

  it('does nothing in portrait when touch mode is off (a narrow desktop window)', () => {
    const r = rig(false);
    let portraitEvents = 0;
    r.touch.onPortrait(() => portraitEvents++);
    r.turn(true);
    expect(r.view.portrait).toBe(false);
    expect(portraitEvents).toBe(0);
  });

  it('shows the prompt when touch mode is switched on while the phone is already upright', () => {
    const r = rig(false);
    r.turn(true);
    r.touch.setActive(true);
    expect(r.view.portrait).toBe(true);
  });
});

describe('TouchControls: pause button and cleanup', () => {
  it('forwards a PAUSE tap to listeners (and stops after unsubscribing)', () => {
    const r = rig();
    r.touch.setLayer('play');
    let taps = 0;
    const stop = r.touch.onPauseTap(() => taps++);
    const at = centre(LAYOUT.pause);
    r.down('pause', 1);
    r.host.dispatchEvent(pointer('pointerup', 1, at.x, at.y));
    expect(taps).toBe(1);
    stop();
    r.down('pause', 2);
    r.host.dispatchEvent(pointer('pointerup', 2, at.x, at.y));
    expect(taps).toBe(1);
  });

  it('losing focus mid-hold leaves the next frame neutral', () => {
    const r = rig();
    r.touch.setLayer('play');
    r.down('fire', 1);
    r.host.dispatchEvent(new Event('blur'));
    expect(r.touch.command()).toEqual(NEUTRAL);
  });

  it('destroy removes every listener and destroys the view', () => {
    const r = rig();
    r.touch.onPauseTap(() => undefined);
    r.touch.destroy();
    expect(r.host.listenerTotal).toBe(0);
    expect(r.doc.listenerTotal).toBe(0);
    expect(r.touch.model.listenerCount).toBe(0);
    expect(r.touch.listenerCount).toBe(0);
    expect(r.view.destroyed).toBe(true);
  });

  it('passes ability labels through to the view', () => {
    const r = rig();
    r.touch.setAbilities({ laserCharges: 3, laserReady: true, boostText: 'READY', boostReady: true });
    expect(r.view.abilities).toEqual({ laserCharges: 3, laserReady: true, boostText: 'READY', boostReady: true });
  });
});

describe('abilityLabels (the LASER / BOOST button readouts)', () => {
  it('a fresh ship: full laser, boost ready', () => {
    expect(abilityLabels(createPlayer(0, 0))).toEqual({ laserCharges: LASER_BEAM_MAX_SHOTS, laserReady: true, boostText: 'READY', boostReady: true });
  });

  it('no charges, or cooling down, dims the laser; the count is still shown', () => {
    const p = createPlayer(0, 0);
    p.laser.shotsRemaining = 0;
    expect(abilityLabels(p)).toMatchObject({ laserCharges: 0, laserReady: false });
    p.laser.shotsRemaining = 4;
    p.laser.cooldown = 0.5;
    expect(abilityLabels(p)).toMatchObject({ laserCharges: 4, laserReady: false });
  });

  it("boost shows the seconds left, with the HUD text's rounding, while active and while cooling down", () => {
    const p = createPlayer(0, 0);
    p.boost.active = true;
    p.boost.timer = 2.4;
    expect(abilityLabels(p)).toMatchObject({ boostText: '3s', boostReady: false });
    p.boost.active = false;
    p.boost.cooldown = 7.9;
    expect(abilityLabels(p)).toMatchObject({ boostText: '8s', boostReady: false });
    p.boost.cooldown = 0;
    expect(abilityLabels(p)).toMatchObject({ boostText: 'READY', boostReady: true });
  });
});
