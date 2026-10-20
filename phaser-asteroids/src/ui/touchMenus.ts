import type Phaser from 'phaser';
import { formatPercent, type VolumeChannel } from '../audio/audioSettings';
import type { AudioDirector } from '../audio/phaserAudio';
import type { SteeringController } from '../input/steeringMode';
import type { SteeringMode } from '../input/touchModel';
import { CachedText } from './hud';
import { addText, COLORS } from './text';

/**
 * Touch versions of the title, pause and game-over controls. The playfield is 1280x720 and on a phone is scaled to roughly half
 * that (about 0.5 CSS px per game px), so every tap target here is at least `MIN_TARGET` game px tall: 90 x 0.49 is still over the
 * 44 CSS px that thumbs need. Nothing here needs a keyboard.
 */
export const MIN_TARGET = 90;

export interface TouchButtonStyle {
  size?: number;
  fill?: number;
  stroke?: number;
  color?: string;
  depth?: number;
}

/** A big rectangular button. Fires on pointer down (like the existing RETRY button) and ignores taps while hidden or disabled. */
export class TouchButton {
  private readonly rect: Phaser.GameObjects.Rectangle;
  private readonly label: CachedText;
  private readonly fill: number;
  private readonly stroke: number;
  private readonly color: string;
  private caption = '';
  private selected = false;
  private visible = true;
  private enabled = true;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    private readonly onTap: () => void,
    { size = 30, fill = 0x3a3a4a, stroke = 0xffffff, color = COLORS.white, depth = 23 }: TouchButtonStyle = {},
  ) {
    this.fill = fill;
    this.stroke = stroke;
    this.color = color;
    this.rect = scene.add.rectangle(x, y, w, Math.max(h, MIN_TARGET), fill).setStrokeStyle(3, stroke).setDepth(depth);
    this.rect.setInteractive();
    this.rect.on('pointerdown', () => {
      if (this.visible && this.enabled) this.onTap();
    });
    this.label = new CachedText(addText(scene, x, y, text, { size, color, originX: 0.5, originY: 0.5 }).setAlign('center').setDepth(depth + 1), color, size);
    this.caption = text;
    this.label.set(text);
  }

  setText(text: string, color?: string): void {
    this.caption = text;
    this.label.set(text, color);
  }

  /** Marks this button as the chosen one of a group (green fill, gold outline and label). */
  setSelected(selected: boolean): void {
    if (selected === this.selected) return;
    this.selected = selected;
    this.rect.setFillStyle(selected ? 0x1d6b3a : this.fill).setStrokeStyle(selected ? 5 : 3, selected ? 0xffc800 : this.stroke);
    this.label.set(this.caption, selected ? COLORS.heading : this.color);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.rect.setVisible(visible);
    this.label.text.setVisible(visible);
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.rect.setFillStyle(enabled ? this.fill : 0x24242c).setStrokeStyle(3, enabled ? this.stroke : 0x646464);
    this.label.text.setAlpha(enabled ? 1 : 0.5);
  }

  get isVisible(): boolean {
    return this.visible;
  }
}

const ROW_STEP = 104;

/**
 * Music and SFX volume as `-  80%  +` rows, plus a Music on / off button: the touch version of `VolumePanel`. Rows are centred on
 * `x`; the first row is at `y`.
 */
export class TouchVolumeBlock {
  private readonly values: Array<readonly [VolumeChannel, CachedText]> = [];
  private readonly mute: TouchButton;
  private muteText = '';
  private readonly parts: TouchButton[] = [];
  private readonly labels: Phaser.GameObjects.Text[] = [];

  constructor(
    scene: Phaser.Scene,
    private readonly audio: AudioDirector,
    x: number,
    y: number,
    depth: number,
    rowStep: number = ROW_STEP,
  ) {
    const rows: ReadonlyArray<readonly [VolumeChannel, string]> = [
      ['music', 'MUSIC'],
      ['sfx', 'SFX'],
    ];
    rows.forEach(([channel, name], i) => {
      const rowY = y + i * rowStep;
      this.labels.push(addText(scene, x - 270, rowY, name, { size: 30, color: COLORS.hint, originY: 0.5 }).setDepth(depth + 1));
      this.parts.push(new TouchButton(scene, x + 30, rowY, 96, MIN_TARGET, '-', () => this.audio.adjustVolume(channel, -1), { size: 44, depth }));
      const value = new CachedText(addText(scene, x + 135, rowY, '', { size: 32, originX: 0.5, originY: 0.5 }).setDepth(depth + 1), COLORS.white, 32);
      this.values.push([channel, value]);
      this.parts.push(new TouchButton(scene, x + 240, rowY, 96, MIN_TARGET, '+', () => this.audio.adjustVolume(channel, 1), { size: 44, depth }));
    });
    // The mute button sits one 90 px button and an 8 px gap below the SFX row, however tight the rows are packed.
    this.mute = new TouchButton(scene, x, y + rowStep + MIN_TARGET + 8, 560, MIN_TARGET, '', () => this.audio.music.toggleMuted(), { size: 28, depth });
    this.parts.push(this.mute);
    this.update();
  }

  /** Cheap to call every frame: text is only touched when its content changes. */
  update(): void {
    for (const [channel, value] of this.values) {
      const muted = channel === 'music' && this.audio.music.isMuted;
      value.set(formatPercent(this.audio.volume(channel)), muted ? COLORS.dead : COLORS.white);
    }
    const text = this.audio.music.isMuted ? 'MUSIC: OFF  (tap to turn on)' : 'MUSIC: ON  (tap to mute)';
    if (text !== this.muteText) {
      this.muteText = text;
      this.mute.setText(text);
    }
  }

  setVisible(visible: boolean): void {
    for (const part of this.parts) part.setVisible(visible);
    for (const value of this.values) value[1].setVisible(visible);
    for (const label of this.labels) label.setVisible(visible);
  }
}

const SELECTOR_GAP = 8;

/**
 * STEERING: JOYSTICK | D-PAD as two side-by-side buttons with the chosen one lit, so both options are always visible and a switch is
 * one tap. It writes straight to the (persisted) steering controller and follows it, so the title and pause screens agree.
 * `width` is the whole control; the caption sits just above it.
 */
export class SteeringSelector {
  private readonly buttons: Record<SteeringMode, TouchButton>;
  private readonly caption: Phaser.GameObjects.Text;
  private readonly stop: () => void;

  constructor(scene: Phaser.Scene, private readonly steering: SteeringController, x: number, y: number, width: number, depth: number) {
    const half = (width - SELECTOR_GAP) / 2;
    this.caption = addText(scene, x, y - MIN_TARGET / 2 - 14, 'STEERING', { size: 22, color: COLORS.hint, originX: 0.5, originY: 0.5 }).setDepth(depth + 1);
    const make = (mode: SteeringMode, dx: number, text: string): TouchButton =>
      new TouchButton(scene, x + dx, y, half, MIN_TARGET, text, () => this.steering.set(mode), { size: 28, depth });
    this.buttons = {
      joystick: make('joystick', -(half + SELECTOR_GAP) / 2, 'JOYSTICK'),
      dpad: make('dpad', (half + SELECTOR_GAP) / 2, 'D-PAD'),
    };
    this.update(steering.mode);
    this.stop = steering.onChange((mode) => this.update(mode));
    scene.events.once('shutdown', this.stop);
  }

  private update(mode: SteeringMode): void {
    this.buttons.joystick.setSelected(mode === 'joystick');
    this.buttons.dpad.setSelected(mode === 'dpad');
  }

  setVisible(visible: boolean): void {
    this.caption.setVisible(visible);
    this.buttons.joystick.setVisible(visible);
    this.buttons.dpad.setVisible(visible);
  }
}

export interface TouchPauseCallbacks {
  resume: () => void;
  menu: () => void;
}

/** The pause screen's buttons: RESUME and MAIN MENU on the left, the volume block on the right. The dimmed backdrop and title are the shared `Overlay`. */
export class TouchPauseMenu {
  private readonly resume: TouchButton;
  private readonly menu: TouchButton;
  private readonly volume: TouchVolumeBlock;
  private readonly steering: SteeringSelector;

  constructor(scene: Phaser.Scene, audio: AudioDirector, steering: SteeringController, callbacks: TouchPauseCallbacks) {
    this.resume = new TouchButton(scene, 340, 300, 480, 130, 'RESUME', callbacks.resume, { size: 44, fill: 0x1d6b3a });
    this.menu = new TouchButton(scene, 340, 460, 480, 110, 'MAIN MENU', callbacks.menu, { size: 34 });
    this.volume = new TouchVolumeBlock(scene, audio, 940, 250, 23);
    this.steering = new SteeringSelector(scene, steering, 340, 610, 480, 23);
    this.setVisible(false);
  }

  setVisible(visible: boolean): void {
    this.resume.setVisible(visible);
    this.menu.setVisible(visible);
    this.volume.setVisible(visible);
    this.steering.setVisible(visible);
  }

  update(): void {
    this.volume.update();
  }
}

export interface TouchGameOverCallbacks {
  retry: () => void;
  menu: () => void;
}

/** RETRY (disabled during the short delay after the ship is lost, like the keyboard's R) and MAIN MENU. */
export class TouchGameOverButtons {
  private readonly retry: TouchButton;
  private readonly menu: TouchButton;

  constructor(scene: Phaser.Scene, callbacks: TouchGameOverCallbacks) {
    this.retry = new TouchButton(scene, 430, 470, 380, 120, 'RETRY', callbacks.retry, { size: 44, fill: 0x1d6b3a });
    this.menu = new TouchButton(scene, 850, 470, 380, 120, 'MAIN MENU', callbacks.menu, { size: 32 });
    this.setVisible(false);
  }

  setVisible(visible: boolean): void {
    this.retry.setVisible(visible);
    this.menu.setVisible(visible);
  }

  setRetryReady(ready: boolean): void {
    this.retry.setEnabled(ready);
  }
}
