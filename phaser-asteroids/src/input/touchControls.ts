import type { PlayerInput } from '../core/player';
import {
  bindTouchControls,
  type BindingDocument,
  type BindingHost,
  type ControlElement,
  type TouchBinding,
  type ViewportChange,
} from './touchBinding';
import type { MovementMode } from './movementMode';
import { stickRadiusFor, TouchModel, type DpadView, type SteeringMode, type StickStyle, type StickView, type TouchControl } from './touchModel';

/** Which on-screen control and which reading of the thumb each movement mode uses. Both stick modes share the one joystick. */
export const MOVEMENT_CONTROLS: Readonly<Record<MovementMode, { steering: SteeringMode; style: StickStyle }>> = {
  classic: { steering: 'dpad', style: 'relative' },
  pointToFly: { steering: 'joystick', style: 'point' },
  assisted: { steering: 'joystick', style: 'assist' },
};

/** What the buttons show about the ship's abilities (the HUD text at the top left says the same; a thumb should not have to look there). */
export interface AbilityLabels {
  laserCharges: number;
  laserReady: boolean;
  /** `READY`, `3s` (active) or `5s` (cooling down). */
  boostText: string;
  boostReady: boolean;
}

/**
 * `play`: the game controls are on screen and take touches. `menu`: only the small system controls (Fullscreen) are on screen, over
 * the title and pause screens. `off`: nothing is drawn and the canvas gets every touch (game over, between scenes).
 */
export type TouchLayer = 'off' | 'play' | 'menu';

/** The drawing side. The DOM implementation is `ui/touchOverlay.ts`; tests pass a recording fake. Implementations only touch the DOM when a value changed. */
export interface TouchView {
  readonly elements: Readonly<Record<TouchControl, ControlElement>>;
  /** Whether touch controls exist at all (touch mode), as a body class for the page-level touch rules. */
  setActive(active: boolean): void;
  setLayer(layer: TouchLayer): void;
  setPortrait(portrait: boolean): void;
  /** Which steering control is on screen: the joystick's zone or the D-pad; the other is removed. */
  setSteering(mode: SteeringMode): void;
  renderStick(stick: StickView): void;
  renderDpad(dpad: DpadView): void;
  setPressed(control: TouchControl, pressed: boolean): void;
  setAbilities(labels: AbilityLabels): void;
  destroy(): void;
}

const PRESSABLE: readonly TouchControl[] = ['fire', 'laser', 'boost', 'pause'];

/**
 * The game-wide touch input: one per Phaser game (created in BootScene like the held keys and the gamepad hub, found again through
 * the registry). It owns the `TouchModel` and its DOM listeners, and everything a scene needs is on it:
 *
 *   command()          this frame's `PlayerInput` from the fingers (neutral when touch mode is off or nothing is touched)
 *   setLayer()         'play' while a run is being played, 'menu' on the title and pause screens, 'off' otherwise
 *   setMovement()      Classic D-Pad, Point-to-Fly or Assisted Flight: picks the control and how it reads a thumb, lets go of everything held
 *   setSteering()      the lower-level switch under it (joystick or D-pad), kept for the legacy relative stick
 *   releaseAll()       every finger forgotten at once
 *   onPauseTap()       the PAUSE button was tapped
 *   onPortrait()       the phone was turned upright
 */
export class TouchControls {
  readonly model = new TouchModel();
  private binding: TouchBinding | null = null;
  private active = false;
  private layer: TouchLayer = 'off';
  private portrait = false;
  private readonly pauseListeners = new Set<() => void>();
  private readonly portraitListeners = new Set<() => void>();
  private readonly stopModelEvents: () => void;

  constructor(
    private readonly view: TouchView,
    host: BindingHost,
    doc: BindingDocument,
  ) {
    this.binding = bindTouchControls({
      elements: view.elements,
      model: this.model,
      host,
      doc,
      onPauseTap: () => this.emit(this.pauseListeners),
      onViewport: (change) => this.viewportChanged(change),
    });
    this.portrait = this.binding.isPortrait();
    // The stick's size follows the viewport (also drawn as the idle STEER ring), not just the first touch.
    this.model.setStickRadius(stickRadiusFor(host.innerWidth, host.innerHeight));
    this.stopModelEvents = this.model.onChange(() => this.render());
    this.model.setEnabled(false);
    this.view.setPortrait(false);
    this.view.setSteering(this.model.steeringMode);
    this.render();
  }

  /** Touch mode on / off. Off = invisible, inert, and every held control let go. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.model.setEnabled(active);
    this.view.setActive(active);
    this.view.setPortrait(active && this.portrait);
    this.applyLayer();
  }

  get isActive(): boolean {
    return this.active;
  }

  get isPortrait(): boolean {
    return this.portrait;
  }

  get currentLayer(): TouchLayer {
    return this.layer;
  }

  setLayer(layer: TouchLayer): void {
    if (layer === this.layer) return;
    this.layer = layer;
    this.applyLayer();
  }

  /** The steering control in use. Switching lets go of every finger, so nothing from the old control can stay held. */
  setSteering(mode: SteeringMode): void {
    this.model.setSteering(mode);
    this.view.setSteering(mode);
  }

  /**
   * The movement mode in use. Fingers are let go once, so no turn, thrust or direction from the old mode survives the switch (the
   * simulation sees a neutral command next frame and forgets any assisted travel direction), and FIRE / LASER / BOOST are released too.
   */
  setMovement(mode: MovementMode): void {
    const { steering, style } = MOVEMENT_CONTROLS[mode];
    this.model.releaseAll();
    this.model.setStickStyle(style);
    this.setSteering(steering);
  }

  get steering(): SteeringMode {
    return this.model.steeringMode;
  }

  /** The layer is only shown in touch mode, and never while the rotate prompt covers the screen. Leaving 'play' lets every finger go. */
  private applyLayer(): void {
    const shown: TouchLayer = this.active && !this.portrait ? this.layer : 'off';
    this.view.setLayer(shown);
    if (shown !== 'play') this.model.releaseAll();
  }

  /** This frame's command. A neutral command when touch mode is off, so it can always be merged in. */
  command(): PlayerInput {
    return this.model.command();
  }

  releaseAll(): void {
    this.model.releaseAll();
  }

  setAbilities(labels: AbilityLabels): void {
    this.view.setAbilities(labels);
  }

  onPauseTap(listener: () => void): () => void {
    this.pauseListeners.add(listener);
    return () => this.pauseListeners.delete(listener);
  }

  /** Called when the phone turns from landscape to portrait while touch mode is on. */
  onPortrait(listener: () => void): () => void {
    this.portraitListeners.add(listener);
    return () => this.portraitListeners.delete(listener);
  }

  get listenerCount(): number {
    return this.pauseListeners.size + this.portraitListeners.size;
  }

  private viewportChanged(change: ViewportChange): void {
    this.portrait = change.portrait;
    this.model.setStickRadius(stickRadiusFor(change.width, change.height));
    this.view.setPortrait(this.active && change.portrait);
    // Entering portrait covers the controls (and lets go of every finger); leaving it brings them back if a run is on.
    this.applyLayer();
    if (this.active && change.orientationChanged && change.portrait) this.emit(this.portraitListeners);
  }

  private emit(listeners: Set<() => void>): void {
    for (const listener of [...listeners]) listener();
  }

  private render(): void {
    this.view.renderStick(this.model.stickView());
    this.view.renderDpad(this.model.dpadView());
    for (const control of PRESSABLE) this.view.setPressed(control, this.model.holds(control));
  }

  destroy(): void {
    this.binding?.destroy();
    this.binding = null;
    this.stopModelEvents();
    this.pauseListeners.clear();
    this.portraitListeners.clear();
    this.view.destroy();
  }
}
