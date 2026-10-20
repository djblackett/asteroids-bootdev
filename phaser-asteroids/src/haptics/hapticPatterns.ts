import type { SimEvent } from '../core/game';

/**
 * The four moments worth a physical buzz. Everything else (ordinary shots, asteroid and UFO kills, thrust, steering, score, menus)
 * happens far too often, and would turn the phone into a constant drone.
 */
export type HapticKind = 'death' | 'damage' | 'boost' | 'laser';

/** Higher outranks lower: a request may interrupt an effect that is still running only if its priority is strictly higher. */
export const HAPTIC_PRIORITY = { medium: 1, high: 2, highest: 3 } as const;

export interface HapticPattern {
  /** Milliseconds of vibration, or the Vibration API's alternating vibrate / pause list. */
  readonly pattern: number | readonly number[];
  readonly priority: number;
  /** The same kind is not played again within this many ms of its previous start (stops repetitive buzzing). */
  readonly cooldownMs: number;
}

/**
 * The tunable part. These are experimental starting values to be judged on a real phone: change a number here and nothing else.
 * `pattern` may become a list (for example `[110, 40, 60]`) to make a effect feel different rather than just longer.
 */
export const HAPTIC_PATTERNS: Readonly<Record<HapticKind, HapticPattern>> = {
  boost: { pattern: 30, priority: HAPTIC_PRIORITY.medium, cooldownMs: 250 },
  laser: { pattern: 55, priority: HAPTIC_PRIORITY.medium, cooldownMs: 200 },
  damage: { pattern: 65, priority: HAPTIC_PRIORITY.high, cooldownMs: 300 },
  death: { pattern: 110, priority: HAPTIC_PRIORITY.highest, cooldownMs: 1000 },
};

/** Most important first. This is also the tie-break between equal priorities (Boost before Laser), so a step is always resolved the same way. */
export const HAPTIC_ORDER: readonly HapticKind[] = ['death', 'damage', 'boost', 'laser'];

/**
 * Medium-priority effects keep at least this much silence after the previous effect ends, so a Laser tapped right after a Boost is not a
 * smear of buzzing. High-priority effects (damage, death) ignore it: they must never be swallowed by a lesser effect that just played.
 */
export const MEDIUM_PRIORITY_GAP_MS = 80;

/** The TEST VIBRATION button: a double pulse that none of the gameplay effects resemble, so it is recognisable as the test. */
export const TEST_PATTERN: readonly number[] = [80, 60, 80];

/** Total running time of a pattern in ms (a plain number is its own length). */
export function patternLength(pattern: number | readonly number[]): number {
  return typeof pattern === 'number' ? pattern : pattern.reduce((sum, ms) => sum + ms, 0);
}

/**
 * Which haptic effects one simulation step asks for, from the *authoritative* sim events (never from sounds or animations):
 *   boost_started  - a Boost really began (a press during its cooldown emits nothing)
 *   laser_fired    - a Laser Beam really fired (a press with no charges emits nothing), once per beam
 *   player_hit     - a ship really lost a life (a Shield or respawn protection absorbing a hit emits nothing)
 *   player_eliminated / game_over - a ship lost its last life. The sim emits `player_hit` in the very same step, which is why
 *                    `HapticManager.handle` plays only the top-ranked effect of a step: death replaces damage rather than following it.
 */
export function hapticKindsOf(events: readonly SimEvent[]): Set<HapticKind> {
  const kinds = new Set<HapticKind>();
  for (const event of events) {
    switch (event.type) {
      case 'boost_started':
        kinds.add('boost');
        break;
      case 'laser_fired':
        kinds.add('laser');
        break;
      case 'player_hit':
        kinds.add('damage');
        break;
      case 'player_eliminated':
      case 'game_over':
        kinds.add('death');
        break;
      default:
        break;
    }
  }
  return kinds;
}
