import { COLORS } from '../../text';
import type { MenuContext, PageNav } from '../context';
import type { PageDef } from '../menuView';
import { MenuButton, MIN_TARGET, TEXT, type PageKit } from '../widgets';
import { CENTER_X } from './common';

const W = 520;
const X = CENTER_X - W / 2;

/**
 * The pause menu: RESUME, AUDIO, CONTROLS, RETURN TO MENU. The two sub-pages are the title screen's own (same builders), opened on top of
 * this one, so the paused game is untouched and BACK returns here. Escape / B / BACK on this page itself resume the game. RETURN TO MENU
 * abandons the run, so it takes two presses, on every device: it is the only way out of a run in progress.
 * `padNote` is the red line about a controller that disappeared mid-run.
 */
export function buildPausePage(kit: PageKit, ctx: MenuContext, nav: PageNav, padNote: () => string): PageDef {
  // Lower than the other pages' titles: the game clock sits at the top centre of the (dimmed) playfield behind this page.
  kit.text(CENTER_X, 100, 'PAUSED', { size: 64, originX: 0.5, originY: 0.5 });
  const note = kit.text(CENTER_X, 148, '', { size: TEXT.small, originX: 0.5, originY: 0.5, color: '#ff6464' });
  kit.onFrame(() => {
    const text = padNote();
    if (note.text !== text) note.setText(text);
  });

  new MenuButton(kit, { id: 'resume', rect: { x: X, y: 168, w: W, h: 104 }, label: 'RESUME', primary: true, onTap: () => ctx.actions.resume(), size: 48 });
  new MenuButton(kit, { id: 'audio', rect: { x: X, y: 288, w: W, h: MIN_TARGET }, label: 'AUDIO', onTap: () => nav.open('audio'), size: 32 });
  new MenuButton(kit, { id: 'controls', rect: { x: X, y: 394, w: W, h: MIN_TARGET }, label: 'CONTROLS', onTap: () => nav.open('controls'), size: 32 });
  new MenuButton(kit, {
    id: 'menu',
    rect: { x: X, y: 500, w: W, h: MIN_TARGET },
    label: 'RETURN TO MENU',
    confirm: { armedLabel: 'QUIT THIS RUN?\nPRESS OR TAP AGAIN' },
    onTap: () => ctx.actions.toMenu(),
    size: 32,
  });
  if (!ctx.inputMode.isTouch) {
    // A controller that drives a ship in this run also has START and BACK.
    const count = ctx.setup().game.playerCount;
    const pad = ctx.pads.padFor(0, count) !== null || ctx.pads.padFor(1, count) !== null;
    const hint = pad ? 'P / ESC / START: resume     M: music' : 'P / ESC: resume     M: music';
    kit.text(CENTER_X, 640, hint, { size: TEXT.small, originX: 0.5, originY: 0.5, color: COLORS.dim, bold: false });
  }
  return { defaultFocus: 'resume' };
}
