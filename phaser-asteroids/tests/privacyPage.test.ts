import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRIVACY_PAGES, PRIVACY_POLICY_URL } from '../src/ui/menu/pages/privacy';

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

  // Review remediation (2026-11-12): the wording must describe what the game actually does.
  const offline = PRIVACY_PAGES.flat().join(' ');
  const entities: Record<string, string> = { amp: '&', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', larr: '←' };
  const flat = text.replace(/&([a-z]+);/g, (m, name: string) => entities[name] ?? m).replace(/\s+/g, ' ');

  it('does not promise that every report is reviewed, or continuous monitoring', () => {
    expect(flat).not.toMatch(/reports? (are|is) reviewed by the operator/i);
    expect(flat).toContain('reviews reports and flagged scores when they need attention');
    expect(flat).toContain('not monitored continuously or in real time');
    expect(flat).toContain('can reach its 30-day retention limit before it has been looked at');
    expect(flat).toContain('does not automatically hide or remove anything');
    expect(flat).toContain('Nicknames are screened automatically');
    expect(offline).toContain('Names are screened automatically');
    expect(offline).toContain('never auto-hide');
    expect(offline).toContain('not continuously or instantly');
    expect(offline).not.toMatch(/reviewed by the operator|for review;/);
  });

  it('says Practice uploads no gameplay and submits no score, and keeps the menu-request caveat', () => {
    expect(flat).toContain('You can play Practice without uploading gameplay or submitting a score.');
    expect(flat).not.toContain('without uploading anything');
    expect(flat).toContain('so Practice is not a promise that no network requests are made');
    expect(offline).toContain('Practice uploads no gameplay and submits no score. Menus may fetch public scores.');
  });

  it('lists removal, access, correction and clarification requests, with the limits of identification', () => {
    for (const phrase of ['to be removed', 'what information we hold about your submissions', 'to be corrected where it is inaccurate', 'appeal a moderation decision', 'how long information is kept or how it is used']) {
      expect(flat, phrase).toContain(phrase);
    }
    expect(flat).toContain('nicknames are not unique');
    expect(flat).toContain('we may not be able to confirm that an entry is yours');
    expect(flat).toContain('may be unable to complete a request');
    expect(offline).toContain('removal, access, correction, an appeal, or how data is used');
    expect(offline).toContain('we may not be able to tell which');
  });

  it('explains why verified scores have no automatic expiry, without changing it', () => {
    expect(flat).toContain('Kept indefinitely by default');
    expect(flat).toContain('to preserve the leaderboard’s history and integrity, and so that results can be checked again later');
    expect(offline).toContain('no automatic expiry');
    expect(offline).toContain('to keep the leaderboard\'s history and let results be checked later');
  });

  it('describes explicit rules acceptance consistently with the game', () => {
    expect(flat).toContain('you submit by choosing Accept rules & submit');
    expect(flat).toContain('You can always skip submitting instead.');
    expect(offline).toContain('ACCEPT RULES & SUBMIT');
  });

  it('keeps the established facts unchanged', () => {
    for (const fact of ['salted hash derived from it', 'The full replay is processed in memory and is not stored', 'Deleted by the daily cleanup after 30 days',
      'Blocking only works on your own device', 'Cloudflare may keep logs and database recovery history', 'nickname, score, completion date, simulated duration, rules version, ending reason',
      'Operator: David Andrea']) {
      expect(flat, fact).toContain(fact);
    }
  });

  it('fits every offline page on screen (at most ten lines each)', () => {
    for (const page of PRIVACY_PAGES) expect(page.length).toBeLessThanOrEqual(10);
  });

  it('uses one canonical policy address everywhere in the project', () => {
    expect(PRIVACY_POLICY_URL).toBe('https://djblackett.github.io/asteroids-bootdev/privacy/');
    const repo = resolve(import.meta.dirname, '..', '..');
    const sources = ['phaser-asteroids/src/ui/menu/pages/privacy.ts', 'phaser-asteroids/docs/google-play-release.md', 'docs/privacy-policy-draft.md', 'docs/privacy-policy-publication.md', 'docs/release-preflight.md'];
    for (const file of sources) {
      const body = new TextDecoder().decode(readFileSync(resolve(repo, file)));
      for (const m of body.matchAll(/[a-z0-9.:/-]*djblackett\.github\.io\/asteroids-bootdev\/privacy[^\s`)"'<,]*/g)) {
        expect(`https://${m[0].replace(/^https?:\/\//, '')}`.replace(/\.$/, ''), file).toBe(PRIVACY_POLICY_URL);
      }
    }
  });
});
