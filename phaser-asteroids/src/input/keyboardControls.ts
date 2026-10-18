import Phaser from 'phaser';
import type { PlayerInput } from '../core/player';

/** Key names understood by `keyboard.addKey`. */
export interface KeyScheme {
  rotateLeft: readonly string[];
  rotateRight: readonly string[];
  forward: readonly string[];
  backward: readonly string[];
  shoot: readonly string[];
}

/** Player 1 as in the Python game (WASD + Space). Arrow keys are accepted too while there is only one player. */
export const SOLO_KEYS: KeyScheme = {
  rotateLeft: ['A', 'LEFT'],
  rotateRight: ['D', 'RIGHT'],
  forward: ['W', 'UP'],
  backward: ['S', 'DOWN'],
  shoot: ['SPACE'],
};

type KeyList = Phaser.Input.Keyboard.Key[];

/** Polls a set of keyboard keys and converts them into the simulation's `PlayerInput`. */
export class KeyboardControls {
  private readonly left: KeyList;
  private readonly right: KeyList;
  private readonly forward: KeyList;
  private readonly backward: KeyList;
  private readonly shoot: KeyList;

  constructor(keyboard: Phaser.Input.Keyboard.KeyboardPlugin, scheme: KeyScheme = SOLO_KEYS) {
    const add = (names: readonly string[]): KeyList => names.map((name) => keyboard.addKey(name));
    this.left = add(scheme.rotateLeft);
    this.right = add(scheme.rotateRight);
    this.forward = add(scheme.forward);
    this.backward = add(scheme.backward);
    this.shoot = add(scheme.shoot);
  }

  /** Same precedence as Python: when opposing keys are held the later check (D / S) wins. */
  read(): PlayerInput {
    const down = (keys: KeyList): boolean => keys.some((k) => k.isDown);
    let rotate = 0;
    if (down(this.left)) rotate = -1;
    if (down(this.right)) rotate = 1;
    let move = 0;
    if (down(this.forward)) move = 1;
    if (down(this.backward)) move = -1;
    return { rotate, move, shoot: down(this.shoot) };
  }
}
