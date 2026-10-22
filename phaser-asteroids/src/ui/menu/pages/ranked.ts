import type { PersonalBest } from '../../../ranked/personalBest';
import { formatScore } from '../../../ranked/scoresModel';
import { COLORS } from '../../text';
import type { MenuContext, PageNav } from '../context';
import type { PageDef } from '../menuView';
import { MenuButton, MIN_TARGET, TEXT, type PageKit } from '../widgets';
import { CENTER_X, keyHint, pageTitle } from './common';

/** Where a request for a ranked run stands. The title scene owns it; the page only draws it. */
export type RankedRequestStatus =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  /** `code` is the RankedApiError code (network, unavailable, unconfigured, update_required, rate_limited, bad_challenge). */
  | { kind: 'error'; code: string };

export interface RankedMenuContext {
  readonly inputMode: MenuContext['inputMode'];
  inputAvailable(): boolean;
  status(): RankedRequestStatus;
  best(): PersonalBest | null;
  /** "20:00": the run length the server issues, spelled out before the player starts. */
  readonly timeLimitLabel: string;
  actions: {
    /** Asks the server for a challenge and, once it has one, starts the run. */
    start(): void;
    /** Gives up waiting for the challenge. */
    cancel(): void;
    /** A casual game: always available, whatever the ranked service is doing. */
    playNormally(): void;
    openScores(): void;
    enableTouch(): void;
  };
}

const WIDE = { w: 600, h: 110 };

/** What the player is told when the ranked service cannot start a run, and whether trying again could help. */
export function describeRankedFailure(code: string): { lines: [string, string]; retry: boolean } {
  switch (code) {
    case 'unconfigured':
      return { lines: ['RANKED PLAY IS NOT AVAILABLE IN THIS BUILD YET.', 'YOU CAN STILL PLAY NORMALLY.'], retry: false };
    case 'update_required':
      return { lines: ['THE GAME HAS BEEN UPDATED.', 'RELOAD THE PAGE TO PLAY RANKED.'], retry: false };
    case 'rate_limited':
      return { lines: ['TOO MANY RANKED RUNS STARTED RECENTLY.', 'TRY AGAIN IN A WHILE, OR PLAY NORMALLY.'], retry: true };
    default:
      return { lines: ['RANKED PLAY IS TEMPORARILY UNAVAILABLE.', 'YOU CAN STILL PLAY NORMALLY.'], retry: true };
  }
}

/**
 * RANKED PLAY: what a ranked run is, in four short lines (including its time limit, before anyone starts), the best verified score
 * on this device, and START RANKED RUN. Starting asks the server for a challenge; this page shows that wait and, when it fails, says
 * so plainly and offers a normal game instead. Nothing here starts a run on its own.
 */
export function buildRankedPage(kit: PageKit, ctx: RankedMenuContext, nav: PageNav): PageDef {
  const status = ctx.status();
  pageTitle(kit, 'RANKED PLAY');

  if (!ctx.inputAvailable()) {
    kit.text(CENTER_X, 180, 'TOUCH GAMEPLAY CONTROLS ARE OFF.', { size: TEXT.body + 2, originX: 0.5, originY: 0.5, color: '#ff9696' });
    kit.text(CENTER_X, 225, 'TURN THEM ON, OR USE A KEYBOARD / CONTROLLER.', { size: TEXT.body, originX: 0.5, originY: 0.5, color: COLORS.hint });
    kit.text(CENTER_X, 266, 'CONTROLLER: PRESS A TO JOIN. KEYBOARD: PRESS ENTER.', { size: TEXT.small, originX: 0.5, originY: 0.5, color: COLORS.hint });
    new MenuButton(kit, { id: 'touch-on', rect: { x: CENTER_X - WIDE.w / 2, y: 310, ...WIDE }, label: 'TURN TOUCH CONTROLS ON', primary: true, onTap: ctx.actions.enableTouch, size: 32 });
    new MenuButton(kit, { id: 'start', rect: { x: CENTER_X - WIDE.w / 2, y: 436, w: WIDE.w, h: MIN_TARGET }, label: 'START WITH KEYBOARD', keysOnly: true, onTap: ctx.actions.start, size: 30 });
    new MenuButton(kit, { id: 'back', rect: { x: CENTER_X - WIDE.w / 2, y: 542, w: WIDE.w, h: MIN_TARGET }, label: 'BACK', onTap: () => { ctx.actions.cancel(); nav.back(); }, size: 30 });
    return { defaultFocus: 'start', onBack: () => { ctx.actions.cancel(); return false; }, signature: () => `${ctx.inputAvailable()}` };
  }

  if (status.kind === 'error') {
    const failure = describeRankedFailure(status.code);
    kit.text(CENTER_X, 190, failure.lines[0], { size: TEXT.body + 2, originX: 0.5, originY: 0.5, color: '#ff9696' });
    kit.text(CENTER_X, 236, failure.lines[1], { size: TEXT.body, originX: 0.5, originY: 0.5, color: COLORS.hint });
    let y = 300;
    if (failure.retry) {
      new MenuButton(kit, { id: 'start', rect: { x: CENTER_X - WIDE.w / 2, y, ...WIDE }, label: 'TRY AGAIN', primary: true, onTap: ctx.actions.start, size: 40 });
      y += WIDE.h + 16;
    }
    const w = (WIDE.w - 16) / 2;
    new MenuButton(kit, { id: 'play-normally', rect: { x: CENTER_X - WIDE.w / 2, y, w, h: MIN_TARGET }, label: 'PLAY NORMALLY', primary: !failure.retry, onTap: ctx.actions.playNormally, size: 26 });
    new MenuButton(kit, { id: 'back', rect: { x: CENTER_X - WIDE.w / 2 + w + 16, y, w, h: MIN_TARGET }, label: 'BACK', onTap: () => nav.back(), size: 30 });
    keyHint(kit, ctx, 'UP / DOWN: CHOOSE     ENTER: SELECT     ESC: BACK');
    return { defaultFocus: failure.retry ? 'start' : 'play-normally', signature: () => `${ctx.inputAvailable()}|${ctx.status().kind}` };
  }

  const lines = [
    'ONE PLAYER. THE NORMAL GAME.',
    'THE SERVER CHECKS YOUR SCORE.',
    `A RANKED RUN ENDS AT ${ctx.timeLimitLabel}.`,
    'STILL ALIVE THEN? YOUR SCORE COUNTS.',
  ];
  lines.forEach((line, i) => kit.text(CENTER_X, 140 + i * 40, line, { size: TEXT.body, originX: 0.5, originY: 0.5, color: i === 2 ? COLORS.heading : COLORS.hint }));

  const best = ctx.best();
  if (best) {
    const who = best.best.nickname ? ` (${best.best.nickname.toUpperCase()})` : '';
    kit.text(CENTER_X, 318, `YOUR BEST VERIFIED SCORE: ${formatScore(best.best.score)}${who}`, { size: TEXT.body, originX: 0.5, originY: 0.5, color: COLORS.white });
  }

  const connecting = status.kind === 'connecting';
  new MenuButton(kit, {
    id: 'start',
    rect: { x: CENTER_X - WIDE.w / 2, y: 366, ...WIDE },
    label: connecting ? 'CONNECTING...' : 'START RANKED RUN',
    primary: true,
    enabled: () => !connecting,
    onTap: ctx.actions.start,
    size: connecting ? 40 : 38,
  });
  const w = (WIDE.w - 16) / 2;
  new MenuButton(kit, { id: 'scores', rect: { x: CENTER_X - WIDE.w / 2, y: 492, w, h: MIN_TARGET }, label: 'HIGH SCORES', onTap: ctx.actions.openScores, size: 28 });
  new MenuButton(kit, {
    id: 'back',
    rect: { x: CENTER_X - WIDE.w / 2 + w + 16, y: 492, w, h: MIN_TARGET },
    label: connecting ? 'CANCEL' : 'BACK',
    onTap: () => {
      if (connecting) ctx.actions.cancel();
      nav.back();
    },
    size: 30,
  });
  keyHint(kit, ctx, 'UP / DOWN: CHOOSE     ENTER: SELECT     ESC: BACK');
  return {
    defaultFocus: connecting ? 'back' : 'start',
    // Escape closes the page like BACK does, so it must also give up a request that is still waiting.
    onBack: () => {
      if (connecting) ctx.actions.cancel();
      return false;
    },
    signature: () => `${ctx.inputAvailable()}|${ctx.status().kind}|${ctx.best()?.best.id ?? ''}`,
  };
}
