import type Phaser from 'phaser';
import { formatPercent, type VolumeChannel } from '../audio/audioSettings';
import type { AudioDirector } from '../audio/phaserAudio';
import { CachedText } from './hud';
import { addText, COLORS } from './text';

const BAR_CELLS = 10;
const ROWS: ReadonlyArray<readonly [channel: VolumeChannel, label: string]> = [
  ['music', 'Music'],
  ['sfx', 'SFX  '],
];

/** `████░░░░░░` for a 0..1 setting. */
export function volumeBar(setting: number): string {
  const filled = Math.round(Math.min(1, Math.max(0, setting)) * BAR_CELLS);
  return '█'.repeat(filled) + '░'.repeat(BAR_CELLS - filled);
}

/** One line of the panel, e.g. `> Music █████████░ 80%`. All rows have the same width. */
export function volumeRowText(label: string, setting: number, selected: boolean): string {
  return `${selected ? '>' : ' '} ${label} ${volumeBar(setting)} ${formatPercent(setting).padStart(4)}`;
}

export const VOLUME_HINT = 'Up/Down: select   Left/Right: adjust';

/**
 * Two rows (Music, SFX) plus a hint line. The selected row follows Up / Down, Left / Right changes it. Purely
 * presentation: the levels live in the `AudioDirector`, which applies and saves them.
 */
export class VolumePanel {
  private selected = 0;
  private readonly rows: CachedText[];
  private readonly hint: CachedText;

  /** Rows are centred on `x`; row i is at `y + i * lineHeight`, the hint one line below the last row. */
  constructor(
    scene: Phaser.Scene,
    private readonly audio: AudioDirector,
    x: number,
    y: number,
    size: number,
    lineHeight: number,
    depth: number,
  ) {
    const make = (lineY: number, fontSize: number, bold: boolean): CachedText =>
      new CachedText(
        addText(scene, x, lineY, '', { size: fontSize, color: COLORS.hint, originX: 0.5, originY: 0.5, bold }).setDepth(depth),
        COLORS.hint,
        fontSize,
      );
    this.rows = ROWS.map((_, i) => make(y + i * lineHeight, size, true));
    this.hint = make(y + ROWS.length * lineHeight, Math.round(size * 0.8), false);
    this.update();
  }

  /** Handles Up / Down (select a row) and Left / Right (change it). Returns whether the key was for the panel. */
  handleKey(code: string): boolean {
    switch (code) {
      case 'ArrowUp':
        this.selected = (this.selected + ROWS.length - 1) % ROWS.length;
        break;
      case 'ArrowDown':
        this.selected = (this.selected + 1) % ROWS.length;
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const channel = ROWS[this.selected]?.[0];
        if (channel) this.audio.adjustVolume(channel, code === 'ArrowRight' ? 1 : -1);
        break;
      }
      default:
        return false;
    }
    this.update();
    return true;
  }

  /** Cheap to call every frame: text is only touched when its content changes. */
  update(): void {
    ROWS.forEach(([channel, label], i) => {
      const selected = i === this.selected;
      const muted = channel === 'music' && this.audio.music.isMuted;
      this.rows[i]?.set(volumeRowText(label, this.audio.volume(channel), selected), muted ? COLORS.dead : selected ? COLORS.white : COLORS.hint);
    });
    this.hint.set(VOLUME_HINT, COLORS.dim);
  }

  setVisible(visible: boolean): void {
    for (const row of this.rows) row.setVisible(visible);
    this.hint.setVisible(visible);
  }
}
