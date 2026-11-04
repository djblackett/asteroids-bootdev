import { getApiBase } from '../../../ranked/api';
import { NicknameBlocks, sendScoreReport, type ReportReason } from '../../../ranked/moderation';
import type { ScoresModel } from '../../../ranked/scoresModel';
import { COLORS } from '../../text';
import type { PageNav } from '../context';
import type { PageBuilder } from '../menuView';
import { MenuButton, MenuChoice, MIN_TARGET, type PageKit } from '../widgets';
import { backButton, CENTER_X, pageTitle } from './common';

/** Shared by title and result menus. No additional leaderboard fetch or personal identifier. */
export function moderationPage(model: ScoresModel, blocks: NicknameBlocks, nav: PageNav): PageBuilder {
  let index = 0;
  let reason = 0;
  let status = '';
  let sending = false;
  const reasons: ReportReason[] = ['offensive', 'personal_info', 'suspicious_score', 'other'];
  return (kit: PageKit) => {
    const entries = model.page?.entries ?? [];
    index = Math.min(index, Math.max(0, entries.length - 1));
    const entry = entries[index];
    pageTitle(kit, 'REPORT / BLOCK');
    const text = (y: number, label: string, size = 26): void => {
      const t = kit.text(CENTER_X, y, label, { size, originX: 0.5, originY: 0.5, color: COLORS.hint });
      if (t.width > 1120) t.setScale(1120 / t.width);
    };
    text(115, entry ? `ENTRY ID: ${entry.id}` : 'SELECT AN ENTRY FROM THE CURRENT SCORE PAGE', 24);
    text(163, entry ? `#${entry.rank}  ${blocks.has(entry.nickname) ? '[BLOCKED NICKNAME]' : entry.nickname}  /  ${entry.score}` : 'NO ENTRIES ON THIS PAGE');
    const choose = (step: number): void => { index += step; status = ''; };
    new MenuButton(kit, { id: 'entry-prev', rect: { x: 220, y: 194, w: 400, h: MIN_TARGET }, label: '< ENTRY', enabled: () => index > 0 && !sending, onTap: () => choose(-1), size: 28 });
    new MenuButton(kit, { id: 'entry-next', rect: { x: 660, y: 194, w: 400, h: MIN_TARGET }, label: 'ENTRY >', enabled: () => index < entries.length - 1 && !sending, onTap: () => choose(1), size: 28 });
    new MenuChoice(kit, { id: 'reason', label: 'REASON', y: 310, frame: { x: 120, y: 310, w: 1040, h: MIN_TARGET }, options: ['OFFENSIVE / ABUSIVE', 'PERSONAL INFO', 'SUSPECTED CHEATING', 'OTHER'], selected: () => reason, onSelect: (i) => { reason = i; }, size: 24 });
    new MenuButton(kit, { id: 'report-send', rect: { x: 120, y: 426, w: 500, h: MIN_TARGET }, label: sending ? 'SENDING...' : 'SEND REPORT', enabled: () => !!entry && !!getApiBase() && !sending,
      onTap: () => {
        if (!entry || sending) return;
        sending = true;
        status = '';
        void sendScoreReport(getApiBase()!, entry.id, reasons[reason]!).then(() => { status = 'REPORT RECEIVED FOR REVIEW. THANK YOU.'; })
          .catch((e: unknown) => { status = e instanceof Error && e.message.startsWith('TOO MANY') ? e.message : 'REPORT NOT SENT. PLEASE RETRY.'; })
          .finally(() => { sending = false; });
      }, size: 28 });
    new MenuButton(kit, { id: 'nickname-block', rect: { x: 660, y: 426, w: 500, h: MIN_TARGET }, label: entry && blocks.has(entry.nickname) ? 'UNBLOCK NICKNAME' : 'BLOCK NICKNAME', enabled: () => !!entry, onTap: () => { if (entry) blocks.toggle(entry.nickname); }, size: 28 });
    text(547, status || 'BLOCK HIDES THIS NAME HERE; SHARED NAMES ARE ALSO HIDDEN.', 23);
    backButton(kit, () => nav.back());
    return { defaultFocus: 'back', signature: () => `${model.version}|${index}|${reason}|${sending}|${status}|${blocks.version}` };
  };
}
