import { describe, expect, it } from 'vitest';
import {
  MEGA_POWER_DURATION,
  MULTI_SHOT_DURATION,
  RAPID_FIRE_DURATION,
  REVIVE_LIVES,
  SLOW_MOTION_DURATION,
  SLOW_MOTION_FACTOR,
  SPEED_OPTIONS,
} from '../src/core/constants';
import type { PowerUpType } from '../src/core/powerup';
import { padToInput, type GamepadSnapshot } from '../src/input/gamepadMapping';
import { P1_KEYS, P2_KEYS_ARROWS, P2_KEYS_IJKL, SOLO_KEYS, schemeCodes, type KeyScheme } from '../src/input/keyboardControls';
import { POWERUP_COLOR } from '../src/render/powerupIcons';
import { capFor, keyboardRows, PAD_ROWS, touchRows } from '../src/ui/menu/controlHelp';
import { stepSpeed } from '../src/ui/menu/pages/coop';
import { legendFor, POWERUP_INFO, SHORT_MAX } from '../src/ui/menu/powerupInfo';

describe('power-up text', () => {
  const info = (type: PowerUpType) => POWERUP_INFO.find((p) => p.type === type)!;

  it('covers the six one-player power-ups and Revive, each once', () => {
    expect(POWERUP_INFO.map((p) => p.type)).toEqual(['rapid_fire', 'multi_shot', 'shield', 'slow_motion', 'chain_lightning', 'mega_power', 'revive']);
    expect(POWERUP_INFO.filter((p) => p.coopOnly).map((p) => p.type)).toEqual(['revive']);
  });

  it('takes every number from the simulation constants', () => {
    expect(info('rapid_fire').detail).toContain(`${RAPID_FIRE_DURATION} seconds`);
    expect(info('rapid_fire').detail).toContain('3x'); // 0.3 s between shots down to 0.1 s
    expect(info('multi_shot').detail).toContain(`${MULTI_SHOT_DURATION} seconds`);
    expect(info('multi_shot').detail).toContain('3 bullets');
    expect(info('slow_motion').detail).toContain(`${Math.round(SLOW_MOTION_FACTOR * 100)}%`);
    expect(info('slow_motion').detail).toContain(`${SLOW_MOTION_DURATION} seconds`);
    expect(info('mega_power').detail).toContain(`${MEGA_POWER_DURATION} seconds`);
    expect(info('revive').detail).toContain(`${REVIVE_LIVES} lives`);
  });

  it('says what the two easily misreported ones really do', () => {
    // Slow Motion slows the asteroids only (not the ship, not the UFOs); the guide must not say it slows "everything".
    expect(info('slow_motion').detail).toMatch(/^Asteroids move at/);
    expect(info('slow_motion').short.toLowerCase()).toContain('asteroids');
    // MEGA POWER is the other four together; the shield outlasts the timer.
    for (const part of ['Rapid Fire', 'Multi-Shot', 'Shield', 'Slow Motion']) expect(info('mega_power').detail).toContain(part);
    expect(info('mega_power').detail).toContain('shield stays');
    // The shield has no timer.
    expect(info('shield').detail).not.toMatch(/second/);
    expect(info('revive').detail.toLowerCase()).toContain('two-player');
  });

  it('uses the colour each pick-up is drawn in', () => {
    for (const p of POWERUP_INFO) expect(p.color).toBe(`#${POWERUP_COLOR[p.type].toString(16).padStart(6, '0')}`);
  });

  it('keeps the legend words short enough for their cell, in a one- and a two-player legend', () => {
    // Courier is 0.6 em wide: the names are drawn at 24 px (14.4 px a character), the short lines at 22 px (13.2 px).
    for (const players of [1, 2] as const) {
      const list = legendFor(players);
      const cell = (1200 - 40) / list.length;
      for (const p of list) {
        expect(p.short.length).toBeLessThanOrEqual(SHORT_MAX);
        expect(p.short.length * (list.length > 6 ? 10.8 : 13.2)).toBeLessThan(cell - 4);
        expect(p.name.length * (list.length > 6 ? 12 : 14.4)).toBeLessThan(cell - 4);
      }
    }
  });

  it('shows Revive in the legend only for two players', () => {
    expect(legendFor(1).map((p) => p.type)).not.toContain('revive');
    expect(legendFor(1)).toHaveLength(6);
    expect(legendFor(2).map((p) => p.type)).toContain('revive');
  });
});

describe('keyboard reference', () => {
  const caps = (scheme: KeyScheme) => keyboardRows(scheme).map((r) => r.caps);

  it('prints the keys the game really reads for one player', () => {
    expect(caps(SOLO_KEYS)).toEqual([['W', 'S'], ['A', 'D'], ['SPACE'], ['E'], ['SHIFT']]);
  });

  it('prints each two-player scheme, telling the Shift keys apart', () => {
    expect(caps(P1_KEYS)).toEqual([['W', 'S'], ['A', 'D'], ['SPACE'], ['E'], ['L-SHIFT']]);
    expect(caps(P2_KEYS_ARROWS)).toEqual([['↑', '↓'], ['←', '→'], ['ENTER'], ['R-SHIFT'], ['.']]);
    expect(caps(P2_KEYS_IJKL)).toEqual([['I', 'K'], ['J', 'L'], [';'], ['U'], ['O']]);
  });

  it('only ever mentions keys of the scheme it describes', () => {
    // Round trip: every key code of the scheme is explained by some printed cap, and no printed cap is invented.
    for (const scheme of [SOLO_KEYS, P1_KEYS, P2_KEYS_ARROWS, P2_KEYS_IJKL]) {
      const printed = new Set(keyboardRows(scheme).flatMap((r) => r.caps));
      const first = [scheme.forward, scheme.backward, scheme.rotateLeft, scheme.rotateRight, scheme.shoot, scheme.laser, scheme.boost].map((codes) => capFor(codes));
      expect([...printed].sort()).toEqual([...new Set(first)].sort());
      for (const codes of [scheme.forward, scheme.backward, scheme.rotateLeft, scheme.rotateRight, scheme.shoot, scheme.laser, scheme.boost]) {
        expect(schemeCodes(scheme)).toContain(codes[0]);
      }
    }
  });

  it('gives every row a long and a short action', () => {
    for (const row of keyboardRows(SOLO_KEYS)) {
      expect(row.long.length).toBeGreaterThan(row.short.length - 1);
      expect(row.short.split(' ').length).toBeLessThanOrEqual(2);
    }
  });
});

describe('controller and touch reference', () => {
  const pad = (over: Partial<{ axes: number[]; pressed: number[] }>): GamepadSnapshot => ({
    index: 0,
    id: 'test',
    mapping: 'standard',
    connected: true,
    axes: over.axes ?? [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: over.pressed?.includes(i) ?? false, value: over.pressed?.includes(i) ? 1 : 0 })),
  });

  it('matches what the pad really does: A and the trigger shoot, X is the laser, B the boost, the stick moves', () => {
    const rows = Object.fromEntries(PAD_ROWS.map((r) => [r.short, r.caps]));
    expect(rows.Shoot).toEqual(['A', 'RT']);
    expect(padToInput(pad({ pressed: [0] })).shoot).toBe(true); // A
    expect(padToInput(pad({ pressed: [7] })).shoot).toBe(true); // right trigger
    expect(rows.Laser).toEqual(['X']);
    expect(padToInput(pad({ pressed: [2] })).laser).toBe(true);
    expect(rows.Boost).toEqual(['B']);
    expect(padToInput(pad({ pressed: [1] })).boost).toBe(true);
    expect(rows.Move).toEqual(['L-STICK']);
    expect(padToInput(pad({ axes: [1, -1, 0, 0] }))).toMatchObject({ rotate: 1, move: 1 });
  });

  it('names the touch controls as the game labels them, per movement mode', () => {
    expect(touchRows('classic').map((r) => r.label)).toEqual(['D-PAD', 'FIRE', 'LASER', 'BOOST', 'PAUSE']);
    for (const mode of ['pointToFly', 'assisted'] as const) {
      expect(touchRows(mode).map((r) => r.label)).toEqual(['STICK', 'FIRE', 'LASER', 'BOOST', 'PAUSE']);
      expect(touchRows(mode)[0]?.kind).toBe('stick');
    }
    expect(touchRows('classic')[0]?.kind).toBe('dpad');
    // The two stick modes share one control but describe what it does differently.
    expect(touchRows('pointToFly')[0]?.text).not.toBe(touchRows('assisted')[0]?.text);
  });

  it('draws FIRE, LASER and BOOST in the colours of the on-screen buttons', () => {
    const colors = Object.fromEntries(touchRows('classic').map((r) => [r.label, r.color]));
    expect(colors).toMatchObject({ FIRE: '#ff6450', LASER: '#64c8ff', BOOST: '#ff64ff' });
  });
});

describe('two-player speed handicap', () => {
  it('steps through the options and stops at the ends for the - / + buttons', () => {
    expect(stepSpeed(1, 1, false)).toBe(1.25);
    expect(stepSpeed(1, -1, false)).toBe(0.75);
    expect(stepSpeed(SPEED_OPTIONS[0] as number, -1, false)).toBe(SPEED_OPTIONS[0]);
    expect(stepSpeed(SPEED_OPTIONS.at(-1) as number, 1, false)).toBe(SPEED_OPTIONS.at(-1));
  });

  it('wraps for the S / D hotkeys, like the old cycling', () => {
    expect(stepSpeed(SPEED_OPTIONS.at(-1) as number, 1, true)).toBe(SPEED_OPTIONS[0]);
    expect(stepSpeed(SPEED_OPTIONS[0] as number, -1, true)).toBe(SPEED_OPTIONS.at(-1));
  });

  it('treats an unknown value as the first option', () => {
    expect(stepSpeed(9, 1, false)).toBe(SPEED_OPTIONS[1]);
  });
});
