import type { PersonalBest } from '../../../ranked/personalBest';
import { formatEraScore, formatScore, weekLabel, BOARD_PAGE_SIZE, type ScoresModel } from '../../../ranked/scoresModel';
import { scoringEra } from '../../../ranked/scoringEras';
import { COLORS } from '../../text';
import type { MenuContext, PageNav } from '../context';
import type { PageDef } from '../menuView';
import { MenuButton, MenuChoice, MIN_TARGET, PALETTE, TEXT, type PageKit } from '../widgets';
import { CENTER_X, keyHint } from './common';

/** What the High Scores page needs from its scene: the model it draws, and what this device remembers. */
export interface ScoresContext {
  readonly inputMode: MenuContext['inputMode'];
  readonly model: ScoresModel;
  /** Public ids of the scores this device had accepted: a matching row is marked. An id is not proof of anything; this is a convenience. */
  highlightIds(): ReadonlySet<string>;
  best(): PersonalBest | null;
}

const TABLE_TOP = 214;
const ROW_STEP = 34;
const RANK_X = 236;
const NAME_X = 276;
const NAME_MAX_W = 470;
const SCORE_X = 1010;
const ERA_X = 1032;
const TAG_X = 1090;
const FOOT_Y = 548;
const NAV_Y = 596;
const NAV_W = 280;
const NAV_GAP = 16;

/**
 * HIGH SCORES: This Week / All Time, ten entries per screen, Previous / Next. Everything on it comes from the server's public
 * leaderboard (the week's dates included: the browser never works out a week itself). The model owns loading and paging; this page is
 * rebuilt whenever it changes. Nicknames are drawn as plain canvas text.
 */
export function buildScoresPage(kit: PageKit, ctx: ScoresContext, nav: PageNav): PageDef {
  const { model } = ctx;
  const touch = ctx.inputMode.isTouch;
  // Smaller and higher than the other pages' titles: ten rows, the board tabs and the paging buttons all have to fit one screen.
  kit.text(CENTER_X, 36, 'HIGH SCORES', { size: 44, originX: 0.5, originY: 0.5 });

  new MenuChoice(kit, {
    id: 'scope',
    label: 'BOARD',
    y: 70,
    frame: { x: CENTER_X - 300, y: 72, w: 600, h: MIN_TARGET },
    options: ['THIS WEEK', 'ALL TIME'],
    selected: () => (model.scope === 'weekly' ? 0 : 1),
    onSelect: (index) => void model.setScope(index === 0 ? 'weekly' : 'all-time'),
    size: 30,
  });

  const week = model.scope === 'weekly' && model.page ? weekLabel(model.page) : null;
  const caption = model.scope === 'weekly' ? (week ? `WEEK OF ${week}  (ATLANTIC TIME)` : 'THIS WEEK') : 'SCORES FROM DIFFERENT VERSIONS MAY NOT BE DIRECTLY COMPARABLE.';
  kit.text(CENTER_X, 184, caption, { size: TEXT.hint, originX: 0.5, originY: 0.5, color: COLORS.dim, bold: false });

  drawBody(kit, ctx);

  const { status } = model;
  if (status === 'ready' || status === 'empty') {
    const shown = status === 'ready' ? `PAGE ${model.pageNumber} / ${model.pageCount}` : '';
    kit.text(CENTER_X, FOOT_Y, shown, { size: TEXT.small, originX: 0.5, originY: 0.5, color: COLORS.hint });
  }
  const best = ctx.best();
  if (best) {
    const who = best.best.nickname ? `  (${best.best.nickname})` : '';
    const bestLabel = kit.text(CENTER_X, FOOT_Y + 28, `YOUR BEST VERIFIED SCORE: ${formatEraScore(best.best.score, best.best.rulesVersion)}${who}`, { size: TEXT.hint + 2, originX: 0.5, originY: 0.5, color: COLORS.heading });
    if (bestLabel.width > 1120) bestLabel.setScale(1120 / bestLabel.width);
  }

  const x0 = CENTER_X - (NAV_W * 3 + NAV_GAP * 2) / 2;
  const slot = (i: number) => ({ x: x0 + i * (NAV_W + NAV_GAP), y: NAV_Y, w: NAV_W, h: MIN_TARGET });
  if (status === 'error') {
    new MenuButton(kit, { id: 'retry', rect: slot(0), label: 'TRY AGAIN', onTap: () => void model.load(), size: 28, primary: true });
  } else {
    new MenuButton(kit, { id: 'prev', rect: slot(0), label: '< PREVIOUS', onTap: () => void model.prev(), enabled: () => model.canPrev, size: 28 });
  }
  new MenuButton(kit, { id: 'back', rect: slot(1), label: 'BACK', onTap: () => nav.back(), size: 30 });
  new MenuButton(kit, { id: 'next', rect: slot(2), label: 'NEXT >', onTap: () => void model.next(), enabled: () => model.canNext, size: 28 });

  keyHint(kit, ctx, 'LEFT / RIGHT: THIS WEEK / ALL TIME     UP / DOWN: CHOOSE     ESC: BACK');
  return {
    defaultFocus: 'back',
    signature: () => `${model.version}|${touch}|${ctx.highlightIds().size}|${ctx.best()?.best.id ?? ''}|${ctx.best()?.best.rulesVersion ?? ''}`,
  };
}

function drawBody(kit: PageKit, ctx: ScoresContext): void {
  const { model } = ctx;
  const middle = TABLE_TOP + (ROW_STEP * BOARD_PAGE_SIZE) / 2 - 10;
  const message = (lines: string[], color: string): void => {
    lines.forEach((line, i) => kit.text(CENTER_X, middle - 20 + i * 42, line, { size: TEXT.body, originX: 0.5, originY: 0.5, color }));
  };
  switch (model.status) {
    case 'loading':
      return message(['LOADING...'], COLORS.hint);
    case 'unavailable':
      return message(['HIGH SCORES ARE NOT AVAILABLE YET.', 'YOU CAN STILL PLAY NORMALLY.'], COLORS.hint);
    case 'error':
      return message(['COULD NOT REACH THE HIGH SCORES.', 'CHECK YOUR CONNECTION AND TRY AGAIN.'], '#ff9696');
    case 'empty':
      return message(['NO RANKED SCORES YET.', 'BE THE FIRST!'], COLORS.heading);
    case 'ready':
      break;
  }

  const entries = model.page?.entries ?? [];
  const mine = ctx.highlightIds();
  const g = kit.graphics();
  entries.forEach((entry, i) => {
    const y = TABLE_TOP + i * ROW_STEP;
    const isMine = mine.has(entry.id);
    if (isMine) {
      g.fillStyle(PALETTE.gold, 0.16);
      g.fillRect(RANK_X - 70, y - ROW_STEP / 2 + 2, SCORE_X - RANK_X + 220, ROW_STEP - 4);
    }
    const color = isMine ? COLORS.heading : entry.rank <= 3 ? COLORS.white : COLORS.hint;
    kit.text(RANK_X, y, `#${entry.rank}`, { size: TEXT.body, originX: 1, originY: 0.5, color });
    const name = kit.text(NAME_X, y, entry.nickname, { size: TEXT.body, originX: 0, originY: 0.5, color }).setPadding(0, 0, 0, 6); // room for an underscore's tail
    if (name.width > NAME_MAX_W) name.setScale(NAME_MAX_W / name.width);
    kit.text(SCORE_X, y, formatScore(entry.score), { size: TEXT.body, originX: 1, originY: 0.5, color });
    kit.text(ERA_X, y, scoringEra(entry.rulesVersion) ?? '?', { size: TEXT.hint, originX: 0, originY: 0.5, color: COLORS.dim });
    if (isMine) kit.text(TAG_X, y, 'YOU', { size: TEXT.hint, originX: 0, originY: 0.5, color: COLORS.heading });
  });
}
