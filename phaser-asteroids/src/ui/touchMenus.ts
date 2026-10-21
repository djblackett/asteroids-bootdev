import type Phaser from 'phaser';
import { CachedText } from './hud';
import { addText, COLORS } from './text';

/**
 * The game-over screen's touch buttons (RETRY and MAIN MENU). The title and pause screens are built from the shared menu (`ui/menu/`).
 * The playfield is 1280x720 and on a phone is scaled to roughly half that (about 0.5 CSS px per game px), so every tap target here is at
 * least `MIN_TARGET` game px tall: 90 x 0.49 is still over the 44 CSS px that thumbs need. Nothing here needs a keyboard.
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
    this.rect = scene.add.rectangle(x, y, w, Math.max(h, MIN_TARGET), fill).setStrokeStyle(3, stroke).setDepth(depth);
    this.rect.setInteractive();
    this.rect.on('pointerdown', () => {
      if (this.visible && this.enabled) this.onTap();
    });
    this.label = new CachedText(addText(scene, x, y, text, { size, color, originX: 0.5, originY: 0.5 }).setAlign('center').setDepth(depth + 1), color, size);
    this.label.set(text);
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
