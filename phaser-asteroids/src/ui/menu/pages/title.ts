import { POWERUP_RADIUS } from '../../../core/constants';
import { SOLO_KEYS, P1_KEYS, P2_KEY_LAYOUTS } from '../../../input/keyboardControls';
import { drawPowerUpIcon } from '../../../render/powerupIcons';
import { COLORS } from '../../text';
import { PAD_ROWS, keyboardRows, touchRows, SYSTEM_KEYS_LINE, type HelpRow } from '../controlHelp';
import type { MenuContext, PageNav } from '../context';
import type { PageDef } from '../menuView';
import { legendFor } from '../powerupInfo';
import { iconClock, MenuButton, MenuChoice, MIN_TARGET, TEXT, type PageKit } from '../widgets';
import { coopActions, speedLabel } from './coop';
import { CENTER_X } from './common';
import { drawHelpRows, drawTouchRows } from './reference';

/** The title screen's regions, in game px (1280 x 720). The header is kept clear for the Fullscreen pill the DOM draws top right on a phone. */
const HEADER_Y = 52;
const BAND_TOP = 112;
const BAND_BOTTOM = 444;
const LEFT_X = 40;
const LEFT_W = 580;
const RIGHT_X = 680;
const RIGHT_W = 560;
const LEGEND = { x: 40, y: 482, w: 1200, h: 224 };

const HELP_TOP = 160;
const HELP_STEP = 56;

/**
 * The title screen: what the game is called, one big PLAY, how to steer the ship, what the pick-ups do, and quiet doors to AUDIO and
 * CONTROLS. Everything that is a setting lives behind those two buttons; nothing is repeated here. The reference on the left is the
 * controls that are active right now (touch buttons, the keys, or a controller once one is assigned), the legend below is a
 * tappable card that opens the full power-up guide.
 */
export function buildTitlePage(kit: PageKit, ctx: MenuContext, nav: PageNav): PageDef {
  const touch = ctx.inputMode.isTouch;
  const setup = ctx.setup();
  const count = setup.game.playerCount;
  const g = kit.graphics();

  kit.text(CENTER_X, HEADER_Y, 'ASTEROIDS', { size: 64, originX: 0.5, originY: 0.5 });

  // A device that can touch but is in keyboard mode: the way back is up in the corner, large and green, on the first screen.
  const recover = !touch && ctx.inputMode.canToggle;
  if (recover) {
    new MenuButton(kit, {
      id: 'touch-on',
      rect: { x: 900, y: 8, w: 340, h: 96 },
      label: 'TOUCH CONTROLS: OFF\nTAP TO TURN ON',
      primary: true,
      onTap: () => ctx.actions.switchInputMode(),
      size: 24,
    });
  }

  buildHowToPlay(kit, g, ctx, count);

  // A controller that has been found but not given to a player says so, in the corner, until it joins (A) or is assigned (LB / RB).
  if (ctx.pads.status(count).some((s) => s.kind === 'unassigned')) {
    kit.text(LEFT_X, 30, 'CONTROLLER FOUND\nPRESS A TO JOIN', { size: TEXT.hint + 2, originX: 0, originY: 0.5, color: COLORS.heading });
  }

  // --- the right column: PLAY, the player count, AUDIO / CONTROLS --------------------------------------------------------
  const playH = touch ? 150 : 120;
  const switchH = touch ? 0 : MIN_TARGET + 16;
  const block = playH + switchH + 16 + MIN_TARGET;
  let y = BAND_TOP + Math.max(0, (BAND_BOTTOM - BAND_TOP - block) / 2);
  // On a phone with no touch controls, PLAY would start a game nobody can steer; it says so, and the green button above is the way out.
  const keyboardOnPhone = recover && ctx.inputMode.env.coarsePrimaryPointer;
  new MenuButton(kit, {
    id: 'play',
    rect: { x: RIGHT_X, y, w: RIGHT_W, h: playH },
    label: keyboardOnPhone ? 'PLAY WITH KEYBOARD' : 'PLAY',
    primary: !keyboardOnPhone,
    keysOnly: keyboardOnPhone,
    onTap: () => ctx.actions.play(),
    size: keyboardOnPhone ? 30 : 64,
    ...(touch ? {} : { hint: keyboardOnPhone ? 'PRESS SPACE ON A KEYBOARD' : 'SPACE' }),
  });
  y += playH + 16;

  if (!touch) {
    new MenuChoice(kit, {
      id: 'players',
      label: 'PLAYERS',
      y,
      frame: { x: RIGHT_X, y, w: RIGHT_W, h: MIN_TARGET },
      options: ['1 PLAYER', '2 PLAYERS'],
      selected: () => (ctx.setup().game.playerCount === 2 ? 1 : 0),
      onSelect: (index) => ctx.setPlayers(index === 1 ? 2 : 1),
      size: 28,
    });
    y += MIN_TARGET + 16;
  } else {
    y += 8;
  }

  const buttons: Array<[string, string, () => void]> = [
    ['audio', 'AUDIO', () => nav.open('audio')],
    ['controls', 'CONTROLS', () => nav.open('controls')],
    ...(count === 2 ? ([['coop', 'CO-OP', () => nav.open('coop')]] as Array<[string, string, () => void]>) : []),
  ];
  const gap = 16;
  const bw = (RIGHT_W - gap * (buttons.length - 1)) / buttons.length;
  buttons.forEach(([id, label, open], i) => {
    new MenuButton(kit, { id, rect: { x: RIGHT_X + i * (bw + gap), y, w: bw, h: MIN_TARGET }, label, onTap: open, size: 28 });
  });

  buildLegend(kit, ctx, count, nav);

  const hotkeys: Record<string, () => void> = { Space: () => ctx.actions.play() };
  if (!touch) {
    hotkeys.KeyC = () => nav.open('padlayout');
    const firstPad = ctx.pads.pads()[0];
    if (firstPad) hotkeys.KeyG = () => ctx.pads.cycle(firstPad.key, count);
    hotkeys.Digit1 = () => ctx.setPlayers(1);
    hotkeys.Numpad1 = () => ctx.setPlayers(1);
    hotkeys.Digit2 = () => ctx.setPlayers(2);
    hotkeys.Numpad2 = () => ctx.setPlayers(2);
    if (count === 2) {
      // The keys that have always changed the co-op rules from the title screen; the summary under the keys shows the result.
      const coop = coopActions(ctx);
      hotkeys.KeyL = coop.toggleLives;
      hotkeys.KeyF = coop.toggleFire;
      hotkeys.KeyK = coop.toggleP2Keys;
      hotkeys.KeyS = () => coop.cycleSpeed(0);
      hotkeys.KeyD = () => coop.cycleSpeed(1);
    }
  }
  return {
    hotkeys,
    defaultFocus: 'play',
    signature: () => {
      const s = ctx.setup();
      return `${ctx.inputMode.mode}|${s.game.playerCount}|${s.p2Keys}|${s.game.livesMode}|${s.game.friendlyFire}|${s.game.speed.join(",")}|${ctx.steering.mode}|${ctx.pads.status(s.game.playerCount).map((p) => p.text).join('|')}`;
    },
  };
}

// --- how to play -------------------------------------------------------------------------------------------------------------

function buildHowToPlay(kit: PageKit, g: ReturnType<PageKit['graphics']>, ctx: MenuContext, count: 1 | 2): void {
  const touch = ctx.inputMode.isTouch;
  if (touch) {
    kit.text(LEFT_X + LEFT_W / 2, BAND_TOP + 22, 'HOW TO PLAY', { size: TEXT.heading, originX: 0.5, originY: 0.5, color: COLORS.heading });
    drawTouchRows(kit, g, LEFT_X + 20, HELP_TOP - 10, touchRows(ctx.steering.mode), HELP_STEP);
    return;
  }

  const setup = ctx.setup();
  const keysFor = (slot: 0 | 1): readonly HelpRow[] => {
    if (count === 1) return keyboardRows(SOLO_KEYS);
    return keyboardRows(slot === 0 ? P1_KEYS : P2_KEY_LAYOUTS[setup.p2Keys]);
  };
  const columnFor = (slot: 0 | 1): { rows: readonly HelpRow[]; usesPad: boolean } => {
    const usesPad = ctx.pads.padFor(slot, count) !== null;
    return { rows: usesPad ? PAD_ROWS : keysFor(slot), usesPad };
  };

  if (count === 1) {
    const { rows, usesPad } = columnFor(0);
    kit.text(LEFT_X + LEFT_W / 2, BAND_TOP + 22, usesPad ? 'HOW TO PLAY  -  CONTROLLER' : 'HOW TO PLAY', { size: TEXT.heading, originX: 0.5, originY: 0.5, color: COLORS.heading });
    drawHelpRows(kit, g, LEFT_X + 30, HELP_TOP - 10, rows, { step: HELP_STEP, size: TEXT.body, compact: false });
    kit.text(LEFT_X + LEFT_W / 2, BAND_BOTTOM + 14, footnote(usesPad), { size: TEXT.hint, originX: 0.5, originY: 0.5, color: COLORS.dim, bold: false });
    return;
  }

  const heading = (x: number, name: string, color: string, usesPad: boolean): void => {
    kit.text(x, BAND_TOP + 22, usesPad ? `${name} + PAD` : name, { size: TEXT.heading - 2, originX: 0, originY: 0.5, color });
  };
  const first = columnFor(0);
  const second = columnFor(1);
  heading(LEFT_X + 10, 'PLAYER 1', COLORS.player1, first.usesPad);
  heading(LEFT_X + 305, 'PLAYER 2', COLORS.player2, second.usesPad);
  drawHelpRows(kit, g, LEFT_X + 10, HELP_TOP - 10, first.rows, { step: HELP_STEP, size: TEXT.small, compact: true });
  drawHelpRows(kit, g, LEFT_X + 305, HELP_TOP - 10, second.rows, { step: HELP_STEP, size: TEXT.small, compact: true });
  const [s1, s2] = setup.game.speed;
  const handicap = s1 !== 1 || s2 !== 1;
  // Short wording when a speed handicap has to fit on the same line.
  const shared = setup.game.livesMode === 'shared';
  const lives = handicap ? (shared ? 'SHARED LIVES' : 'OWN LIVES') : shared ? 'SHARED LIVES (6)' : 'OWN LIVES (3 EACH)';
  const speeds = handicap ? `  SPEED ${Math.round(s1 * 100)}/${speedLabel(s2)}` : '';
  kit.text(LEFT_X + LEFT_W / 2, BAND_BOTTOM + 14, `${lives}  FRIENDLY FIRE ${setup.game.friendlyFire ? 'ON' : 'OFF'}${speeds}`, {
    size: TEXT.hint,
    originX: 0.5,
    originY: 0.5,
    color: COLORS.dim,
    bold: false,
  });
}

/** The small line under a one-player reference: the keys every player has, or the reminder that a controller does not replace the keyboard. */
function footnote(usesPad: boolean): string {
  return usesPad ? 'Keyboard keys also work. See CONTROLS.' : SYSTEM_KEYS_LINE;
}

// --- the power-up legend --------------------------------------------------------------------------------------------------------

function buildLegend(kit: PageKit, ctx: MenuContext, count: 1 | 2, nav: PageNav): void {
  // The card is itself the button: nothing but its frame and focus state are drawn by it, the rest is drawn on top.
  new MenuButton(kit, { id: 'powerups', name: 'POWER-UPS', rect: LEGEND, label: '', onTap: () => nav.open('powerups') });
  const icons = kit.graphics(); // created after the card, so the icons are drawn on top of its frame
  kit.text(LEGEND.x + 28, LEGEND.y + 28, 'POWER-UPS', { size: TEXT.heading, originX: 0, originY: 0.5, color: COLORS.heading });
  kit.text(LEGEND.x + LEGEND.w - 28, LEGEND.y + 28, ctx.inputMode.isTouch ? 'TAP FOR DETAILS  >' : 'DETAILS  >', {
    size: TEXT.small,
    originX: 1,
    originY: 0.5,
    color: COLORS.hint,
  });
  const info = legendFor(count);
  const cell = (LEGEND.w - 40) / info.length;
  info.forEach((p, i) => {
    const cx = LEGEND.x + 20 + cell * i + cell / 2;
    kit.text(cx, LEGEND.y + 142, p.name, { size: TEXT.body - 2, originX: 0.5, originY: 0.5, color: p.color });
    kit.text(cx, LEGEND.y + 180, p.short, { size: TEXT.small, originX: 0.5, originY: 0.5, color: COLORS.hint, bold: false });
  });
  kit.onFrame((now) => {
    icons.clear();
    info.forEach((p, i) => {
      const cx = LEGEND.x + 20 + cell * i + cell / 2;
      drawPowerUpIcon(icons, p.type, cx, LEGEND.y + 92, POWERUP_RADIUS + 3, iconClock(now));
    });
  });
}
