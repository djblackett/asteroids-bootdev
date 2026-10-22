import { localExpiry, type RankedChallenge, type SubmitResult } from './api';
import type { SubmissionFlow, SubmissionState } from './submission';

export type RankedPhase =
  | 'idle'
  | 'requesting'
  /** A challenge is in hand; the next GameScene is the ranked run. */
  | 'ready'
  | 'playing'
  /** The run ended; the player has not yet submitted or skipped. */
  | 'finished'
  | 'submitting'
  | 'accepted'
  | 'rejected'
  | 'failed'
  | 'skipped'
  | 'abandoned';

export interface RankedSnapshot {
  phase: RankedPhase;
  runId: string | null;
  seed: number | null;
  /** Server-reported result once accepted; the only score that counts. */
  verifiedScore: number | null;
  /** The submission state machine's current state (the result screen draws it). */
  submission: SubmissionState['kind'] | null;
  outcome: Extract<SubmitResult, { kind: 'accepted' }> | null;
  message: string;
}

/**
 * Where a ranked run is, for the title screen's request status and for browser tests (`window.__ASTEROIDS_RANKED__`). One game per page,
 * so a module singleton is enough.
 * Lifecycle: idle -> requesting -> ready (challenge in hand) -> playing -> finished -> submitting -> accepted | rejected | failed | skipped,
 * or abandoned when the player leaves before the run ends. A casual game never touches it.
 */
/** A challenge handed to the game, with the moment it stops being valid on THIS device's clock. */
export interface TakenChallenge {
  challenge: RankedChallenge;
  expiresAtLocal: number;
}

class RankedSession {
  phase: RankedPhase = 'idle';
  private challenge: RankedChallenge | null = null;
  private expiresAtLocal = 0;
  /** The run whose result this session is waiting for; a late answer for any other run is ignored. */
  private currentRunId: string | null = null;
  private flow: SubmissionFlow | null = null;
  private stopFlow: (() => void) | null = null;
  private message = '';

  /** The player asked for a ranked run: forget the previous one (a slow answer for it must not overwrite what follows). */
  beginRequest(): void {
    this.detach();
    this.challenge = null;
    this.currentRunId = null;
    this.set('requesting');
  }

  /** A challenge was issued: the next GameScene is a ranked run. */
  setChallenge(challenge: RankedChallenge, receivedAtMs: number = Date.now()): void {
    this.challenge = challenge;
    this.expiresAtLocal = localExpiry(challenge, receivedAtMs);
    this.message = '';
    this.set('ready');
  }

  /** Consumed by exactly one GameScene: a retry or restart can never reuse (or silently continue) a ranked challenge. */
  takeChallenge(): TakenChallenge | null {
    const c = this.challenge;
    this.challenge = null;
    if (!c) return null;
    this.detach();
    this.currentRunId = c.runId;
    this.set('playing');
    return { challenge: c, expiresAtLocal: this.expiresAtLocal };
  }

  set(phase: RankedPhase, message = ''): void {
    this.phase = phase;
    this.message = message;
    this.publish();
  }

  /** The run ended and the result screen owns the submission from here; the session just mirrors its progress. */
  attach(runId: string, flow: SubmissionFlow): void {
    if (runId !== this.currentRunId) return;
    this.detach();
    this.flow = flow;
    const follow = (): void => {
      if (this.flow !== flow) return;
      this.phase = phaseOf(flow.state);
      this.message = '';
      this.publish();
    };
    this.stopFlow = flow.onChange(follow);
    follow();
  }

  private detach(): void {
    this.stopFlow?.();
    this.stopFlow = null;
    this.flow = null;
  }

  snapshot(): RankedSnapshot {
    const state = this.flow?.state ?? null;
    return {
      phase: this.phase,
      runId: this.currentRunId ?? this.challenge?.runId ?? null,
      seed: this.challenge?.seed ?? null,
      verifiedScore: state?.kind === 'accepted' ? state.score.score : null,
      submission: state?.kind ?? null,
      outcome: state?.kind === 'accepted' ? { kind: 'accepted', score: state.score, ranks: state.ranks, replayed: state.replayed } : null,
      message: this.message,
    };
  }

  private publish(): void {
    if (typeof window === 'undefined') return;
    (window as unknown as { __ASTEROIDS_RANKED__?: unknown }).__ASTEROIDS_RANKED__ = this.snapshot();
  }
}

function phaseOf(state: SubmissionState): RankedPhase {
  switch (state.kind) {
    case 'ready':
      return 'finished';
    case 'uploading':
    case 'verifying':
      return 'submitting';
    case 'accepted':
      return 'accepted';
    case 'rejected':
      return 'rejected';
    case 'skipped':
      return 'skipped';
    default:
      return 'failed';
  }
}

export const rankedSession = new RankedSession();
