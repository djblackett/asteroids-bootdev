import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRIVACY_PAGES } from '../src/ui/menu/pages/privacy';

/** The public privacy page is a plain static file in public/, copied unchanged into the build. These checks keep it self-contained and finished. */
const page = new TextDecoder().decode(readFileSync(resolve(import.meta.dirname, '..', 'public/privacy/index.html')));
const text = page.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');

describe('public privacy page (public/privacy/index.html)', () => {
  it('names the game, the contact and the unchanged Android package', () => {
    expect(page).toContain('<title>Hull &amp; Havoc — Privacy Policy</title>');
    expect(page).toContain('<h1>Hull &amp; Havoc — Privacy Policy</h1>');
    expect(page).toContain('mailto:privacy@davidandrea.ca');
    expect(page).toContain('ca.davidandrea.spacearcade');
    expect(page).toMatch(/<time datetime="\d{4}-\d{2}-\d{2}">/);
  });

  it('is accessible static HTML with no scripts, trackers or third-party resources', () => {
    expect(page).toMatch(/^<!doctype html>/i);
    expect(page).toContain('<html lang="en">');
    expect(page).toContain('name="viewport"');
    expect(page).toContain('<main>');
    expect(page).not.toMatch(/<script|<iframe|<img|<link[^>]+rel="stylesheet"|@import|url\(/i);
    // Only links out: Cloudflare's policy. Everything else is relative or mailto.
    const external = [...page.matchAll(/(?:href|src)="(https?:[^"]+)"/g)].map((m) => m[1]);
    expect(external).toEqual(['https://www.cloudflare.com/privacypolicy/']);
  });

  it('has no draft placeholders and no internal operational detail', () => {
    expect(text).not.toMatch(/PENDING|DRAFT|TODO|TBD|FIXME|lorem|\[[A-Z ]{4,}\]/i);
    expect(page).not.toMatch(/workers\.dev|\/admin|RESEND|api[_-]?key|secret[_-]?value|ADMIN_TOKEN|wrangler|database_id|account[_-]?id/i);
  });

  it('does not describe the unreleased moderation digest as operating', () => {
    expect(page).not.toMatch(/digest|Resend/i);
  });

  it('agrees with the bundled offline screens on the retention figures and contact', () => {
    const offline = PRIVACY_PAGES.flat().join(' ');
    expect(offline).toContain('privacy@davidandrea.ca');
    expect(offline).toContain('https://djblackett.github.io/asteroids-bootdev/privacy/');
    expect(offline).toContain('Hull & Havoc');
    for (const fact of ['30 days', 'two hours', 'one day']) expect(text).toContain(fact);
    expect(offline).toContain('30 days');
  });
});
