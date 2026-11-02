import { POWERUP_RADIUS } from '../../../core/constants';
import { drawPowerUpIcon } from '../../../render/powerupIcons';
import { COLORS } from '../../text';
import type { MenuContext, PageNav } from '../context';
import type { PageDef } from '../menuView';
import { POWERUP_INFO } from '../powerupInfo';
import { iconClock, TEXT, type PageKit } from '../widgets';
import { BACK_Y, backButton, pageTitle } from './common';

// The rows share the space between the title and BACK. Seven rows (LIGHTNING made it seven) at the old 74 px pitch ran the last
// description into BACK; the pitch now shrinks to fit, and never grows past what two-line descriptions look right at.
const FIRST_Y = 92;
const LAST_Y = BACK_Y - 16;
const STEP = Math.min(74, Math.floor((LAST_Y - FIRST_Y) / POWERUP_INFO.length));
const ICON_X = 90;
const NAME_X = 160;
const DETAIL_X = 470;

/**
 * POWER-UP GUIDE: every pick-up with its icon, its name in its in-game colour and one plain sentence (the numbers come from the
 * simulation's constants, see `powerupInfo.ts`). Revive is listed too, marked as two-player only, dimmed in a one-player game.
 */
export function buildPowerupGuide(kit: PageKit, ctx: MenuContext, nav: PageNav): PageDef {
  pageTitle(kit, 'POWER-UPS');
  const g = kit.graphics();
  const dimmed = kit.graphics().setAlpha(0.6); // a Graphics has one alpha: the two-player-only icon gets its own
  const coop = ctx.setup().game.playerCount === 2;
  POWERUP_INFO.forEach((info, i) => {
    const cy = FIRST_Y + i * STEP + STEP / 2;
    const unavailable = info.coopOnly && !coop;
    const alpha = unavailable ? 0.6 : 1;
    kit.text(NAME_X, cy, info.name, { size: TEXT.heading - 2, originX: 0, originY: 0.5, color: info.color }).setAlpha(alpha);
    kit
      .text(DETAIL_X, cy, info.detail, { size: TEXT.body - 2, originX: 0, originY: 0.5, color: COLORS.hint, bold: false })
      .setWordWrapWidth(1240 - DETAIL_X)
      .setAlpha(alpha);
  });
  kit.onFrame((now) => {
    g.clear();
    dimmed.clear();
    POWERUP_INFO.forEach((info, i) => {
      const cy = FIRST_Y + i * STEP + STEP / 2;
      drawPowerUpIcon(info.coopOnly && !coop ? dimmed : g, info.type, ICON_X, cy, POWERUP_RADIUS + 3, iconClock(now));
    });
  });
  backButton(kit, () => nav.back());
  return { defaultFocus: 'back' };
}
