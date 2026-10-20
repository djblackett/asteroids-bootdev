import type Phaser from 'phaser';
import { DEFAULT_GAME_CONFIG, resolveGameConfig, type GameConfig } from './core/gameConfig';
import type { P2KeyLayout } from './input/keyboardControls';

/**
 * Everything the title screen chooses for the next run: the simulation's `GameConfig` plus which keys Player 2 uses.
 * It lives in the Phaser registry (so it survives scene changes and retries, and is gone when the page reloads) and the
 * game scene turns it into a brand-new `GameSim` every time, so a one-player run can never inherit co-op state.
 */
export interface GameSetup {
  game: GameConfig;
  p2Keys: P2KeyLayout;
}

export const DEFAULT_SETUP: Readonly<GameSetup> = { game: DEFAULT_GAME_CONFIG, p2Keys: 'arrows' };

const SETUP_KEY = 'gameSetup';

/** The menu keeps the chosen options even for a one-player game (so switching back to two players remembers them). */
export function getSetup(registry: Phaser.Data.DataManager): GameSetup {
  return (registry.get(SETUP_KEY) as GameSetup | undefined) ?? { ...DEFAULT_SETUP, game: { ...DEFAULT_GAME_CONFIG } };
}

export function setSetup(registry: Phaser.Data.DataManager, setup: GameSetup): void {
  registry.set(SETUP_KEY, setup);
}

/** The config the simulation actually runs with (normalised: a one-player run drops every co-op option). */
export function simConfigOf(setup: GameSetup): GameConfig {
  return resolveGameConfig(setup.game);
}
