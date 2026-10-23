import { describe, expect, it } from 'vitest';
import { DEFAULT_SETUP } from '../src/gameSetup';
import { InputModeController, type InputEnvironment } from '../src/input/inputMode';
import { describeRankedFailure } from '../src/ui/menu/pages/ranked';
import { usesMobilePlayEntry } from '../src/ui/menu/pages/title';

describe('mobile play entry uses the existing input environment and preferences', () => {
  const phone = { coarsePrimaryPointer: true, touchCapable: true };
  const desktop = { coarsePrimaryPointer: false, touchCapable: false };
  const laptop = { coarsePrimaryPointer: false, touchCapable: true };
  it.each<[string, InputEnvironment, string, 1 | 2, boolean]>([
    ['phone', phone, '', 1, true],
    ['phone with touch explicitly off', phone, '?touch=off', 1, true],
    ['phone with co-op selected', phone, '?touch=off', 2, false],
    ['desktop', desktop, '', 1, false],
    ['desktop co-op', desktop, '', 2, false],
    ['touch laptop with a fine primary pointer', laptop, '', 1, false],
    ['explicit touch override', desktop, '?touch=on', 1, true],
  ])('%s', (_name, env, query, playerCount, expected) => {
    const inputMode = new InputModeController(env, query, null);
    const before = inputMode.mode;
    expect(usesMobilePlayEntry({ inputMode, setup: () => ({ ...DEFAULT_SETUP, game: { ...DEFAULT_SETUP.game, playerCount } }) })).toBe(expected);
    expect(inputMode.mode).toBe(before);
  });
});

describe('ranked service failures keep the choice explicit', () => {
  it.each(['network', 'unavailable', 'rate_limited', 'bad_challenge'])('%s offers retry and names Practice', (code) => {
    const failure = describeRankedFailure(code);
    expect(failure.retry).toBe(true);
    expect(failure.lines.join(' ')).toContain('PRACTICE');
  });
  it('keeps the required reload instruction for incompatible builds', () => {
    expect(describeRankedFailure('update_required')).toEqual({
      lines: ['THE GAME HAS BEEN UPDATED.', 'RELOAD THE PAGE TO PLAY RANKED.'], retry: false,
    });
  });
});
