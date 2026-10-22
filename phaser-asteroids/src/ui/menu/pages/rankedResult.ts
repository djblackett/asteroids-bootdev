import { NICKNAME_HELP, nicknameFeedback } from '../../../ranked/nickname';
import { formatScore } from '../../../ranked/scoresModel';
import type { SubmissionFlow } from '../../../ranked/submission';
import { COLORS } from '../../text';
import type { MenuContext, PageNav } from '../context';
import type { PageDef } from '../menuView';
import { MenuButton, MenuField, MIN_TARGET, TEXT, type FieldInput, type PageKit } from '../widgets';
import { CENTER_X } from './common';

/** What the ranked result page needs from the game scene. */
export interface RankedResultContext {
  readonly inputMode: MenuContext['inputMode'];
  readonly flow: SubmissionFlow;
  /** The DOM name field (it outlives page rebuilds: see NicknameInput). */
  readonly input: FieldInput & {
    readonly value: string;
    hide(): void;
    setInvalid(invalid: boolean): void;
    announce(text: string): void;
  };
  /** The score this device's own game showed. Never presented as verified: only the server's answer is. */
  readonly runScore: number;
  /** How the run ended: the ship was lost, or the ranked time limit was reached with the ship still alive. */
  readonly endReason: 'game_over' | 'time_limit';
  /** "20:00" */
  readonly timeLimitLabel: string;
  /** This device's best verified score from before this run (null: none yet), for the "new personal best" line. */
  readonly priorBest: number | null;
  readonly actions: {
    /** Another ranked run: back to the title screen, which asks the server for a new challenge. */
    playAgain(): void;
    toMenu(): void;
    openScores(): void;
  };
}

const GOOD = '#64ff64';
const BAD = '#ff6464';
const WARN = '#ffa050';
const FIELD = { x: CENTER_X - 300, y: 196, w: 600, h: MIN_TARGET };

interface ButtonSpec {
  id: string;
  label: string;
  onTap: () => void;
  primary?: boolean;
}

/** Up to two buttons per row, each row centred, a lone last button centred under the pair above it. */
function buttonGrid(kit: PageKit, top: number, specs: ButtonSpec[], width = 560): void {
  const gap = 16;
  specs.forEach((spec, i) => {
    const row = Math.floor(i / 2);
    const inRow = Math.min(2, specs.length - row * 2);
    const col = i % 2;
    const x = CENTER_X - (inRow * width + (inRow - 1) * gap) / 2 + col * (width + gap);
    new MenuButton(kit, { id: spec.id, rect: { x, y: top + row * (MIN_TARGET + gap), w: width, h: MIN_TARGET }, label: spec.label, primary: spec.primary, onTap: spec.onTap, size: 30 });
  });
}

const heading = (kit: PageKit, text: string, color: string = COLORS.white, size = 44): void => void kit.text(CENTER_X, 44, text, { size, originX: 0.5, originY: 0.5, color });

function scoreBlock(kit: PageKit, ctx: RankedResultContext, y = 150): void {
  const timed = ctx.endReason === 'time_limit';
  kit.text(CENTER_X, 88, timed ? `RANKED RUN - SURVIVED THE FULL ${ctx.timeLimitLabel}!` : 'RANKED RUN', { size: TEXT.small, originX: 0.5, originY: 0.5, color: COLORS.heading });
  kit.text(CENTER_X, y, formatScore(ctx.runScore), { size: 72, originX: 0.5, originY: 0.5 });
}

function message(kit: PageKit, lines: Array<[string, string]>, top = 250): void {
  lines.forEach(([text, color], i) => kit.text(CENTER_X, top + i * 38, text, { size: TEXT.body, originX: 0.5, originY: 0.5, color }));
}

function reasonText(reason: string): string {
  if (reason === 'too_fast') return 'THE RUN ARRIVED FASTER THAN IT COULD HAVE BEEN PLAYED.';
  return `REASON CODE: ${reason.toUpperCase()}`;
}

/**
 * The page a ranked run ends on. It draws `ctx.flow.state` and nothing else: the name field and SUBMIT while the player can still
 * edit, honest "uploading" / "verifying" wording while the request is out, the server's verdict afterwards, and a way to try again,
 * skip, play again or leave in every state where those make sense. "SCORE VERIFIED!" appears only for a state the server confirmed.
 * The page is rebuilt whenever the state changes; the typed name lives in the DOM input and survives that.
 */
export function buildRankedResultPage(kit: PageKit, ctx: RankedResultContext, _nav: PageNav): PageDef {
  const { flow, actions } = ctx;
  const state = flow.state;
  const timed = ctx.endReason === 'time_limit';
  const title = timed ? 'TIME LIMIT REACHED' : 'GAME OVER';
  const again: ButtonSpec = { id: 'play-again', label: 'PLAY AGAIN', onTap: actions.playAgain };
  const menu: ButtonSpec = { id: 'menu', label: 'MAIN MENU', onTap: actions.toMenu };
  const scores: ButtonSpec = { id: 'scores', label: 'HIGH SCORES', onTap: actions.openScores };
  const signature = (): string => `${flow.version}|${ctx.inputMode.isTouch}`;

  // The name field exists only while it can be edited; every other state hides it (and with it the phone keyboard).
  if (state.kind !== 'ready') ctx.input.hide();

  switch (state.kind) {
    case 'ready': {
      heading(kit, title);
      scoreBlock(kit, ctx);
      new MenuField(kit, { id: 'nickname', name: 'NICKNAME', rect: FIELD, input: ctx.input });
      const hint = kit.text(CENTER_X, 312, '', { size: TEXT.hint, originX: 0.5, originY: 0.5, color: COLORS.dim, bold: false });
      // Feedback follows the typing without rebuilding the page (a rebuild would drop the keyboard). A server complaint about the name
      // stays until the player changes it.
      let typed: string | null = null;
      let serverError: string | null = state.nicknameError;
      kit.onFrame(() => {
        const now = ctx.input.value;
        if (typed !== null && now !== typed) serverError = null;
        if (now === typed) return;
        typed = now;
        const problem = serverError ?? nicknameFeedback(now);
        hint.setText(problem ?? NICKNAME_HELP).setColor(problem ? '#ff9696' : COLORS.dim);
        ctx.input.setInvalid(problem !== null);
        if (problem) ctx.input.announce(problem);
      });
      const top = 340;
      const submit = (): void => void flow.submit(ctx.input.value);
      new MenuButton(kit, { id: 'submit', rect: { x: CENTER_X - 300, y: top, w: 392, h: MIN_TARGET }, label: 'SUBMIT SCORE', primary: true, onTap: submit, size: 30, hint: ctx.inputMode.isTouch ? undefined : 'ENTER' });
      new MenuButton(kit, { id: 'skip', rect: { x: CENTER_X + 108, y: top, w: 192, h: MIN_TARGET }, label: 'SKIP', onTap: () => flow.skip(), size: 30 });
      return { defaultFocus: 'nickname', signature };
    }

    case 'uploading':
    case 'verifying': {
      heading(kit, title);
      scoreBlock(kit, ctx);
      const trying = state.kind === 'uploading' && state.attempt > 0;
      const line = state.kind === 'verifying' ? 'THE SERVER IS VERIFYING YOUR SCORE...' : trying ? `CONNECTION TROUBLE. TRYING AGAIN (${state.attempt})...` : 'UPLOADING YOUR RUN...';
      const who = flow.sentNickname ?? 'Anonymous';
      message(kit, [[line, COLORS.heading], [`POSTING AS ${who.toUpperCase()}`, COLORS.hint]], 270);
      ctx.input.announce(line);
      return { signature };
    }

    case 'network_error': {
      heading(kit, title);
      scoreBlock(kit, ctx);
      message(kit, [['COULD NOT REACH THE RANKED SERVER.', '#ff9696'], ['YOUR RUN IS SAFE. RETRY SENDS THE SAME SCORE AND NAME.', COLORS.hint]], 260);
      buttonGrid(kit, 360, [{ id: 'retry', label: 'RETRY', primary: true, onTap: () => void flow.retry() }, { id: 'skip', label: 'SKIP', onTap: () => flow.skip() }], 380);
      ctx.input.announce('Could not reach the ranked server. Retry or skip.');
      return { defaultFocus: 'retry', signature };
    }

    case 'accepted': {
      const { score, ranks, replayed } = state;
      heading(kit, 'SCORE VERIFIED!', GOOD, 52);
      kit.text(CENTER_X, 132, formatScore(score.score), { size: 80, originX: 0.5, originY: 0.5 });
      const name = kit.text(CENTER_X, 200, score.nickname, { size: 34, originX: 0.5, originY: 0.5, color: COLORS.player1 }).setPadding(0, 0, 0, 8);
      if (name.width > 700) name.setScale(700 / name.width);
      const rankLines: string[] = [];
      if (ranks.weekly) rankLines.push(`WEEKLY RANK  #${ranks.weekly}`);
      if (ranks.allTime) rankLines.push(`ALL-TIME RANK  #${ranks.allTime}`);
      if (rankLines.length === 0) {
        kit.text(CENTER_X, 270, 'RECORDED. SCORES OF ZERO ARE NOT LISTED.', { size: TEXT.body, originX: 0.5, originY: 0.5, color: COLORS.hint });
      } else {
        kit.text(CENTER_X, 262, rankLines[0]!, { size: 40, originX: 0.5, originY: 0.5, color: COLORS.heading });
        if (rankLines[1]) kit.text(CENTER_X, 306, rankLines[1], { size: 28, originX: 0.5, originY: 0.5, color: COLORS.hint });
      }
      const best = ctx.priorBest === null || score.score > ctx.priorBest;
      kit.text(CENTER_X, 350, best ? 'NEW PERSONAL BEST!' : `YOUR BEST: ${formatScore(ctx.priorBest ?? 0)}`, { size: TEXT.small + 2, originX: 0.5, originY: 0.5, color: best ? GOOD : COLORS.hint });
      const note = replayed ? 'THIS SCORE WAS ALREADY RECORDED.' : score.endReason === 'time_limit' || timed ? `YOU SURVIVED THE FULL ${ctx.timeLimitLabel}!` : '';
      if (note) kit.text(CENTER_X, 384, note, { size: TEXT.hint + 2, originX: 0.5, originY: 0.5, color: COLORS.dim });
      buttonGrid(kit, 420, [{ ...scores, label: 'VIEW HIGH SCORES', primary: true }, again, menu]);
      ctx.input.announce(`Score verified. ${formatScore(score.score)} points.${ranks.weekly ? ` Weekly rank ${ranks.weekly}.` : ''}${ranks.allTime ? ` All-time rank ${ranks.allTime}.` : ''}`);
      return { defaultFocus: 'scores', signature };
    }

    case 'rejected': {
      heading(kit, 'SCORE NOT VERIFIED', BAD);
      scoreBlock(kit, ctx);
      message(kit, [['THE SERVER COULD NOT CONFIRM THIS RUN,', '#ff9696'], ['SO IT WAS NOT ADDED TO THE LEADERBOARD.', '#ff9696'], [reasonText(state.reason), COLORS.dim]], 250);
      buttonGrid(kit, 420, [{ ...again, primary: true }, menu]);
      ctx.input.announce('Score not verified. It was not added to the leaderboard.');
      return { defaultFocus: 'play-again', signature };
    }

    case 'expired': {
      heading(kit, 'RANKED RUN EXPIRED', WARN);
      scoreBlock(kit, ctx);
      message(kit, [['THE SERVER NO LONGER ACCEPTS THIS RUN.', WARN], ['THIS SCORE WILL NOT APPEAR ON THE LEADERBOARD.', COLORS.hint], ['LONG PAUSES CAN USE UP THE TIME A RUN IS VALID FOR.', COLORS.dim]], 250);
      buttonGrid(kit, 420, [{ ...again, primary: true }, menu]);
      ctx.input.announce('Ranked run expired. This score will not appear on the leaderboard.');
      return { defaultFocus: 'play-again', signature };
    }

    case 'duplicate': {
      heading(kit, 'ALREADY SUBMITTED');
      scoreBlock(kit, ctx);
      message(kit, [['THIS RUN IS ALREADY ON THE LEADERBOARD,', COLORS.heading], ['UNDER THE NAME SENT WITH IT THE FIRST TIME.', COLORS.hint]], 255);
      buttonGrid(kit, 400, [{ ...scores, primary: true }, again, menu]);
      return { defaultFocus: 'scores', signature };
    }

    case 'refused':
    case 'unavailable': {
      heading(kit, state.kind === 'refused' ? 'SCORE NOT ACCEPTED' : title, state.kind === 'refused' ? BAD : COLORS.white);
      scoreBlock(kit, ctx);
      message(kit, [[state.message.toUpperCase(), state.kind === 'refused' ? '#ff9696' : COLORS.hint]], 260);
      buttonGrid(kit, 420, [{ ...again, primary: true }, menu]);
      return { defaultFocus: 'play-again', signature };
    }

    case 'skipped': {
      heading(kit, title);
      scoreBlock(kit, ctx);
      message(kit, [['SCORE NOT SUBMITTED.', COLORS.dim]], 262);
      buttonGrid(kit, 330, [{ ...again, primary: true }, scores, menu]);
      return { defaultFocus: 'play-again', signature };
    }
  }
}
