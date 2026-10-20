import type { ControlElement } from '../input/touchBinding';
import type { AbilityLabels, TouchLayer, TouchView } from '../input/touchControls';
import type { DpadView, SteeringMode, StickView, TouchControl } from '../input/touchModel';
import type { SystemOverlay } from './systemOverlay';
import './touch.css';

/**
 * The on-screen controls as plain DOM above the canvas. DOM rather than Phaser game objects because the browser then does what
 * a game's own canvas cannot: real multi-touch through Pointer Events with pointer capture, layout in CSS pixels (so a button
 * is the same physical size whatever the 1280x720 canvas is scaled to), `env(safe-area-inset-*)` for notches, and
 * `touch-action` handled by the engine. Nothing here runs per frame: the model tells the view when something changed, and the
 * view only writes to the DOM when the value it would write is different from the last one.
 */

type Part = HTMLElement;

function make(doc: Document, parent: Node, className: string, text?: string): Part {
  const element = doc.createElement('div');
  element.className = className;
  if (text !== undefined) element.textContent = text;
  parent.appendChild(element);
  return element;
}

export class TouchOverlay implements TouchView {
  readonly elements: Readonly<Record<TouchControl, ControlElement>>;
  private readonly root: Part;
  private readonly rotate: Part;
  private readonly base: Part;
  private readonly knob: Part;
  private readonly hint: Part;
  private readonly buttons: Readonly<Record<Exclude<TouchControl, 'stick' | 'dpad'>, Part>>;
  private readonly lobes: Readonly<Record<'up' | 'down' | 'left' | 'right', Part>>;
  private readonly laserCount: Part;
  private readonly boostState: Part;

  // Last written values: a write is skipped when nothing changed.
  private active = false;
  private layer: TouchLayer = 'off';
  private portrait = false;
  private stickKey = '';
  private radius = 0;
  private pressed: Record<string, boolean> = {};
  private steering: SteeringMode | null = null;
  private dpadKey = '';
  private abilityKey = '';

  /** `system` (the Fullscreen button and its tip) is shown with the 'menu' layer and removed with the overlay. */
  constructor(
    private readonly doc: Document = document,
    private readonly system: Pick<SystemOverlay, 'setShown' | 'destroy'> | null = null,
  ) {
    const body = doc.body;

    this.root = make(doc, body, 'tc-root');
    this.root.setAttribute('aria-hidden', 'true');

    const zone = make(doc, this.root, 'tc-zone');
    this.hint = make(doc, this.root, 'tc-hint');
    make(doc, this.hint, 'tc-hint-ring');
    make(doc, this.hint, 'tc-hint-text', 'STEER');
    this.base = make(doc, this.root, 'tc-base');
    this.knob = make(doc, this.base, 'tc-knob');

    // The D-pad: a round touch target (the whole disc is one control, so a thumb between two arms is a diagonal) with four arms
    // that light up. The arms and hub are for the eye only; the direction is worked out from where the thumb is, see touchModel.ts.
    const dpad = make(doc, this.root, 'tc-dpad');
    this.lobes = {
      up: make(doc, dpad, 'tc-lobe tc-lobe-up'),
      down: make(doc, dpad, 'tc-lobe tc-lobe-down'),
      left: make(doc, dpad, 'tc-lobe tc-lobe-left'),
      right: make(doc, dpad, 'tc-lobe tc-lobe-right'),
    };
    make(doc, dpad, 'tc-hub');

    const fire = make(doc, this.root, 'tc-btn tc-fire');
    make(doc, fire, 'tc-label', 'FIRE');
    const laser = make(doc, this.root, 'tc-btn tc-laser');
    make(doc, laser, 'tc-label', 'LASER');
    this.laserCount = make(doc, laser, 'tc-sub', '');
    const boost = make(doc, this.root, 'tc-btn tc-boost');
    make(doc, boost, 'tc-label', 'BOOST');
    this.boostState = make(doc, boost, 'tc-sub', '');
    const pause = make(doc, this.root, 'tc-btn tc-pause');
    pause.setAttribute('aria-label', 'Pause');
    make(doc, pause, 'tc-bar');
    make(doc, pause, 'tc-bar');

    this.buttons = { fire, laser, boost, pause };
    this.elements = { stick: zone, dpad, fire, laser, boost, pause };

    // Phaser also listens for touches on the window and processes every one whose target is not the canvas, unless the event is
    // already default-prevented. `preventDefault()` on a pointer event does not do that to the touch event, so without this a
    // finger on a control (or on the rotate prompt) would also be a tap on whatever Phaser button sits under it: a tap on the
    // prompt would start the game. Cancelling the touch events here keeps the overlay's touches to the overlay.
    this.swallowTouches(this.root);

    // The rotate prompt is a sibling of the controls, not a child: it must stay visible when the controls are hidden.
    this.rotate = make(doc, body, 'tc-rotate');
    this.rotate.setAttribute('role', 'alert');
    const phone = make(doc, this.rotate, 'tc-phone');
    make(doc, phone, 'tc-phone-screen');
    make(doc, this.rotate, 'tc-rotate-text', 'Rotate your phone to play.');
    make(doc, this.rotate, 'tc-rotate-sub', 'Asteroids plays in landscape.');
    this.swallowTouches(this.rotate);
  }

  private swallowTouches(element: Part): void {
    const cancel = (event: Event): void => {
      if (event.cancelable) event.preventDefault();
    };
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) element.addEventListener(type, cancel, { passive: false });
  }

  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.doc.body.classList.toggle('tc-active', active);
  }

  setLayer(layer: TouchLayer): void {
    if (layer === this.layer) return;
    this.layer = layer;
    this.root.classList.toggle('tc-play', layer === 'play');
    this.system?.setShown(layer === 'menu');
  }

  setSteering(mode: SteeringMode): void {
    if (mode === this.steering) return;
    this.steering = mode;
    this.root.classList.toggle('tc-steer-dpad', mode === 'dpad');
    this.root.classList.toggle('tc-steer-joystick', mode === 'joystick');
  }

  renderDpad(dpad: DpadView): void {
    const key = `${dpad.up ? 'u' : ''}${dpad.down ? 'd' : ''}${dpad.left ? 'l' : ''}${dpad.right ? 'r' : ''}`;
    if (key === this.dpadKey) return;
    this.dpadKey = key;
    for (const side of ['up', 'down', 'left', 'right'] as const) this.lobes[side].classList.toggle('tc-on', dpad[side]);
  }

  setPortrait(portrait: boolean): void {
    if (portrait === this.portrait) return;
    this.portrait = portrait;
    this.doc.body.classList.toggle('tc-portrait', portrait);
  }

  renderStick(stick: StickView): void {
    if (stick.radius !== this.radius) {
      this.radius = stick.radius;
      this.root.style.setProperty('--tc-r', `${stick.radius}px`);
    }
    const key = stick.active ? `${stick.anchorX}|${stick.anchorY}|${Math.round(stick.knobX)}|${Math.round(stick.knobY)}` : 'idle';
    if (key === this.stickKey) return;
    this.stickKey = key;
    this.hint.classList.toggle('tc-hidden', stick.active);
    this.base.classList.toggle('tc-on', stick.active);
    if (!stick.active) return;
    this.base.style.transform = `translate3d(${stick.anchorX - stick.radius}px, ${stick.anchorY - stick.radius}px, 0)`;
    this.knob.style.transform = `translate3d(${Math.round(stick.knobX)}px, ${Math.round(stick.knobY)}px, 0)`;
  }

  setPressed(control: TouchControl, pressed: boolean): void {
    if (control === 'stick' || control === 'dpad' || this.pressed[control] === pressed) return;
    this.pressed[control] = pressed;
    this.buttons[control].classList.toggle('tc-down', pressed);
  }

  setAbilities(labels: AbilityLabels): void {
    const key = `${labels.laserCharges}|${labels.laserReady}|${labels.boostText}|${labels.boostReady}`;
    if (key === this.abilityKey) return;
    this.abilityKey = key;
    this.laserCount.textContent = String(labels.laserCharges);
    this.boostState.textContent = labels.boostText;
    this.buttons.laser.classList.toggle('tc-dim', !labels.laserReady);
    this.buttons.boost.classList.toggle('tc-dim', !labels.boostReady);
  }

  destroy(): void {
    this.root.remove();
    this.rotate.remove();
    this.system?.destroy();
    this.doc.body.classList.remove('tc-active', 'tc-portrait');
  }
}
