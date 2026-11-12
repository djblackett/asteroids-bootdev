import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Public name Hull & Havoc; the Android identity and infrastructure names stay as they are (they are not user-facing). */
const root = resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const files = (dir: string): string[] => readdirSync(join(root, dir)).flatMap((name) => {
  const rel = `${dir}/${name}`;
  return statSync(join(root, rel)).isDirectory() ? files(rel) : [rel];
});

describe('Hull & Havoc branding', () => {
  it('names the game on the title screen, page, touch prompt and Android launcher', () => {
    expect(read('src/ui/menu/pages/title.ts')).toContain("'HULL & HAVOC'");
    expect(read('src/main.ts')).toContain("title: 'Hull & Havoc'");
    expect(read('index.html')).toContain('<title>Hull &amp; Havoc</title>');
    expect(read('src/ui/touchOverlay.ts')).toContain('Hull & Havoc plays in landscape.');
    const strings = read('android/app/src/main/res/values/strings.xml');
    expect(strings).toContain('<string name="app_name">Hull &amp; Havoc</string>');
    expect(strings).toContain('<string name="title_activity_main">Hull &amp; Havoc</string>');
    expect(read('capacitor.config.ts')).toContain("appName: 'Hull & Havoc'");
  });

  it('keeps the Android package identity unchanged', () => {
    expect(read('capacitor.config.ts')).toContain("appId: 'ca.davidandrea.spacearcade'");
    const gradle = read('android/app/build.gradle');
    expect(gradle).toContain('namespace = "ca.davidandrea.spacearcade"');
    expect(gradle).toContain('applicationId "ca.davidandrea.spacearcade"');
    expect(read('android/app/src/main/res/values/strings.xml')).toContain('<string name="package_name">ca.davidandrea.spacearcade</string>');
  });

  it('ships no earlier working title in client, server or public files', () => {
    const shipped = [...files('src'), ...files('server/src'), ...files('public').filter((f) => /\.(html|json|txt|webmanifest)$/.test(f)), 'index.html'];
    for (const file of shipped) {
      if (!/\.(ts|html|json|txt|webmanifest)$/.test(file)) continue;
      expect(read(file), file).not.toMatch(/Orbital Impact|orbital-impact|>Asteroids<|'ASTEROIDS'|title: 'Asteroids'|'Asteroids plays/);
    }
  });
});
