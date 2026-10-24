import type { GameConfig } from '../../src/core/gameConfig';
import type { ReplayRecord } from '../../src/replay';

export interface BotOptions {
  seed: number;
  config?: GameConfig;
  stress?: boolean;
  maxTicks?: number;
  idle?: boolean;
  spin?: boolean;
  bossFight?: boolean;
  bossDelay?: number;
}

export interface BotRun {
  replay: ReplayRecord;
  score: number;
  gameOver: boolean;
  ticks: number;
  encounter: { startTick: number | null; combatTick: number | null; victoryTick: number | null;
    bonuses: number; hits: number; bossHits: number; fires: string[]; beam: boolean };
}

export function generateBotReplay(engine: unknown, opts: BotOptions): BotRun;
