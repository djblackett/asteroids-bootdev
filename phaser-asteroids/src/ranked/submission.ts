import { prepareSubmission, sendSubmission, type PreparedSubmission, type Ranks, type RankedChallenge, type SendOptions, type VerifiedScore } from './api';
import type { ControlScheme } from './controls';
import { rememberNickname, rememberScore, type StorageLike } from './localScores';
import { nicknameFeedback } from './nickname';
import type { ReplayRecord } from '../replay/types';

/**
 * Everything between "the ranked run ended" and "the server answered", as one small state machine the result screen only draws.
 *
 *   ready --submit--> uploading --> verifying --> accepted | rejected | expired | duplicate | refused
 *     ^                  |  \------> network_error --retry--> uploading ...        (same bytes, never rebuilt)
 *     \--invalid nickname/                  |
 *   ready/network_error --skip--> skipped
 *
 * The request body (replay, nickname, controls) is built exactly once per attempt series and sent unchanged on every Retry: a response
 * lost after the server accepted the run therefore comes back as the same score instead of a second one or a "nickname changed"
 * conflict. The nickname is editable only before the first send (or after the server said the nickname itself was invalid).
 * "accepted" is reached only from a 200 the server sent; nothing here ever computes or trusts a score.
 */
export type SubmissionState =
  /** The player may edit the nickname. `nicknameError` explains what is wrong with what they typed (client check or server answer). */
  | { kind: 'ready'; nicknameError: string | null }
  | { kind: 'uploading'; attempt: number }
  | { kind: 'verifying' }
  | { kind: 'accepted'; score: VerifiedScore; ranks: Ranks; replayed: boolean }
  /** The server replayed the run and refused it. The run is spent; nothing is resent. */
  | { kind: 'rejected'; reason: string }
  /** Nothing usable came back. Retry resends the identical request. */
  | { kind: 'network_error'; message: string }
  | { kind: 'expired' }
  /** The server already holds an accepted score for this run under a different submission. */
  | { kind: 'duplicate' }
  /** The server refused the request itself (not about the play); resending cannot help. */
  | { kind: 'refused'; message: string }
  /** No leaderboard is configured in this build. */
  | { kind: 'unavailable'; message: string }
  | { kind: 'skipped' };

export interface FlowDeps {
  base: string | null;
  challenge: RankedChallenge;
  replay: ReplayRecord;
  controls: ControlScheme;
  /** True when this device already knows the challenge ran out (see `localExpiry`): the run is not sent, the player is told why. */
  expired?: () => boolean;
  storage?: StorageLike;
  send?: SendOptions;
}

const TERMINAL = new Set<SubmissionState['kind']>(['accepted', 'rejected', 'expired', 'duplicate', 'refused', 'unavailable', 'skipped']);

export class SubmissionFlow {
  state: SubmissionState;
  /** Increases on every change, so a page can tell cheaply when to redraw. */
  version = 0;
  private prepared: PreparedSubmission | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: FlowDeps) {
    this.state = this.initialState();
  }

  private initialState(): SubmissionState {
    if (!this.deps.base) return { kind: 'unavailable', message: 'Ranked scores cannot be submitted from this build' };
    if (this.deps.expired?.()) return { kind: 'expired' };
    return { kind: 'ready', nicknameError: null };
  }

  get editable(): boolean {
    return this.state.kind === 'ready';
  }

  get busy(): boolean {
    return this.state.kind === 'uploading' || this.state.kind === 'verifying';
  }

  get finished(): boolean {
    return TERMINAL.has(this.state.kind);
  }

  /** The nickname inside the request that is (or was) being sent; undefined before the first send or when none was typed. */
  get sentNickname(): string | undefined {
    return this.prepared?.nickname;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(state: SubmissionState): void {
    this.state = state;
    this.version++;
    for (const l of [...this.listeners]) l();
  }

  /** First send. `typed` is exactly what is in the name field; the server normalises it, this only gives early feedback. */
  async submit(typed: string): Promise<void> {
    if (this.state.kind !== 'ready') return;
    const problem = nicknameFeedback(typed);
    if (problem) {
      this.set({ kind: 'ready', nicknameError: problem });
      return;
    }
    if (!this.deps.base) return this.set({ kind: 'unavailable', message: 'Ranked scores cannot be submitted from this build' });
    if (this.deps.expired?.()) return this.set({ kind: 'expired' });

    this.set({ kind: 'uploading', attempt: 0 });
    const nickname = typed.normalize('NFC').trim().replace(/\s+/gu, ' ');
    this.prepared = await prepareSubmission({
      base: this.deps.base,
      challenge: this.deps.challenge,
      replay: this.deps.replay,
      controls: this.deps.controls,
      ...(nickname ? { nickname } : {}),
    });
    await this.send();
  }

  /** Sends the identical request again after a network failure. Does nothing in any other state. */
  async retry(): Promise<void> {
    if (this.state.kind !== 'network_error' || !this.prepared) return;
    this.set({ kind: 'uploading', attempt: 0 });
    await this.send();
  }

  /** The player chooses not to post this score. Not possible while a request is in flight. */
  skip(): void {
    if (this.state.kind === 'ready' || this.state.kind === 'network_error') this.set({ kind: 'skipped' });
  }

  private async send(): Promise<void> {
    const prepared = this.prepared;
    if (!prepared) return;
    const result = await sendSubmission(prepared, {
      ...this.deps.send,
      onUploaded: () => {
        if (this.state.kind === 'uploading') this.set({ kind: 'verifying' });
      },
      onRetrying: (attempt) => {
        if (this.state.kind === 'uploading' || this.state.kind === 'verifying') this.set({ kind: 'uploading', attempt });
      },
    });

    switch (result.kind) {
      case 'accepted':
        rememberScore({ id: result.score.id, score: result.score.score, at: result.score.completedAt, nickname: result.score.nickname, rulesVersion: result.score.rulesVersion }, this.deps.storage);
        if (prepared.nickname) rememberNickname(prepared.nickname, this.deps.storage);
        return this.set({ kind: 'accepted', score: result.score, ranks: result.ranks, replayed: result.replayed });
      case 'rejected':
        return this.set({ kind: 'rejected', reason: result.reason });
      case 'expired':
        return this.set({ kind: 'expired' });
      case 'already_submitted':
        return this.set({ kind: 'duplicate' });
      case 'invalid_nickname':
        // The run is still open on the server and nothing was recorded: the nickname may be changed, which means a new body.
        this.prepared = null;
        return this.set({ kind: 'ready', nicknameError: result.message.toUpperCase() });
      case 'transient':
        return this.set({ kind: 'network_error', message: result.message });
      case 'refused':
        return this.set({ kind: 'refused', message: result.message });
    }
  }
}
