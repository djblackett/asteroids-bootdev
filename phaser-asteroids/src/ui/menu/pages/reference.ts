import { COLORS } from '../../text';
import type { HelpRow, TouchHelpRow } from '../controlHelp';
import { PALETTE, type PageKit } from '../widgets';

/**
 * Drawing for the "how do I control my ship" reference: key caps and controller buttons for a keyboard or pad, and round icons in the
 * in-game colours for the touch controls. Everything is placed from the data in `controlHelp.ts`, so what is drawn is what works.
 */

const CAP_H = 44;
const CAP_GAP = 8;
const CHAR_W = 15; // a 24 px bold Courier glyph is 14.4 px wide

const capWidth = (label: string): number => Math.max(CAP_H + 8, label.length * CHAR_W + 26);

export interface ReferenceStyle {
  /** Row spacing in px. */
  step: number;
  /** Size of the action text. */
  size: number;
  /** Use `HelpRow.short` (the narrow two-player columns) instead of `long`. */
  compact: boolean;
}

/** One key cap (or controller button) centred vertically on `cy`, starting at `x`. Returns its width. */
function drawCap(kit: PageKit, g: ReturnType<PageKit['graphics']>, x: number, cy: number, label: string, tint: number = PALETTE.edge): number {
  const w = capWidth(label);
  g.fillStyle(PALETTE.fill, 1);
  g.fillRect(x, cy - CAP_H / 2, w, CAP_H);
  g.lineStyle(3, tint, 1);
  g.strokeRect(x + 1.5, cy - CAP_H / 2 + 1.5, w - 3, CAP_H - 3);
  kit.text(x + w / 2, cy, label, { size: 24, originX: 0.5, originY: 0.5 });
  return w;
}

/** A heading and the rows of a key / controller reference starting at (`x`, `y`). Returns the y just below the last row. */
export function drawHelpRows(
  kit: PageKit,
  g: ReturnType<PageKit['graphics']>,
  x: number,
  y: number,
  rows: readonly HelpRow[],
  style: ReferenceStyle,
  tint: number = PALETTE.edge,
): number {
  const capsColumn = Math.max(...rows.map((r) => r.caps.reduce((sum, c) => sum + capWidth(c), 0) + CAP_GAP * (r.caps.length - 1)));
  rows.forEach((row, i) => {
    const cy = y + i * style.step + style.step / 2;
    let cx = x;
    for (const cap of row.caps) cx += drawCap(kit, g, cx, cy, cap, tint) + CAP_GAP;
    kit.text(x + capsColumn + 22, cy, style.compact ? row.short : row.long, { size: style.size, originX: 0, originY: 0.5, color: COLORS.hint, bold: false });
  });
  return y + rows.length * style.step;
}

/** The icon for a touch control, centred on (`cx`, `cy`): a round button in the colour it has in the game, or the neutral D-pad / stick / pause. */
function drawTouchIcon(g: ReturnType<PageKit['graphics']>, row: TouchHelpRow, cx: number, cy: number): void {
  const r = 24;
  const color = row.color ? Number.parseInt(row.color.slice(1), 16) : 0xffffff;
  switch (row.kind) {
    case 'dpad': {
      g.lineStyle(3, 0xffffff, 0.8);
      g.strokeCircle(cx, cy, r);
      g.fillStyle(0xffffff, 0.85);
      g.fillRect(cx - 4, cy - r + 5, 8, 2 * r - 10); // the cross
      g.fillRect(cx - r + 5, cy - 4, 2 * r - 10, 8);
      break;
    }
    case 'stick': {
      g.lineStyle(3, 0xffffff, 0.8);
      g.strokeCircle(cx, cy, r);
      g.fillStyle(0xffffff, 0.85);
      g.fillCircle(cx, cy, 9);
      break;
    }
    case 'pause': {
      g.lineStyle(3, 0xffffff, 0.8);
      g.strokeRect(cx - r + 2, cy - r + 2, 2 * r - 4, 2 * r - 4);
      g.fillStyle(0xffffff, 0.9);
      g.fillRect(cx - 9, cy - 10, 6, 20);
      g.fillRect(cx + 3, cy - 10, 6, 20);
      break;
    }
    default: {
      g.fillStyle(color, 0.3);
      g.fillCircle(cx, cy, r);
      g.lineStyle(3, color, 1);
      g.strokeCircle(cx, cy, r);
    }
  }
}

/** The touch reference: one row per on-screen control, an icon in its in-game colour, its name, what it does. */
export function drawTouchRows(kit: PageKit, g: ReturnType<PageKit['graphics']>, x: number, y: number, rows: readonly TouchHelpRow[], step: number): number {
  rows.forEach((row, i) => {
    const cy = y + i * step + step / 2;
    drawTouchIcon(g, row, x + 30, cy);
    kit.text(x + 76, cy, row.label, { size: 28, originX: 0, originY: 0.5, color: row.color ?? COLORS.white });
    kit.text(x + 76 + 150, cy, row.text, { size: 26, originX: 0, originY: 0.5, color: COLORS.hint, bold: false });
  });
  return y + rows.length * step;
}
