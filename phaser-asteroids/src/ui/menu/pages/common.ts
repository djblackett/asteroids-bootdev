import { SCREEN_WIDTH } from '../../../core/constants';
import { COLORS } from '../../text';
import type { MenuContext } from '../context';
import { MenuButton, MIN_TARGET, TEXT, type PageKit } from '../widgets';

/** The layout every sub-page shares: a title, rows of `MIN_TARGET` height, and BACK at the bottom. */
export const CENTER_X = SCREEN_WIDTH / 2;
export const TITLE_Y = 54;
export const ROW_STEP = MIN_TARGET + 12;
export const ROW0 = 118;
export const rowY = (index: number): number => ROW0 + index * ROW_STEP;
export const BACK_Y = 596;

export function pageTitle(kit: PageKit, text: string): void {
  kit.text(CENTER_X, TITLE_Y, text, { size: TEXT.title, originX: 0.5, originY: 0.5 });
}

/** The BACK button every sub-page ends with. `onBack` is what Escape / B do too. */
export function backButton(kit: PageKit, onBack: () => void): MenuButton {
  return new MenuButton(kit, { id: 'back', rect: { x: CENTER_X - 190, y: BACK_Y, w: 380, h: MIN_TARGET }, label: 'BACK', onTap: onBack, size: 34 });
}

/** A dim one-line hint (the keys that work here) along the bottom, for people with a keyboard; a phone does not need it. */
export function keyHint(kit: PageKit, ctx: Pick<MenuContext, 'inputMode'>, text: string): void {
  if (ctx.inputMode.isTouch) return;
  kit.text(CENTER_X, 702, text, { size: TEXT.hint, originX: 0.5, originY: 0.5, color: COLORS.dim, bold: false });
}
