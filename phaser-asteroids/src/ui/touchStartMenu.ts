import type Phaser from 'phaser';
import type { AudioDirector } from '../audio/phaserAudio';
import { POWERUP_RADIUS } from '../core/constants';
import type { PowerUpType } from '../core/powerup';
import type { InputModeController } from '../input/inputMode';
import type { SteeringController } from '../input/steeringMode';
import type { SteeringMode } from '../input/touchModel';
import { toCss } from '../render/colors';
import { drawPowerUpIcon, POWERUP_COLOR } from '../render/powerupIcons';
import { ConfirmTap } from './confirmTap';
import { CachedText } from './hud';
import { addText, COLORS } from './text';
import { MIN_TARGET, SteeringSelector, TouchButton, TouchVolumeBlock } from './touchMenus';

const LEFT_X = 40;
const RIGHT_X = 940;

/** The five power-ups a one-player game has, as the keyboard title screen lists them (touch play is one player, so no Revive). */
const POWERUPS: ReadonlyArray<readonly [PowerUpType, string, string]> = [
  ['rapid_fire', 'Rapid Fire', 'Faster shooting'],
  ['multi_shot', 'Multi-Shot', 'Shoot 3 bullets'],
  ['shield', 'Shield', 'One-hit protection'],
  ['slow_motion', 'Slow Motion', 'Slows asteroids'],
  ['mega_power', 'MEGA POWER', 'ALL POWERS!'],
];
const ICON_POS = (i: number): { x: number; y: number } => ({ x: LEFT_X + 24 + (i % 2) * 300, y: 462 + Math.floor(i / 2) * 66 });

/** The first two lines depend on the steering control; they are rewritten when it changes. */
const STEERING_HELP: Record<SteeringMode, readonly [string, string]> = {
  joystick: ['LEFT SIDE: drag to steer and fly', '  (left / right turns, up = forward)'],
  dpad: ['D-PAD: UP = forward, DOWN = back', '  LEFT / RIGHT turn; corners do both'],
};
const HOW_TO_PLAY = ['', '', 'FIRE: hold it down to shoot', 'LASER and BOOST: tap', 'PAUSE: top right corner'];

export interface TouchStartCallbacks {
  start: () => void;
  /** The CONTROLS button was tapped: the scene rebuilds itself for the new mode. */
  switchMode: () => void;
}

/**
 * The title screen for touch mode (one player only): a short how-to, the power-up legend, one big PLAY button, the volume controls
 * and the CONTROLS toggle. Deliberately no "tap anywhere to start": a stray touch (or the first tap after turning the phone) must not begin a run.
 */
export class TouchStartMenu {
  private readonly icons: Phaser.GameObjects.Graphics;
  private readonly volume: TouchVolumeBlock;
  private readonly help: [CachedText, CachedText];
  private helpMode: SteeringMode | null = null;
  private readonly keyboardButton: TouchButton;
  private readonly keyboardLabel: string;
  private readonly confirmKeyboard = new ConfirmTap();
  private keyboardArmed = false;

  constructor(
    scene: Phaser.Scene,
    audio: AudioDirector,
    mode: InputModeController,
    private readonly steering: SteeringController,
    callbacks: TouchStartCallbacks,
  ) {
    this.icons = scene.add.graphics().setDepth(2);

    addText(scene, LEFT_X + 280, 128, 'HOW TO PLAY', { size: 30, color: COLORS.heading, originX: 0.5, originY: 0.5 });
    const lines = HOW_TO_PLAY.map((line, i) =>
      addText(scene, LEFT_X, 172 + i * 40, line, { size: 25, color: i === 1 ? COLORS.dim : COLORS.hint, originY: 0.5, bold: i !== 1 }),
    );
    this.help = [new CachedText(lines[0] as Phaser.GameObjects.Text, COLORS.hint, 25), new CachedText(lines[1] as Phaser.GameObjects.Text, COLORS.dim, 25)];

    addText(scene, LEFT_X + 280, 402, 'POWER-UPS', { size: 28, color: COLORS.heading, originX: 0.5, originY: 0.5 });
    POWERUPS.forEach(([type, name, description], i) => {
      const { x, y } = ICON_POS(i);
      const color = type === 'mega_power' ? '#ff64ff' : toCss(POWERUP_COLOR[type]);
      addText(scene, x + 34, y - 11, name, { size: 21, color, originY: 0.5 });
      addText(scene, x + 34, y + 13, description, { size: 17, color: COLORS.hint, originY: 0.5, bold: false });
    });

    // The right column is packed tight (every target is still a full MIN_TARGET tall): PLAY, volume, steering, then the keyboard switch.
    // PLAY starts at y 105 and stops short of the right edge so the DOM Fullscreen pill (top right, 44 CSS px tall) never covers it.
    new TouchButton(scene, RIGHT_X, 155, 480, 100, 'TAP TO PLAY', callbacks.start, { size: 48, fill: 0x1d6b3a, depth: 5 });
    this.volume = new TouchVolumeBlock(scene, audio, RIGHT_X, 258, 5, 96);
    new SteeringSelector(scene, steering, RIGHT_X, 568, 560, 5);
    // Switching to the keyboard screen hides every touch control, so it takes two taps: the first one only asks "tap again".
    // (Nobody can then land on a screen with no way to play by one stray thumb, which happened on a real phone.)
    this.keyboardLabel = mode.isTouch ? 'CONTROLS: TOUCH  (tap for keyboard)' : 'CONTROLS: KEYBOARD  (tap for touch)';
    this.keyboardButton = new TouchButton(
      scene,
      RIGHT_X,
      664,
      560,
      MIN_TARGET,
      '',
      () => {
        if (this.confirmKeyboard.tap(scene.time.now)) callbacks.switchMode();
        else this.showKeyboardPrompt(scene.time.now);
      },
      { size: 24, depth: 5 },
    );
    this.keyboardButton.setText(this.keyboardLabel);
  }

  /** Shows (or, once the window has lapsed, clears) the "tap again" question on the keyboard-switch button. */
  private showKeyboardPrompt(now: number): void {
    const armed = this.confirmKeyboard.isArmed(now);
    if (armed === this.keyboardArmed) return;
    this.keyboardArmed = armed;
    if (armed) this.keyboardButton.setText('TAP AGAIN TO SWITCH\nTO KEYBOARD CONTROLS', COLORS.heading);
    else this.keyboardButton.setText(this.keyboardLabel, COLORS.white);
  }

  update(time: number): void {
    if (this.keyboardArmed) this.showKeyboardPrompt(time);
    if (this.helpMode !== this.steering.mode) {
      this.helpMode = this.steering.mode;
      const [first, second] = STEERING_HELP[this.helpMode];
      this.help[0].set(first);
      this.help[1].set(second);
    }
    this.icons.clear();
    POWERUPS.forEach(([type], i) => {
      const { x, y } = ICON_POS(i);
      drawPowerUpIcon(this.icons, type, x, y, POWERUP_RADIUS, time);
    });
    this.volume.update();
  }
}
