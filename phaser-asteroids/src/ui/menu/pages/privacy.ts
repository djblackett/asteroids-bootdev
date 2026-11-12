import { openExternalUrl, type ExternalOpenResult } from '../../../platform/openExternal';
import type { PageNav } from '../context';
import type { PageBuilder } from '../menuView';
import { COLORS } from '../../text';
import { MenuButton, MIN_TARGET } from '../widgets';
import { CENTER_X, pageTitle } from './common';

// Approved copy, bundled offline (owner approved the wording 2026-11-12). Never reintroduce a review marker such as "DRAFT" or
// "PENDING": scripts/inspect-android-release.ps1 refuses signed builds that carry one, and tests/androidRelease.test.ts keeps it so.
// Keep it consistent with the full policy, public/privacy/index.html (tests/privacyPage.test.ts compares the key facts).
export const PRIVACY_CONTACT = 'privacy@davidandrea.ca';
/** The one canonical address of the full policy (GitHub Pages; served from public/privacy/index.html). */
export const PRIVACY_POLICY_URL = 'https://djblackett.github.io/asteroids-bootdev/privacy/';
/** The privacy page that holds the leaderboard rules (the result page links straight to it). */
export const RULES_PAGE = 'privacy-3';
export const PRIVACY_PAGES = [
  [
    'PRIVACY POLICY',
    'Hull & Havoc / ca.davidandrea.spacearcade',
    'Operator: David Andrea. No accounts, ads or analytics SDKs.',
    'Ranked play sends game inputs, versions, timing and control type',
    'to Cloudflare to verify scores and prevent abuse.',
    'Submitting publishes your nickname, score, date, duration and rules version.',
    'Use a nickname without personal information. Submission is optional.',
    'Practice uploads no gameplay and submits no score. Menus may fetch public scores.',
    `Full policy (online): ${PRIVACY_POLICY_URL}`,
  ],
  [
    'STORAGE AND RETENTION',
    'Cloudflare processes requests, including your IP and request metadata.',
    'We store a salted IP hash for abuse prevention, not the raw IP.',
    'Full replays are processed in memory; only their submission hash is kept.',
    'Verified scores and linked run data have no automatic expiry, even if hidden,',
    'to keep the leaderboard\'s history and let results be checked later.',
    'Daily cleanup removes abandoned runs 1 day after expiry and',
    'rejected runs after 30 days; old hourly counters after 2 hours.',
    'Reports (entry, reason, IP hash) expire after 30 days at daily cleanup.',
    'Cloudflare logs and backups follow their own retention periods.',
  ],
  [
    'YOUR CHOICES AND CONTACT',
    'Settings, last nickname, up to 20 accepted scores and blocked names',
    'stay in local storage. Clear app storage to remove them from this device.',
    'This does not remove server entries. No sale of data or ad tracking.',
    'Email to ask for removal, access, correction, an appeal, or how data is used:',
    PRIVACY_CONTACT,
    'Include the score ID, nickname, score and date. Do not send passwords.',
    'With no accounts and shared nicknames we may not be able to tell which',
    'entries are yours, so we may ask for context or be unable to act.',
    'Report abusive names from HIGH SCORES > REPORT / BLOCK.',
  ],
  [
    'LEADERBOARD RULES',
    'Before each submission you choose ACCEPT RULES & SUBMIT: that accepts',
    'these rules and the public display of your nickname and score.',
    'Do not post hateful, sexual, threatening or harassing nicknames,',
    'impersonate others, or expose anyone\'s personal information.',
    'Names are screened automatically. Reports are private and never auto-hide;',
    'the operator reviews them when needed, not continuously or instantly.',
    'Administrators may replace names, hide or remove rule-breaking entries.',
    'Block hides that name on this device only; it cannot follow name changes.',
    'Network traffic uses HTTPS. No method of storage is perfectly secure.',
  ],
] as const;

/** What the page says after VIEW FULL POLICY. The address is always shown, because the app cannot tell whether a browser opened. */
export function fullPolicyStatus(result: ExternalOpenResult): string {
  const where = PRIVACY_POLICY_URL.replace(/^https:\/\//, '');
  if (result === 'opened') return 'OPENED IN A NEW TAB. THIS SUMMARY ALSO WORKS OFFLINE.';
  if (result === 'blocked') return `YOUR BROWSER BLOCKED THE NEW TAB. VISIT ${where}`;
  return `OPENING YOUR BROWSER (NEEDS INTERNET). IF NOTHING OPENS, VISIT ${where}`;
}

export function privacyPages(nav: PageNav, open: (url: string) => ExternalOpenResult = (url) => openExternalUrl(url)): Record<string, PageBuilder> {
  return Object.fromEntries(PRIVACY_PAGES.map((lines, index) => [index === 0 ? 'privacy' : `privacy-${index}`, (kit) => {
    pageTitle(kit, `PRIVACY  ${index + 1} / ${PRIVACY_PAGES.length}`);
    // Up to ten lines fit above the status line and the buttons.
    const step = lines.length > 9 ? 40 : 44;
    lines.forEach((line, i) => {
      const text = kit.text(CENTER_X, 137 + i * step, line, { size: 24, originX: 0.5, originY: 0.5 });
      if (text.width > 1160) text.setScale(1160 / text.width);
    });
    const status = kit.text(CENTER_X, 556, '', { size: 22, originX: 0.5, originY: 0.5, color: COLORS.hint });
    new MenuButton(kit, { id: 'back', rect: { x: 80, y: 596, w: 340, h: MIN_TARGET }, label: 'BACK', onTap: () => nav.back(), size: 30 });
    new MenuButton(kit, {
      id: 'privacy-full',
      rect: { x: 450, y: 596, w: 380, h: MIN_TARGET },
      label: 'VIEW FULL POLICY',
      size: 28,
      onTap: () => {
        let result: ExternalOpenResult;
        try {
          result = open(PRIVACY_POLICY_URL);
        } catch {
          result = 'blocked';
        }
        status.setScale(1).setText(fullPolicyStatus(result));
        if (status.width > 1160) status.setScale(1160 / status.width);
      },
    });
    if (index < PRIVACY_PAGES.length - 1) new MenuButton(kit, { id: 'privacy-next', rect: { x: 860, y: 596, w: 340, h: MIN_TARGET }, label: 'NEXT >', onTap: () => nav.open(`privacy-${index + 1}`), size: 30 });
    return { defaultFocus: 'back' };
  }]));
}
