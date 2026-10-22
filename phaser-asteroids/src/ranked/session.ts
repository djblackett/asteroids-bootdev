import type { RankedChallenge, SubmitOutcome } from './api';

export type RankedPhase = 'idle' | 'requesting' | 'ready' | 'playing' | 'submitting' | 'accepted' | 'rejected' | 'failed' | 'abandoned';

export interface RankedSnapshot {
  phase: RankedPhase;
  runId: string | null;
  seed: number | null;
  /** Server-reported result once accepted; the only score that counts. */
  verifiedScore: number | null;
  outcome: SubmitOutcome | null;
  message: string;
}

/**
 * Where a ranked run is, for the game-over line and for browser tests. One game per page, so a module singleton is enough.
 * Lifecycle: idle -> requesting -> ready (challenge in hand) -> playing -> submitting -> accepted | rejected | failed,
 * or abandoned when the player leaves before game over. A casual game never touches it.
 */
class RankedSession {
  phase: RankedPhase = 'idle';
  private challenge: RankedChallenge | null = null;
  /** The run whose result this session is waiting for; a late answer for any other run is ignored. */
  private currentRunId: string | null = null;
  private outcome: SubmitOutcome | null = null;
  private message = '';

  /** The player asked for a ranked run: forget the previous one (a slow answer for it must not overwrite what follows). */
  beginRequest(): void {
    this.challenge = null;
    this.currentRunId = null;
    this.outcome = null;
    this.set('requesting');
  }

  /** A challenge was issued: the next GameScene is a ranked run. */
  setChallenge(challenge: RankedChallenge): void {
    this.challenge = challenge;
    this.outcome = null;
    this.message = '';
    this.set('ready');
  }

  /** Consumed by exactly one GameScene: a retry or restart can never reuse (or silently continue) a ranked challenge. */
  takeChallenge(): RankedChallenge | null {
    const c = this.challenge;
    this.challenge = null;
    if (c) {
      this.currentRunId = c.runId;
      this.set('playing');
    }
    return c;
  }

  set(phase: RankedPhase, message = ''): void {
    this.phase = phase;
    this.message = message;
    this.publish();
  }

  finish(runId: string, outcome: SubmitOutcome): void {
    if (runId !== this.currentRunId) return;
    this.outcome = outcome;
    if (outcome.kind === 'accepted') this.set('accepted');
    else if (outcome.kind === 'rejected') this.set('rejected', outcome.message);
    else this.set('failed', outcome.message);
  }

  /** The line shown on the game-over screen. Empty for casual play. */
  statusLine(): string {
    switch (this.phase) {
      case 'submitting':
        return 'RANKED: VERIFYING SCORE...';
      case 'accepted': {
        if (this.outcome?.kind !== 'accepted') return '';
        const { score, ranks } = this.outcome;
        const place = ranks.weekly ? `#${ranks.weekly} THIS WEEK` : ranks.allTime ? `#${ranks.allTime} ALL-TIME` : 'RECORDED';
        return `VERIFIED ${score.score}  ${place}`;
      }
      case 'rejected':
        return `RANKED SCORE NOT RECORDED: ${this.message}`.toUpperCase();
      case 'failed':
        return `RANKED SCORE NOT SUBMITTED: ${this.message}`.toUpperCase();
      default:
        return '';
    }
  }

  snapshot(): RankedSnapshot {
    return {
      phase: this.phase,
      runId: this.currentRunId ?? this.challenge?.runId ?? null,
      seed: this.challenge?.seed ?? null,
      verifiedScore: this.outcome?.kind === 'accepted' ? this.outcome.score.score : null,
      outcome: this.outcome,
      message: this.message,
    };
  }

  private publish(): void {
    if (typeof window === 'undefined') return;
    (window as unknown as { __ASTEROIDS_RANKED__?: unknown }).__ASTEROIDS_RANKED__ = { ...this.snapshot(), phase: this.phase };
  }
}

export const rankedSession = new RankedSession();
