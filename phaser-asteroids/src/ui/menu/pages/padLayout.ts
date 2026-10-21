import { PAD_MAPPING_LINES, PAD_MENU_LINES } from '../../../input/gamepadMapping';
import { COLORS } from '../../text';
import type { MenuContext, PageNav } from '../context';
import type { PageDef } from '../menuView';
import { TEXT, type PageKit } from '../widgets';
import { backButton, CENTER_X, pageTitle } from './common';

/** CONTROLLER LAYOUT: what every control of a gamepad does, and how to give a controller to a player (text from `gamepadMapping.ts`). */
export function buildPadLayoutPage(kit: PageKit, _ctx: MenuContext, nav: PageNav): PageDef {
  pageTitle(kit, 'CONTROLLER LAYOUT');
  PAD_MAPPING_LINES.forEach((line, i) => {
    kit.text(CENTER_X, 126 + i * 34, line, { size: TEXT.small, originX: 0.5, originY: 0.5, color: COLORS.hint, bold: false });
  });
  PAD_MENU_LINES.forEach((line, i) => {
    kit.text(CENTER_X, 126 + PAD_MAPPING_LINES.length * 34 + 22 + i * 32, line, {
      size: TEXT.small,
      originX: 0.5,
      originY: 0.5,
      color: i === 0 ? COLORS.dim : COLORS.white,
      bold: false,
    });
  });
  backButton(kit, () => nav.back());
  return { defaultFocus: 'back' };
}
