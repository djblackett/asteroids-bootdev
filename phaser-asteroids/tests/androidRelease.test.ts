import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../capacitor.config';
import { resolveApiBase } from '../src/ranked/api';

/**
 * The Android app's settings live in four files that must agree: capacitor.config.ts (the app's origin and web folder), .env.android
 * (the leaderboard URL baked into the app), server/wrangler.toml (the origins the production Worker accepts) and the manifest.
 */
const read = (file: string): string => new TextDecoder().decode(readFileSync(resolve(import.meta.dirname, '..', file)));

function productionOrigins(): string[] {
  const toml = read('server/wrangler.toml');
  const section = toml.slice(toml.indexOf('[env.production.vars]'));
  const line = section.match(/^ALLOWED_ORIGINS\s*=\s*"([^"]*)"/m);
  return (line?.[1] ?? '').split(',').map((o) => o.trim()).filter(Boolean);
}

const appOrigin = `${config.server?.androidScheme ?? 'https'}://${config.server?.hostname}`;

describe('Android app configuration', () => {
  it('is served from its own https hostname, not localhost', () => {
    expect(config.server?.androidScheme).toBe('https');
    expect(config.server?.hostname).toBe('spacearcade.davidandrea.ca');
  });

  it('the production Worker accepts the app origin (and still accepts GitHub Pages)', () => {
    expect(productionOrigins()).toEqual(expect.arrayContaining([appOrigin, 'https://djblackett.github.io']));
  });

  it('local Worker origins are unchanged (the app origin is production-only)', () => {
    const toml = read('server/wrangler.toml');
    const local = toml.slice(0, toml.indexOf('[env.production'));
    expect(local).not.toContain(appOrigin);
  });

  it('packages the dedicated Android build, never dist/ (which carries the server-only verifier)', () => {
    expect(config.webDir).toBe('dist-android');
  });

  it('bakes the production API into the app, and on the app hostname nothing else can be used', () => {
    const api = read('.env.android').match(/^VITE_LEADERBOARD_API_URL=(.+)$/m)?.[1]?.trim();
    expect(api).toBe('https://asteroids-leaderboard.davejandrea.workers.dev');
    expect(resolveApiBase('?api=http://127.0.0.1:8787', config.server!.hostname!, api)).toBe(api);
    expect(resolveApiBase('', config.server!.hostname!, undefined)).toBeNull();
  });

  it('hides the system bars with the built-in SystemBars plugin and writes the safe-area variables', () => {
    expect(config.plugins?.SystemBars).toMatchObject({ hidden: true, insetsHandling: 'css' });
  });

  it('tells SystemBars up front that the page uses viewport-fit=cover, and the page really does', () => {
    expect(config.plugins?.SystemBars).toMatchObject({ initialViewportFitValueHint: 'cover' });
    expect(read('index.html')).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover/);
  });

  it('the manifest locks landscape and allows vibration', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android:screenOrientation="sensorLandscape"');
    expect(manifest).toContain('android.permission.VIBRATE');
  });
});
