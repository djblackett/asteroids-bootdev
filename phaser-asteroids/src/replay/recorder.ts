import type { GameSim } from '../core/game';
import type { GameConfig } from '../core/gameConfig';
import type { PlayerInput } from '../core/player';
import { MAX_REPLAY_INPUT_CHANGES, MAX_REPLAY_TICKS } from './constants';
import {
  areRecordedInputsEqual,
  createDefaultReplayHeader,
  toRecordedInput,
  type RecordedInput,
  type ReplayHeader,
  type ReplayInputChange,
  type ReplayRecord,
  type ReplayResultClaim,
} from './types';

export class ReplayRecorder {
  private header: ReplayHeader;
  private readonly inputChanges: ReplayInputChange[] = [];
  private lastRecordedInput: RecordedInput | null = null;
  private currentTicks = 0;
  private completedGameOver = false;
  private claimedResult: ReplayResultClaim | null = null;
  private isAbandoned = false;

  constructor(
    readonly seed: number,
    readonly config: GameConfig,
    gameVersion = '0.1.0',
  ) {
    // Clone config deeply so mutations never affect the original
    const clonedConfig: GameConfig = JSON.parse(JSON.stringify(config));
    this.header = createDefaultReplayHeader(seed, clonedConfig, gameVersion);
  }

  get ticks(): number {
    return this.currentTicks;
  }

  get changeCount(): number {
    return this.inputChanges.length;
  }

  get isFinalized(): boolean {
    return this.completedGameOver;
  }

  get abandoned(): boolean {
    return this.isAbandoned;
  }

  /**
   * Called on every fixed simulation tick with the effective player input for that tick.
   * Only records when the input changes from the previously recorded input.
   */
  recordTick(tick: number, input: PlayerInput, sim?: GameSim): void {
    if (this.completedGameOver || this.isAbandoned) return;

    if (tick > MAX_REPLAY_TICKS) {
      this.isAbandoned = true;
      throw new Error(`Replay tick count exceeded maximum limit of ${MAX_REPLAY_TICKS}`);
    }

    const recorded = toRecordedInput(input);
    if (!this.lastRecordedInput || !areRecordedInputsEqual(this.lastRecordedInput, recorded)) {
      if (this.inputChanges.length >= MAX_REPLAY_INPUT_CHANGES) {
        this.isAbandoned = true;
        throw new Error(`Replay input change count exceeded limit of ${MAX_REPLAY_INPUT_CHANGES}`);
      }
      this.inputChanges.push({ tick, input: recorded });
      this.lastRecordedInput = recorded;
    }

    this.currentTicks = tick + 1;

    if (sim?.isGameOver) {
      this.markGameOver(sim);
    }
  }

  /**
   * Finalizes the recording with game-over state.
   */
  markGameOver(sim: GameSim): void {
    if (this.completedGameOver) return;
    this.completedGameOver = true;
    this.claimedResult = {
      totalTicks: this.currentTicks,
      score: sim.totalScore,
      gameOverReason: sim.gameOverReason,
      phase: sim.phase,
      endReason: 'game_over',
    };
  }

  /**
   * Finalizes a ranked run that reached the tick limit the server issued while the ship was still alive. Like `markGameOver` it only
   * records what the client believes (the server never trusts it); the recording simply stops here and nothing further is recorded.
   */
  markTimeLimit(sim: GameSim): void {
    if (this.completedGameOver) return;
    this.completedGameOver = true;
    this.claimedResult = {
      totalTicks: this.currentTicks,
      score: sim.totalScore,
      gameOverReason: sim.gameOverReason,
      phase: sim.phase,
      endReason: 'time_limit',
    };
  }

  /**
   * Marks this recording as explicitly abandoned (e.g. user quit to menu mid-game).
   */
  abandon(): void {
    this.isAbandoned = true;
  }

  /**
   * Finalizes the recording and returns the full `ReplayRecord`.
   */
  exportReplay(): ReplayRecord {
    if (!this.inputChanges.length) {
      // If no inputs were recorded, push neutral input at tick 0
      this.inputChanges.push({ tick: 0, input: { rotate: 0, move: 0, shoot: false } });
    }

    return {
      header: JSON.parse(JSON.stringify(this.header)),
      inputs: JSON.parse(JSON.stringify(this.inputChanges)),
      totalTicks: this.currentTicks,
      claimedResult: this.claimedResult ? { ...this.claimedResult } : undefined,
    };
  }

  /**
   * Serializes the replay record to a JSON string.
   */
  serialize(): string {
    return JSON.stringify(this.exportReplay());
  }
}
