import { FRIENDLY_FIRE_DEFAULT } from './constants';

export type PlayerCount = 1 | 2;
/** `independent`: every player has their own 3 lives. `shared`: one pool of `SHARED_LIVES_POOL` for the team. */
export type LivesMode = 'independent' | 'shared';

/** Everything the menu chooses about a run. The simulation only ever sees this, never menu or key state. */
export interface GameConfig {
  playerCount: PlayerCount;
  livesMode: LivesMode;
  /** Whether a player's shots and Laser Beam hurt the other player (two players only). */
  friendlyFire: boolean;
  /** Movement-speed handicap per player (index 0 = P1): 1 = normal. Only forward / backward speed is scaled; two players only. */
  speed: readonly [number, number];
}

export const DEFAULT_GAME_CONFIG: Readonly<GameConfig> = {
  playerCount: 1,
  livesMode: 'independent',
  friendlyFire: FRIENDLY_FIRE_DEFAULT,
  speed: [1, 1],
};

/**
 * Fills in defaults and drops what cannot apply: a one-player game always has independent lives, no friendly fire,
 * normal speed and no second ship, whatever the menu last held, so no co-op setting can leak into single-player play.
 */
export function resolveGameConfig(partial: Partial<GameConfig> = {}): GameConfig {
  const merged: GameConfig = { ...DEFAULT_GAME_CONFIG, ...partial, speed: partial.speed ?? DEFAULT_GAME_CONFIG.speed };
  if (merged.playerCount === 1) return { playerCount: 1, livesMode: 'independent', friendlyFire: false, speed: [1, 1] };
  return merged;
}
