import { describe, expect, it } from 'vitest';
import { openExternalUrl, type ExternalWindow } from '../src/platform/openExternal';
import { fullPolicyStatus, PRIVACY_POLICY_URL } from '../src/ui/menu/pages/privacy';

function fakeWindow(tab: { opener: unknown } | null | 'throw') {
  const calls = { open: [] as Array<[string, string]>, assign: [] as string[] };
  const win: ExternalWindow = {
    open: (url, target) => {
      calls.open.push([url, target]);
      if (tab === 'throw') throw new Error('blocked by policy');
      return tab;
    },
    location: { assign: (url) => void calls.assign.push(url) },
  };
  return { win, calls };
}

describe('openExternalUrl', () => {
  it('in a browser opens a new tab, never this page, and cuts the opener link', () => {
    const tab = { opener: 'game window' as unknown };
    const { win, calls } = fakeWindow(tab);
    expect(openExternalUrl(PRIVACY_POLICY_URL, win, false)).toBe('opened');
    expect(calls.open).toEqual([[PRIVACY_POLICY_URL, '_blank']]);
    expect(calls.assign).toEqual([]);
    expect(tab.opener).toBeNull();
  });

  it('reports a blocked tab (null or a throwing window.open) without navigating the game', () => {
    for (const tab of [null, 'throw'] as const) {
      const { win, calls } = fakeWindow(tab);
      expect(openExternalUrl(PRIVACY_POLICY_URL, win, false)).toBe('blocked');
      expect(calls.assign).toEqual([]);
    }
  });

  it('in the Android app hands the URL to the system browser via a navigation Capacitor intercepts', () => {
    const { win, calls } = fakeWindow(null);
    expect(openExternalUrl(PRIVACY_POLICY_URL, win, true)).toBe('handed-off');
    expect(calls.assign).toEqual([PRIVACY_POLICY_URL]);
    expect(calls.open).toEqual([]);
  });

  it('only opens https addresses', () => {
    const { win } = fakeWindow(null);
    for (const bad of ['http://djblackett.github.io/', 'javascript:alert(1)', 'https:/x', '/privacy/']) {
      expect(() => openExternalUrl(bad, win, true), bad).toThrow(/non-https/);
    }
  });
});

describe('VIEW FULL POLICY status line', () => {
  it('always gives the address when the app cannot confirm a browser opened, or the tab was blocked', () => {
    expect(fullPolicyStatus('handed-off')).toContain('djblackett.github.io/asteroids-bootdev/privacy/');
    expect(fullPolicyStatus('handed-off')).toContain('NEEDS INTERNET');
    expect(fullPolicyStatus('blocked')).toContain('djblackett.github.io/asteroids-bootdev/privacy/');
    expect(fullPolicyStatus('opened')).toContain('OFFLINE');
  });
});
