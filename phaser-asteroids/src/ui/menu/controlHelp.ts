import type { KeyScheme } from '../../input/keyboardControls';
import type { MovementMode } from '../../input/movementMode';

/**
 * The control reference the title and Controls screens print. Keyboard rows are generated from the real key schemes the game reads
 * (`keyboardControls.ts`), so the screen cannot show a key that does not work; the controller and touch rows describe
 * `padToInput` and the touch overlay. Pure data: no Phaser.
 */

export interface HelpRow {
  /** Key caps / button names, as drawn (`W`, `SPACE`, `L-STICK`). */
  caps: readonly string[];
  /** A full phrase for a one-player screen with room. */
  long: string;
  /** One or two words for the narrow two-player columns. */
  short: string;
}

export type Whose = 'solo' | 'p1' | 'p2';

const CAP_LABELS: Readonly<Record<string, string>> = {
  Space: 'SPACE',
  Enter: 'ENTER',
  NumpadEnter: 'ENTER',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Period: '.',
  Semicolon: ';',
  Comma: ',',
};

/** The cap printed for the first key of a binding. Both Shift keys count as just SHIFT; one of them alone says which. */
export function capFor(codes: readonly string[]): string {
  const [first = ''] = codes;
  if (first === 'ShiftLeft' || first === 'ShiftRight') {
    return codes.includes('ShiftLeft') && codes.includes('ShiftRight') ? 'SHIFT' : first === 'ShiftLeft' ? 'L-SHIFT' : 'R-SHIFT';
  }
  return CAP_LABELS[first] ?? (first.startsWith('Key') ? first.slice(3) : first.startsWith('Digit') ? first.slice(5) : first);
}

/** The five things a keyboard player does, from one key scheme. */
export function keyboardRows(scheme: KeyScheme): HelpRow[] {
  return [
    { caps: [capFor(scheme.forward), capFor(scheme.backward)], long: 'Move forward / back', short: 'Move' },
    { caps: [capFor(scheme.rotateLeft), capFor(scheme.rotateRight)], long: 'Turn left / right', short: 'Turn' },
    { caps: [capFor(scheme.shoot)], long: 'Shoot (hold to fire)', short: 'Shoot' },
    { caps: [capFor(scheme.laser)], long: 'Laser beam', short: 'Laser' },
    { caps: [capFor(scheme.boost)], long: 'Boost', short: 'Boost' },
  ];
}

/** The controller, as `padToInput` reads it (see `gamepadMapping.ts`): left stick moves, A or the right trigger shoots, X laser, B boost. */
export const PAD_ROWS: readonly HelpRow[] = [
  { caps: ['L-STICK'], long: 'Move and turn', short: 'Move' },
  { caps: ['A', 'RT'], long: 'Shoot (hold to fire)', short: 'Shoot' },
  { caps: ['X'], long: 'Laser beam', short: 'Laser' },
  { caps: ['B'], long: 'Boost', short: 'Boost' },
  { caps: ['START'], long: 'Pause', short: 'Pause' },
];

/** What the on-screen controls are called, drawn in the colour they have in the game (see touch.css). */
export interface TouchHelpRow {
  label: string;
  text: string;
  /** CSS colour of the in-game button; null for the neutral white controls. */
  color: string | null;
  kind: 'dpad' | 'stick' | 'fire' | 'laser' | 'boost' | 'pause';
}

const STEERING_ROW: Readonly<Record<MovementMode, TouchHelpRow>> = {
  classic: { label: 'D-PAD', text: 'Move and turn', color: null, kind: 'dpad' },
  pointToFly: { label: 'STICK', text: 'Point to fly', color: null, kind: 'stick' },
  assisted: { label: 'STICK', text: 'Point to travel', color: null, kind: 'stick' },
};

export function touchRows(movement: MovementMode): TouchHelpRow[] {
  return [
    STEERING_ROW[movement],
    { label: 'FIRE', text: 'Hold to shoot', color: '#ff6450', kind: 'fire' },
    { label: 'LASER', text: 'Piercing beam', color: '#64c8ff', kind: 'laser' },
    { label: 'BOOST', text: 'Speed burst', color: '#ff64ff', kind: 'boost' },
    { label: 'PAUSE', text: 'Top-right corner', color: null, kind: 'pause' },
  ];
}

/** The keys every keyboard player has, whatever the ship scheme. */
export const SYSTEM_KEYS_LINE = 'P / ESC pause   M music';
