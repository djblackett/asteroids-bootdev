import type Phaser from 'phaser';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../core/constants';
import type { GamepadHub, PadStatus } from '../input/gamepadHub';
import { PAD_MAPPING_LINES, PAD_MENU_LINES } from '../input/gamepadMapping';
import { CachedText } from './hud';
import { addText, COLORS } from './text';

const LINE_X = 12;
/** Status lines are stacked upwards from here (bottom left, clear of the centred prompt and volume panel). */
const BOTTOM_Y = SCREEN_HEIGHT - 10;
const MAX_STATUS_LINES = 2;
const STATUS_SIZE = 16;
const HINT_SIZE = 14;
const DEPTH = 5;
const OVERLAY_DEPTH = 40;

const STATUS_COLOR: Record<PadStatus['kind'], (slot: PadStatus['slot']) => string> = {
  none: () => COLORS.dim,
  unassigned: () => COLORS.heading,
  assigned: (slot) => (slot === 1 ? COLORS.player2 : COLORS.player1),
  disconnected: () => '#ff6464',
};

/**
 * The title screen's small controller area: one line per controller (or "no controller detected"), a hint, and the
 * "controller layout" screen. It only shows what the `GamepadHub` reports, so a line says a controller is assigned only
 * while that controller is actually connected. Clicking a controller line cycles its player.
 */
export class ControllerPanel {
  private readonly lines: CachedText[];
  private readonly hint: CachedText;
  private readonly overlay: Phaser.GameObjects.Container;
  private statusLines: PadStatus[] = [];

  constructor(
    scene: Phaser.Scene,
    private readonly hub: GamepadHub,
    private readonly playerCount: () => 1 | 2,
    onCycle: (padKey: number) => void,
    onToggleLayout: () => void,
  ) {
    this.hint = new CachedText(
      addText(scene, LINE_X, BOTTOM_Y, 'C: controller layout   G: change player', { size: HINT_SIZE, color: COLORS.dim, originX: 0, originY: 1, bold: false }).setDepth(DEPTH),
      COLORS.dim,
      HINT_SIZE,
    );
    this.lines = Array.from({ length: MAX_STATUS_LINES }, (_, i) => {
      const text = addText(scene, LINE_X, BOTTOM_Y - 20 - (MAX_STATUS_LINES - 1 - i) * 20, '', { size: STATUS_SIZE, color: COLORS.dim, originX: 0, originY: 1 })
        .setDepth(DEPTH)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          const status = this.statusLines[i];
          if (status?.padKey != null) onCycle(status.padKey);
        });
      return new CachedText(text, COLORS.dim, STATUS_SIZE);
    });
    this.hint.text.setInteractive({ useHandCursor: true }).on('pointerdown', onToggleLayout);

    const dim = scene.add.rectangle(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2, SCREEN_WIDTH, SCREEN_HEIGHT, 0x000000, 0.96).setInteractive();
    dim.on('pointerdown', onToggleLayout);
    const title = addText(scene, SCREEN_WIDTH / 2, 130, 'CONTROLLER LAYOUT', { size: 40, color: COLORS.heading, originX: 0.5, originY: 0.5 });
    const body = [...PAD_MAPPING_LINES].map((line, i) =>
      addText(scene, SCREEN_WIDTH / 2, 215 + i * 34, line, { size: 22, color: COLORS.hint, originX: 0.5, originY: 0.5, bold: false }),
    );
    const menu = PAD_MENU_LINES.map((line, i) =>
      addText(scene, SCREEN_WIDTH / 2, 515 + i * 30, line, { size: 20, color: i === 0 ? COLORS.dim : COLORS.white, originX: 0.5, originY: 0.5, bold: false }),
    );
    const close = addText(scene, SCREEN_WIDTH / 2, 650, 'Press C, ESC, B or click to close', { size: 20, color: COLORS.dim, originX: 0.5, originY: 0.5 });
    this.overlay = scene.add.container(0, 0, [dim, title, ...body, ...menu, close]).setDepth(OVERLAY_DEPTH).setVisible(false);
  }

  get layoutVisible(): boolean {
    return this.overlay.visible;
  }

  setLayoutVisible(visible: boolean): void {
    this.overlay.setVisible(visible);
  }

  /** Refreshes the status lines from the hub (cheap: text is only touched when it changes). */
  update(): void {
    this.statusLines = this.hub.status(this.playerCount());
    this.lines.forEach((line, i) => {
      const status = this.statusLines[i];
      if (!status) {
        line.set('');
        return;
      }
      const hidden = i === MAX_STATUS_LINES - 1 && this.statusLines.length > MAX_STATUS_LINES ? ` (+${this.statusLines.length - MAX_STATUS_LINES} more)` : '';
      line.set(status.text + hidden, STATUS_COLOR[status.kind](status.slot));
    });
  }

  /** First connected controller's key, for the keyboard shortcut. */
  firstPadKey(): number | null {
    return this.hub.pads()[0]?.key ?? null;
  }
}
