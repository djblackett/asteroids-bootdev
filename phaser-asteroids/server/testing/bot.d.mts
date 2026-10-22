import type { GameConfig } from '../../src/core/gameConfig';
import type { ReplayRecord } from '../../src/replay';

export interface BotOptions {
  seed: number;
  config?: GameConfig;
  stress?: boolean;
  maxTicks?: number;
  idle?: boolean;
  spin?: boolean;
}

export interface BotRun {
  replay: ReplayRecord;
  score: number;
  gameOver: boolean;
  ticks: number;
}

export function generateBotReplay(engine: unknown, opts: BotOptions): BotRun;
