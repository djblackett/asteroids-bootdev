import { P1_KEYS, P2_KEY_LAYOUTS, SOLO_KEYS, keySchemesFor } from '../../../input/keyboardControls';
import type { TestResult } from '../../../haptics/hapticManager';
import { DEFAULT_MOVEMENT, MOVEMENT_LABELS, MOVEMENT_MODES } from '../../../input/movementMode';
import { COLORS } from '../../text';
import { SYSTEM_KEYS_LINE, keyboardRows } from '../controlHelp';
import type { MenuContext, PageNav } from '../context';
import type { PageDef } from '../menuView';
import { MenuButton, MenuChoice, MIN_TARGET, ROW_GAP, TEXT, rowGeometry, type PageKit } from '../widgets';
import { backButton, CENTER_X, pageTitle, rowY } from './common';
import { drawHelpRows } from './reference';

/** The MOVEMENT row sits below the Fullscreen pill in the top right corner (which reaches about y = 110 on the narrowest phones). */
const MOVEMENT_Y = 124;
const TEST_RESULT_MS = 2500;
/** What the button says after a test. It reports what the browser did; it cannot know whether a motor moved, hence the question. */
const TEST_RESULT: Record<TestResult, { text: string; color: string }> = {
  sent: { text: 'SENT - FELT IT?', color: COLORS.heading },
  unsupported: { text: 'NOT SUPPORTED', color: COLORS.dead },
  blocked: { text: 'BLOCKED - TAP AGAIN', color: COLORS.dead },
};

/** The one-line explanation under the haptic switches: the phone's own settings can silence a vibration the browser says it sent. */
export const HAPTIC_HINT = "Nothing buzzing? A silent phone or its vibration settings can block it.";
export const HAPTIC_UNSUPPORTED = 'This browser cannot vibrate.';

/** The text of the page's rebuild signature that depends on what is plugged in. */
const padSignature = (ctx: MenuContext, count: 1 | 2): string => ctx.pads.status(count).map((s) => s.text).join('|');

/**
 * CONTROLS: how the ship is steered, and only what applies to this device. A phone in touch mode sees the movement mode, the haptic
 * switch with TEST VIBRATION, and the safe way out to the keyboard; a keyboard / controller player sees the key map, the controllers
 * and who each one drives. A touch-capable device that is in keyboard mode gets one big way back to touch at the top, always.
 * The page is the same on the title and pause screens, minus what cannot change during a run.
 */
export function buildControlsPage(kit: PageKit, ctx: MenuContext, nav: PageNav): PageDef {
  pageTitle(kit, 'CONTROLS');
  const touch = ctx.inputMode.isTouch;
  const count = ctx.setup().game.playerCount;
  const def = touch ? buildTouchControls(kit, ctx) : buildKeyboardControls(kit, ctx, nav, count);
  backButton(kit, () => nav.back());
  return {
    ...def,
    signature: () => `${ctx.inputMode.mode}|${ctx.setup().game.playerCount}|${ctx.setup().p2Keys}|${padSignature(ctx, ctx.setup().game.playerCount)}`,
  };
}

// --- touch ----------------------------------------------------------------------------------------------------------------

function buildTouchControls(kit: PageKit, ctx: MenuContext): PageDef {
  const { movement, haptics } = ctx;
  // Three modes side by side, the lit one explained underneath. The caption comes from MOVEMENT_LABELS so the page, the tests and the
  // docs cannot disagree about the names.
  new MenuChoice(kit, {
    id: 'movement',
    label: 'MOVEMENT',
    y: MOVEMENT_Y,
    controlW: 930,
    options: MOVEMENT_MODES.map((mode) => MOVEMENT_LABELS[mode].name),
    selected: () => MOVEMENT_MODES.indexOf(movement.mode),
    onSelect: (index) => movement.set(MOVEMENT_MODES[index] ?? DEFAULT_MOVEMENT),
    size: 28,
  });
  const blurb = kit.text(CENTER_X, MOVEMENT_Y + MIN_TARGET + 24, MOVEMENT_LABELS[movement.mode].blurb, {
    size: TEXT.small + 2,
    originX: 0.5,
    originY: 0.5,
    color: COLORS.hint,
    bold: false,
  });
  blurb.setWordWrapWidth(1100).setAlign('center');
  kit.onFrame(() => {
    const text = MOVEMENT_LABELS[movement.mode].blurb;
    if (blurb.text !== text) blurb.setText(text);
  });
  new MenuChoice(kit, {
    id: 'haptics',
    label: 'HAPTIC FEEDBACK',
    y: MOVEMENT_Y + 138,
    options: ['ON', 'OFF'],
    selected: () => (haptics.enabled ? 0 : 1),
    onSelect: (index) => haptics.setEnabled(index === 0),
  });

  let shown: TestResult | null = null;
  let until = 0;
  if (haptics.supported) {
    // Runs inside the tap itself, which is what lets the browser allow the vibration.
    new MenuButton(kit, {
      id: 'test-vibration',
      rect: rowGeometry(MOVEMENT_Y + 238).control,
      label: () => (shown !== null && ctx.now() < until ? TEST_RESULT[shown].text : 'TEST VIBRATION'),
      onTap: () => {
        shown = haptics.testVibration();
        until = ctx.now() + TEST_RESULT_MS;
      },
      size: 28,
    });
  }
  kit.text(CENTER_X, MOVEMENT_Y + 238 + MIN_TARGET + 16, haptics.supported ? HAPTIC_HINT : HAPTIC_UNSUPPORTED, {
    size: TEXT.small,
    originX: 0.5,
    originY: 0.5,
    color: COLORS.dim,
    bold: false,
  });

  if (ctx.where === 'title') {
    // Leaving touch mode hides every on-screen control, so it takes two deliberate taps (see ConfirmTap).
    kit.text(70, MOVEMENT_Y + 360 + MIN_TARGET / 2, 'TOUCH CONTROLS: ON', { size: TEXT.label, originX: 0, originY: 0.5, color: COLORS.hint });
    new MenuButton(kit, {
      id: 'to-keyboard',
      rect: rowGeometry(MOVEMENT_Y + 360).control,
      label: 'SWITCH TO KEYBOARD',
      confirm: { armedLabel: 'TAP AGAIN TO SWITCH\nTO KEYBOARD CONTROLS' },
      onTap: () => ctx.actions.switchInputMode(),
      size: 26,
    });
  }
  return { defaultFocus: 'movement' };
}

// --- keyboard and controller ------------------------------------------------------------------------------------------------

function buildKeyboardControls(kit: PageKit, ctx: MenuContext, nav: PageNav, count: 1 | 2): PageDef {
  const title = ctx.where === 'title';
  const setup = ctx.setup();
  // A device that can touch gets the way back into touch controls first and biggest: it may be a phone that was switched by mistake.
  const banner = title && ctx.inputMode.canToggle;
  if (banner) {
    new MenuButton(kit, {
      id: 'touch-on',
      rect: { x: 40, y: 108, w: 1200, h: 96 },
      label: 'TOUCH CONTROLS ARE OFF - TAP HERE TO TURN THEM ON',
      primary: true,
      onTap: () => ctx.actions.switchInputMode(),
      size: 30,
    });
  }
  const top = banner ? 214 : 112;
  const g = kit.graphics();
  const step = 50;

  // Left: the keys, one column for a solo player, two side by side for co-op.
  if (count === 1) {
    kit.text(60, top + 14, 'KEYBOARD', { size: TEXT.body, originX: 0, originY: 0.5, color: COLORS.heading });
    const end = drawHelpRows(kit, g, 60, top + 34, keyboardRows(SOLO_KEYS), { step, size: TEXT.body - 2, compact: false });
    kit.text(60, end + 16, SYSTEM_KEYS_LINE, { size: TEXT.hint, originX: 0, originY: 0.5, color: COLORS.dim, bold: false });
    if (!banner) kit.text(60, end + 40, 'The arrow keys steer too.', { size: TEXT.hint, originX: 0, originY: 0.5, color: COLORS.dim, bold: false });
  } else {
    const [, second] = keySchemesFor(2, setup.p2Keys);
    const columns: Array<[string, string, readonly ReturnType<typeof keyboardRows>[number][], number]> = [
      ['PLAYER 1', COLORS.player1, keyboardRows(P1_KEYS), 40],
      ['PLAYER 2', COLORS.player2, keyboardRows(second ?? P2_KEY_LAYOUTS.arrows), 330],
    ];
    let end = top;
    for (const [name, color, rows, x] of columns) {
      kit.text(x + 20, top + 14, name, { size: TEXT.body, originX: 0, originY: 0.5, color });
      end = drawHelpRows(kit, g, x + 20, top + 34, rows, { step, size: TEXT.small, compact: true });
    }
    kit.text(60, end + 16, SYSTEM_KEYS_LINE, { size: TEXT.hint, originX: 0, originY: 0.5, color: COLORS.dim, bold: false });
  }

  // Right: the controllers, and what each one drives.
  const x = 680;
  const w = 560;
  kit.text(x, top + 14, 'CONTROLLERS', { size: TEXT.body, originX: 0, originY: 0.5, color: COLORS.heading });
  if (title) kit.text(x + w, top + 14, 'G: change player   C: layout', { size: TEXT.hint, originX: 1, originY: 0.5, color: COLORS.dim, bold: false });
  let y = top + 38;
  const pads = ctx.pads.pads().slice(0, 2);
  if (pads.length === 0) {
    const message = ctx.pads.isSupported ? 'No controller found.\nPress any button on it to connect.' : 'Controllers need https or localhost.';
    kit.text(x, y + 28, message, { size: TEXT.small, originX: 0, originY: 0.5, color: COLORS.dim, bold: false }).setWordWrapWidth(w);
    y += 66;
  }
  pads.forEach((pad, i) => {
    const slot = ctx.pads.playerOf(pad.key, count);
    const who = slot === null ? 'NOT ASSIGNED' : `PLAYER ${slot + 1}`;
    new MenuButton(kit, {
      id: `pad-${i}`,
      rect: { x, y, w, h: MIN_TARGET },
      label: `CONTROLLER ${pad.index + 1}: ${who}\n${pad.name}${pad.layout === 'generic' ? ' (non-standard layout)' : ''}`,
      onTap: () => ctx.pads.cycle(pad.key, count),
      enabled: () => title, // who a controller drives is chosen before a run, not during it
      size: 24,
    });
    y += MIN_TARGET + ROW_GAP;
  });
  for (const lost of ctx.pads.status(count).filter((s) => s.kind === 'disconnected')) {
    kit.text(x, y + 14, lost.text, { size: TEXT.hint, originX: 0, originY: 0.5, color: '#ff6464', bold: false }).setWordWrapWidth(w);
    y += 34;
  }
  new MenuButton(kit, { id: 'pad-layout', rect: { x, y, w, h: MIN_TARGET }, label: 'CONTROLLER LAYOUT', onTap: () => nav.open('padlayout'), size: 28 });

  const hotkeys: Record<string, () => void> = { KeyC: () => nav.open('padlayout') };
  if (title) {
    const first = pads[0];
    if (first) hotkeys.KeyG = () => ctx.pads.cycle(first.key, count);
  }
  if (title && count === 2) {
    const keysY = banner ? 498 : rowY(3) + 4;
    new MenuChoice(kit, {
      id: 'p2-keys',
      label: 'PLAYER 2 KEYS  [K]',
      y: keysY,
      options: ['ARROWS + ENTER', 'I J K L + ;'],
      selected: () => (ctx.setup().p2Keys === 'arrows' ? 0 : 1),
      onSelect: (index) => ctx.patchSetup((s) => ({ ...s, p2Keys: index === 0 ? 'arrows' : 'ijkl' })),
      size: 26,
    });
    hotkeys.KeyK = () => ctx.patchSetup((s) => ({ ...s, p2Keys: s.p2Keys === 'arrows' ? 'ijkl' : 'arrows' }));
  }
  return { hotkeys, defaultFocus: banner ? 'touch-on' : pads.length > 0 ? 'pad-0' : 'pad-layout' };
}
