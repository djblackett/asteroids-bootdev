import type { PageNav } from '../context';
import type { PageBuilder } from '../menuView';
import { MenuButton, MIN_TARGET } from '../widgets';
import { CENTER_X, pageTitle } from './common';

// Review copy, bundled offline. Operator confirmed 2026-11-04. Public contact
// intentionally deferred by David; replace the contact and review status before distribution.
export const PRIVACY_CONTACT = '[PRIVACY CONTACT PENDING]';
export const PRIVACY_PAGES = [
  [
    'DRAFT PRIVACY POLICY - REVIEW PENDING',
    'Asteroids / ca.davidandrea.spacearcade',
    'Operator: David Andrea. No accounts, ads or analytics SDKs.',
    'Ranked play sends game inputs, versions, timing and control type',
    'to Cloudflare to verify scores and prevent abuse.',
    'Submitting publishes your nickname, score, date, duration and rules version.',
    'Use a nickname without personal information. Submission is optional.',
    'Practice does not upload gameplay. Menus may fetch public scores.',
  ],
  [
    'STORAGE AND RETENTION',
    'Cloudflare processes requests, including your IP and request metadata.',
    'We store a salted IP hash for abuse prevention, not the raw IP.',
    'Full replays are processed in memory; only their submission hash is kept.',
    'Accepted scores and linked run data have no automatic expiry, even if hidden.',
    'Daily cleanup removes abandoned runs 1 day after expiry and',
    'rejected runs after 30 days; old hourly counters after 2 hours.',
    'Reports (entry, reason, IP hash) expire after 30 days at daily cleanup.',
    'Provider logs and backups have separate retention; review is pending.',
  ],
  [
    'YOUR CHOICES AND CONTACT',
    'Settings, last nickname, up to 20 accepted scores and blocked names',
    'stay in local storage. Clear app storage to remove them from this device.',
    'This does not remove server entries. No sale of data or ad tracking.',
    'For removal, privacy or security requests, contact:',
    PRIVACY_CONTACT,
    'Include the score ID, nickname, score and date. Do not send passwords.',
    'We may ask for context to prevent removal of someone else\'s score.',
    'Report abusive names from HIGH SCORES > REPORT / BLOCK.',
  ],
  [
    'LEADERBOARD RULES',
    'By submitting a score you accept these rules and public display.',
    'Do not post hateful, sexual, threatening or harassing nicknames,',
    'impersonate others, or expose anyone\'s personal information.',
    'Administrators may replace names, hide or remove rule-breaking entries.',
    'Reports go privately to the operator for review; they do not auto-hide scores.',
    'Block hides all entries with that name on this device. Names are shared;',
    'there are no accounts, so this cannot block a person who changes names.',
    'Network traffic uses HTTPS. No method of storage is perfectly secure.',
  ],
] as const;

export function privacyPages(nav: PageNav): Record<string, PageBuilder> {
  return Object.fromEntries(PRIVACY_PAGES.map((lines, index) => [index === 0 ? 'privacy' : `privacy-${index}`, (kit) => {
    pageTitle(kit, `PRIVACY  ${index + 1} / ${PRIVACY_PAGES.length}`);
    lines.forEach((line, i) => {
      const text = kit.text(CENTER_X, 137 + i * 44, line, { size: 24, originX: 0.5, originY: 0.5 });
      if (text.width > 1160) text.setScale(1160 / text.width);
    });
    new MenuButton(kit, { id: 'back', rect: { x: 220, y: 596, w: 400, h: MIN_TARGET }, label: 'BACK', onTap: () => nav.back(), size: 30 });
    if (index < PRIVACY_PAGES.length - 1) new MenuButton(kit, { id: 'privacy-next', rect: { x: 660, y: 596, w: 400, h: MIN_TARGET }, label: 'NEXT >', onTap: () => nav.open(`privacy-${index + 1}`), size: 30 });
    return { defaultFocus: 'back' };
  }]));
}
