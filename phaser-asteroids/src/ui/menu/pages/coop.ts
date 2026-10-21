import { SPEED_OPTIONS } from '../../../core/constants';
import type { MenuContext, PageNav } from '../context';
import type { PageDef } from '../menuView';
import { MenuChoice, MenuStepper, type PageKit } from '../widgets';
import { backButton, keyHint, pageTitle, rowY } from './common';

export const speedLabel = (speed: number): string => `${Math.round(speed * 100)}%`;

/** The next speed in `SPEED_OPTIONS`, wrapping (the hotkeys) or stopping at the ends (the - / + buttons). */
export function stepSpeed(current: number, direction: 1 | -1, wrap: boolean): number {
  const at = Math.max(0, SPEED_OPTIONS.indexOf(current));
  const next = wrap ? (at + direction + SPEED_OPTIONS.length) % SPEED_OPTIONS.length : Math.min(SPEED_OPTIONS.length - 1, Math.max(0, at + direction));
  return SPEED_OPTIONS[next] ?? 1;
}

/**
 * The two-player options as actions on the title screen's choices. L, F, K, S and D have always changed them from the title
 * screen, so the title page (while two players are chosen) and the pages that show them both route those keys here.
 */
export function coopActions(ctx: MenuContext): {
  toggleLives(): void;
  toggleFire(): void;
  toggleP2Keys(): void;
  cycleSpeed(player: 0 | 1): void;
} {
  const setSpeed = (player: 0 | 1, change: (current: number) => number): void =>
    ctx.patchSetup((s) => {
      const speed: [number, number] = [s.game.speed[0], s.game.speed[1]];
      speed[player] = change(speed[player]);
      return { ...s, game: { ...s.game, speed } };
    });
  return {
    toggleLives: () => ctx.patchSetup((s) => ({ ...s, game: { ...s.game, livesMode: s.game.livesMode === 'shared' ? 'independent' : 'shared' } })),
    toggleFire: () => ctx.patchSetup((s) => ({ ...s, game: { ...s.game, friendlyFire: !s.game.friendlyFire } })),
    toggleP2Keys: () => ctx.patchSetup((s) => ({ ...s, p2Keys: s.p2Keys === 'arrows' ? 'ijkl' : 'arrows' })),
    cycleSpeed: (player) => setSpeed(player, (v) => stepSpeed(v, 1, true)),
  };
}

/**
 * TWO-PLAYER OPTIONS: how a co-op game is played (shared or separate lives, friendly fire, each player's speed handicap). These are rules,
 * not controls or audio, so they have a page of their own that only exists while two players are chosen. L, F, S and D still work here.
 */
export function buildCoopPage(kit: PageKit, ctx: MenuContext, nav: PageNav): PageDef {
  pageTitle(kit, 'TWO-PLAYER OPTIONS');
  const game = () => ctx.setup().game;
  const actions = coopActions(ctx);
  const setSpeed = (player: 0 | 1, change: (current: number) => number): void =>
    ctx.patchSetup((s) => {
      const speed: [number, number] = [s.game.speed[0], s.game.speed[1]];
      speed[player] = change(speed[player]);
      return { ...s, game: { ...s.game, speed } };
    });

  new MenuChoice(kit, {
    id: 'lives',
    label: 'LIVES  [L]',
    y: rowY(0),
    options: ['SHARED (6 TOTAL)', 'INDEPENDENT (3 EACH)'],
    selected: () => (game().livesMode === 'shared' ? 0 : 1),
    onSelect: (index) => ctx.patchSetup((s) => ({ ...s, game: { ...s.game, livesMode: index === 0 ? 'shared' : 'independent' } })),
    controlW: 820,
    size: 26,
  });
  new MenuChoice(kit, {
    id: 'friendly-fire',
    label: 'FRIENDLY FIRE  [F]',
    y: rowY(1),
    options: ['OFF', 'ON'],
    selected: () => (game().friendlyFire ? 1 : 0),
    onSelect: (index) => ctx.patchSetup((s) => ({ ...s, game: { ...s.game, friendlyFire: index === 1 } })),
    controlW: 820,
  });
  new MenuStepper(kit, {
    id: 'speed-1',
    label: 'PLAYER 1 SPEED  [S]',
    y: rowY(2),
    value: () => speedLabel(game().speed[0]),
    onAdjust: (direction) => setSpeed(0, (v) => stepSpeed(v, direction, false)),
    controlW: 820,
  });
  new MenuStepper(kit, {
    id: 'speed-2',
    label: 'PLAYER 2 SPEED  [D]',
    y: rowY(3),
    value: () => speedLabel(game().speed[1]),
    onAdjust: (direction) => setSpeed(1, (v) => stepSpeed(v, direction, false)),
    controlW: 820,
  });
  backButton(kit, () => nav.back());
  keyHint(kit, ctx, 'UP / DOWN: choose     LEFT / RIGHT: change     ESC: back');
  return {
    defaultFocus: 'lives',
    hotkeys: {
      KeyL: actions.toggleLives,
      KeyF: actions.toggleFire,
      KeyS: () => actions.cycleSpeed(0),
      KeyD: () => actions.cycleSpeed(1),
    },
  };
}
