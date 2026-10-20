import type Phaser from 'phaser';

export const FONT_FAMILY = '"Courier New", Courier, monospace';

export const COLORS = {
  white: '#ffffff',
  player1: '#64c8ff',
  player2: '#ffc864',
  dim: '#b4b4b4',
  hint: '#c8c8c8',
  heading: '#ffc800',
  dead: '#646464',
} as const;

export type TextOptions = {
  size: number;
  color?: string;
  /** Anchor point: 0 = left/top, 0.5 = centre, 1 = right/bottom. */
  originX?: number;
  originY?: number;
  bold?: boolean;
};

/** Creates a crisp, consistently styled Text object. */
export function addText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  content: string,
  { size, color = COLORS.white, originX = 0, originY = 0, bold = true }: TextOptions,
): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, content, {
      fontFamily: FONT_FAMILY,
      fontSize: `${size}px`,
      fontStyle: bold ? 'bold' : 'normal',
      color,
      // Render at 2x so text stays sharp when the canvas is CSS-scaled up to a large window.
      resolution: 2,
    })
    .setOrigin(originX, originY);
}

export function formatClock(seconds: number): string {
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
