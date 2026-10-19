import Phaser from 'phaser';
import { getAudio, type AudioDirector } from '../audio/phaserAudio';
import { POWERUP_RADIUS, SCREEN_HEIGHT, SCREEN_WIDTH } from '../core/constants';
import type { PowerUpType } from '../core/powerup';
import { defaultRng } from '../core/rng';
import { Starfield } from '../core/starfield';
import { toCss } from '../render/colors';
import { drawPowerUpIcon, POWERUP_COLOR } from '../render/powerupIcons';
import { createKeyPressDispatcher } from '../input/keyPress';
import { drawStarfield } from '../render/worldRenderer';
import { CachedText } from '../ui/hud';
import { addText, COLORS } from '../ui/text';
import { VolumePanel } from '../ui/volumePanel';
import { SCENE_GAME, SCENE_START } from './keys';

const CENTER_X = SCREEN_WIDTH / 2;

const CONTROLS = [
  'W / S  -  Move Forward / Backward',
  'A / D  -  Rotate Left / Right',
  'SPACE  -  Shoot',
  'E  -  Laser Beam',
  'SHIFT  -  Boost',
  'P  -  Pause',
];

const POWERUPS: ReadonlyArray<readonly [PowerUpType, string, string]> = [
  ['rapid_fire', 'Rapid Fire', 'Faster shooting'],
  ['multi_shot', 'Multi-Shot', 'Shoot 3 bullets'],
  ['shield', 'Shield', 'One-hit protection'],
  ['slow_motion', 'Slow Motion', 'Slows asteroids'],
  ['mega_power', 'MEGA POWER', 'ALL POWERS!'],
];
const POWERUP_ROW_Y = (i: number): number => 385 + i * 40;
const ICON_X = CENTER_X - 230;

/** Title / controls screen. Starting from a key press or click also satisfies the browser's audio-unlock gesture. */
export class StartScene extends Phaser.Scene {
  private iconGfx!: Phaser.GameObjects.Graphics;
  private musicHint!: CachedText;
  private audio!: AudioDirector;
  private volumePanel!: VolumePanel;
  private starting = false;

  constructor() {
    super(SCENE_START);
  }

  create(): void {
    this.starting = false;
    this.audio = getAudio(this);
    this.audio.startMusicWhenUnlocked();

    const stars = this.add.graphics().setDepth(0);
    drawStarfield(stars, new Starfield(defaultRng));
    this.iconGfx = this.add.graphics().setDepth(2);

    addText(this, CENTER_X, 50, 'ASTEROIDS', { size: 64, originX: 0.5, originY: 0.5 });
    addText(this, CENTER_X, 112, 'CONTROLS', { size: 30, color: COLORS.heading, originX: 0.5, originY: 0.5 });
    CONTROLS.forEach((line, i) => {
      addText(this, CENTER_X, 150 + i * 27, line, { size: 20, color: COLORS.hint, originX: 0.5, originY: 0.5, bold: false });
    });

    addText(this, CENTER_X, 345, 'POWER-UPS', { size: 30, color: COLORS.heading, originX: 0.5, originY: 0.5 });
    POWERUPS.forEach(([type, name, description], i) => {
      const y = POWERUP_ROW_Y(i);
      const color = type === 'mega_power' ? '#ff64ff' : toCss(POWERUP_COLOR[type]);
      addText(this, CENTER_X - 190, y, name, { size: 22, color, originY: 0.5 });
      addText(this, CENTER_X + 10, y, description, { size: 20, color: COLORS.hint, originY: 0.5, bold: false });
    });

    const prompt = addText(this, CENTER_X, 625, 'Press SPACE or click to start', { size: 32, originX: 0.5, originY: 0.5 });
    this.tweens.add({ targets: prompt, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });

    this.musicHint = new CachedText(
      addText(this, SCREEN_WIDTH - 12, SCREEN_HEIGHT - 10, '', { size: 18, color: COLORS.dim, originX: 1, originY: 1, bold: false }),
      COLORS.dim,
      18,
    );

    this.volumePanel = new VolumePanel(this, this.audio, CENTER_X, 664, 18, 22, 2);

    const keyboard = this.input.keyboard;
    if (keyboard) {
      keyboard.addCapture('SPACE,UP,DOWN,LEFT,RIGHT');
      const panelKey = (code: string) => (): void => void this.volumePanel.handleKey(code);
      keyboard.on(
        Phaser.Input.Keyboard.Events.ANY_KEY_DOWN,
        createKeyPressDispatcher({
          Space: () => this.start(),
          KeyM: () => this.audio.music.toggleMuted(),
          ArrowUp: panelKey('ArrowUp'),
          ArrowDown: panelKey('ArrowDown'),
          ArrowLeft: panelKey('ArrowLeft'),
          ArrowRight: panelKey('ArrowRight'),
        }),
      );
    }
    this.input.once('pointerdown', () => this.start());
  }

  override update(time: number): void {
    this.iconGfx.clear();
    POWERUPS.forEach(([type], i) => drawPowerUpIcon(this.iconGfx, type, ICON_X, POWERUP_ROW_Y(i), POWERUP_RADIUS, time));
    this.musicHint.set(`M: music ${this.audio.music.isMuted ? 'off' : 'on'}`);
    this.volumePanel.update();
  }

  private start(): void {
    if (this.starting) return;
    this.starting = true;
    this.scene.start(SCENE_GAME);
  }
}
