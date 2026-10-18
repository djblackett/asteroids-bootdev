import Phaser from 'phaser';
import { defaultRng } from '../core/rng';
import { SCREEN_WIDTH } from '../core/constants';
import { Starfield } from '../core/starfield';
import { drawStarfield } from '../render/worldRenderer';
import { addText, COLORS } from '../ui/text';
import { SCENE_GAME, SCENE_START } from './keys';

/** Title / controls screen. Starting from a key press or click also satisfies the browser's audio-unlock gesture. */
export class StartScene extends Phaser.Scene {
  constructor() {
    super(SCENE_START);
  }

  create(): void {
    const stars = this.add.graphics().setDepth(0);
    drawStarfield(stars, new Starfield(defaultRng));

    addText(this, SCREEN_WIDTH / 2, 70, 'ASTEROIDS', { size: 72, originX: 0.5, originY: 0.5 });
    addText(this, SCREEN_WIDTH / 2, 170, 'CONTROLS', { size: 34, color: COLORS.heading, originX: 0.5, originY: 0.5 });

    const controls = ['W / S  -  Move Forward / Backward', 'A / D  -  Rotate Left / Right', 'SPACE  -  Shoot', 'P  -  Pause'];
    controls.forEach((line, i) => {
      addText(this, SCREEN_WIDTH / 2, 225 + i * 32, line, { size: 22, color: COLORS.hint, originX: 0.5, originY: 0.5, bold: false });
    });

    const prompt = addText(this, SCREEN_WIDTH / 2, 470, 'Press SPACE or click to start', {
      size: 34,
      originX: 0.5,
      originY: 0.5,
    });
    this.tweens.add({ targets: prompt, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });

    const keyboard = this.input.keyboard;
    if (keyboard) {
      keyboard.addCapture('SPACE');
      keyboard.once('keydown-SPACE', this.start, this);
    }
    this.input.once('pointerdown', this.start, this);
  }

  private start(): void {
    this.scene.start(SCENE_GAME);
  }
}
