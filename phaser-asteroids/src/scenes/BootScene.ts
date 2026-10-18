import Phaser from 'phaser';
import { SFX_ASSETS } from '../audio/sfx';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../core/constants';
import { addText, COLORS } from '../ui/text';
import { SCENE_BOOT, SCENE_START } from './keys';

/** Loads audio, then hands over to the start screen. A failed asset never blocks the game. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENE_BOOT);
  }

  preload(): void {
    const label = addText(this, SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2, 'LOADING 0%', {
      size: 28,
      color: COLORS.hint,
      originX: 0.5,
      originY: 0.5,
    });
    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
      label.setText(`LOADING ${Math.round(value * 100)}%`);
    });
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.warn(`[asteroids] failed to load ${file.key}; continuing without it`);
    });
    for (const [key, file] of SFX_ASSETS) this.load.audio(key, file);
  }

  create(): void {
    this.scene.start(SCENE_START);
  }
}
