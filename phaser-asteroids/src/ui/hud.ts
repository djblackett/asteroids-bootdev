import type Phaser from 'phaser';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../core/constants';
import type { GameSim } from '../core/game';
import { addText, COLORS, formatClock } from './text';

/**
 * Changing a Text object's string, colour or size re-rasterises it, so everything here only
 * touches a Text when its value actually changes.
 */
class CachedText {
  private content = '';
  private color: string;
  private size: number;

  constructor(readonly text: Phaser.GameObjects.Text, color: string, size: number) {
    this.color = color;
    this.size = size;
  }

  set(content: string, color: string = this.color, size: number = this.size): void {
    if (content !== this.content) {
      this.content = content;
      this.text.setText(content);
    }
    if (color !== this.color) {
      this.color = color;
      this.text.setColor(color);
    }
    if (size !== this.size) {
      this.size = size;
      this.text.setFontSize(size);
    }
  }
}

/** Score / lives / clock. */
export class Hud {
  private readonly score: CachedText;
  private readonly lives: CachedText;
  private readonly clock: CachedText;

  constructor(scene: Phaser.Scene) {
    const make = (x: number, y: number, size: number, color: string, originX = 0): CachedText =>
      new CachedText(addText(scene, x, y, '', { size, color, originX }).setDepth(10), color, size);
    this.score = make(10, 10, 20, COLORS.player1);
    this.lives = make(10, 45, 20, COLORS.player1);
    this.clock = make(SCREEN_WIDTH / 2, 10, 34, COLORS.white, 0.5);
  }

  update(sim: GameSim): void {
    const color = sim.player.lives > 0 ? COLORS.player1 : COLORS.dead;
    this.score.set(`P1: ${sim.player.score}`, color);
    this.lives.set(`Lives: ${Math.max(sim.player.lives, 0)}`, color);
    this.clock.set(formatClock(sim.time));
  }
}

/** Dimmed full-screen panel with a big title and a few lines of text; used for pause and game over. */
export class Overlay {
  private readonly container: Phaser.GameObjects.Container;
  private readonly title: CachedText;
  private readonly lines: CachedText[];

  constructor(scene: Phaser.Scene, dimAlpha: number, titleSize: number, titleY: number, lineCount: number) {
    const dim = scene.add.rectangle(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2, SCREEN_WIDTH, SCREEN_HEIGHT, 0x000000, dimAlpha);
    const titleText = addText(scene, SCREEN_WIDTH / 2, titleY, '', { size: titleSize, originX: 0.5, originY: 0.5 });
    const lineTexts = Array.from({ length: lineCount }, () =>
      addText(scene, SCREEN_WIDTH / 2, 0, '', { size: 22, originX: 0.5, originY: 0.5 }),
    );
    this.title = new CachedText(titleText, COLORS.white, titleSize);
    this.lines = lineTexts.map((t) => new CachedText(t, COLORS.white, 22));
    this.container = scene.add.container(0, 0, [dim, titleText, ...lineTexts]).setDepth(20).setVisible(false);
  }

  setVisible(visible: boolean): void {
    this.container.setVisible(visible);
  }

  setTitle(text: string): void {
    this.title.set(text);
  }

  setLine(index: number, text: string, y: number, color: string = COLORS.hint, size = 22): void {
    const line = this.lines[index];
    if (!line) return;
    line.set(text, color, size);
    if (line.text.y !== y) line.text.setY(y);
  }
}
