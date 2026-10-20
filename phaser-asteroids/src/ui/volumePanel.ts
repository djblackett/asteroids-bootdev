import type Phaser from 'phaser';
import type { MusicChoice } from '../audio/audioConfig';
import { formatPercent, type VolumeChannel } from '../audio/audioSettings';
import { choiceLabel } from '../audio/musicTracks';
import type { AudioDirector } from '../audio/phaserAudio';
import { CachedText } from './hud';
import { addText, COLORS } from './text';

const BAR_CELLS = 10;
/** The two volume rows, then the Track row (index `TRACK_ROW`). */
const VOLUME_ROWS: ReadonlyArray<readonly [channel: VolumeChannel, label: string]> = [
  ['music', 'Music'],
  ['sfx', 'SFX  '],
];
const TRACK_ROW = VOLUME_ROWS.length;
const ROW_COUNT = VOLUME_ROWS.length + 1;
const TRACK_NAME_WIDTH = 10; // 'Gatekeeper'; shorter names are centred so the row never changes width

/** `████░░░░░░` for a 0..1 setting. */
export function volumeBar(setting: number): string {
  const filled = Math.round(Math.min(1, Math.max(0, setting)) * BAR_CELLS);
  return '█'.repeat(filled) + '░'.repeat(BAR_CELLS - filled);
}

/** One line of the panel, e.g. `> Music █████████░ 80%`. All rows have the same width. */
export function volumeRowText(label: string, setting: number, selected: boolean): string {
  return `${selected ? '>' : ' '} ${label} ${volumeBar(setting)} ${formatPercent(setting).padStart(4)}`;
}

/** The Track row, e.g. `> Track <  Random   >`: Left / Right (or a click on the left / right half) changes it. */
export function trackRowText(choice: MusicChoice, selected: boolean): string {
  const name = choiceLabel(choice);
  const pad = TRACK_NAME_WIDTH - name.length;
  const left = Math.floor(pad / 2);
  return `${selected ? '>' : ' '} Track < ${' '.repeat(left)}${name}${' '.repeat(pad - left)} >`;
}

export const VOLUME_HINT = 'Up/Down: select   Left/Right: adjust';

/**
 * Three rows (Music, SFX, Track) plus a hint line. The selected row follows Up / Down, Left / Right changes it; the Track
 * row can also be clicked (left half = previous, right half = next). Purely presentation: the levels and the soundtrack
 * live in the `AudioDirector`, which applies and saves them.
 */
export class VolumePanel {
  private selected = 0;
  private readonly rows: CachedText[];
  private readonly hint: CachedText;
  private visible = true;

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
    this.rows = Array.from({ length: ROW_COUNT }, (_, i) => make(y + i * lineHeight, size, true));
    this.hint = make(y + ROW_COUNT * lineHeight, Math.round(size * 0.8), false);
    this.update(); // the row needs its text before its size is known (all Track texts have the same width)
    // A click target a little taller and wider than the 18 px of text, so a mouse does not have to be exact.
    const trackText = this.rows[TRACK_ROW]?.text;
    // (A plain rectangle and our own test, so this file stays free of Phaser at run time and unit-testable.)
    const area = trackText ? { x: -12, y: -7, width: trackText.width + 24, height: trackText.height + 14 } : null;
    if (trackText && area) {
      trackText.setInteractive({
        hitArea: area,
        hitAreaCallback: (r: typeof area, x: number, y: number) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height,
        useHandCursor: true,
      });
    }
    trackText?.on('pointerdown', (_pointer: Phaser.Input.Pointer, localX: number) => {
      if (!this.visible) return;
      this.selected = TRACK_ROW;
      this.audio.cycleMusicChoice(localX < (this.rows[TRACK_ROW]?.text.width ?? 0) / 2 ? -1 : 1);
      this.update();
    });
  }

  /** Handles Up / Down (select a row) and Left / Right (change it). Returns whether the key was for the panel. */
  handleKey(code: string): boolean {
    switch (code) {
      case 'ArrowUp':
        this.selected = (this.selected + ROW_COUNT - 1) % ROW_COUNT;
        break;
      case 'ArrowDown':
        this.selected = (this.selected + 1) % ROW_COUNT;
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const direction = code === 'ArrowRight' ? 1 : -1;
        if (this.selected === TRACK_ROW) this.audio.cycleMusicChoice(direction);
        else {
          const channel = VOLUME_ROWS[this.selected]?.[0];
          if (channel) this.audio.adjustVolume(channel, direction);
        }
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
    VOLUME_ROWS.forEach(([channel, label], i) => {
      const selected = i === this.selected;
      const muted = channel === 'music' && this.audio.music.isMuted;
      this.rows[i]?.set(volumeRowText(label, this.audio.volume(channel), selected), muted ? COLORS.dead : selected ? COLORS.white : COLORS.hint);
    });
    const trackSelected = this.selected === TRACK_ROW;
    this.rows[TRACK_ROW]?.set(trackRowText(this.audio.musicChoice, trackSelected), trackSelected ? COLORS.white : COLORS.hint);
    this.hint.set(VOLUME_HINT, COLORS.dim);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const row of this.rows) row.setVisible(visible);
    this.hint.setVisible(visible);
  }
}
