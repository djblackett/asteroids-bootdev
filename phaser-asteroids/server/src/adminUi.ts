/** Same-origin operator console. No credential storage, third-party resources or player-app bundle. */
export function adminPage(): Response {
  const nonce = crypto.randomUUID();
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Hull &amp; Havoc moderation</title>
<style nonce="${nonce}">
body{font:16px system-ui;background:#101927;color:#e8eef8;max-width:1100px;margin:2rem auto;padding:0 1rem}
button,input,select{font:inherit;padding:.6rem;margin:.3rem;color:inherit;background:#24344b;border:1px solid #8295af;border-radius:4px}
button{cursor:pointer}button:disabled{opacity:.5}label{display:inline-block}article{border:1px solid #8295af;padding:1rem;margin:1rem 0}
pre{white-space:pre-wrap;overflow-wrap:anywhere}small{display:block;color:#bdcbe0}#status{min-height:2em}input{max-width:90%}
</style>
<h1>Leaderboard moderation</h1>
<p>Review content and score integrity separately. Reports and integrity flags are evidence for review, not proof of cheating. No action changes a verified score.</p>
<form id="login"><label>Admin token <input id="token" type="password" autocomplete="off" required></label><button>Unlock</button></form>
<section id="console" hidden>
<button id="logout">Lock / clear session</button>
<label>View <select id="filter"><option value="queue">Needs review</option><option value="hidden">Hidden entries</option><option value="all">All entries</option></select></label>
<label>Exact score ID <input id="lookup" placeholder="Optional UUID"></label><button id="refresh">Refresh</button>
<p>Replace an offensive name to preserve a legitimate score. Hiding and name changes do not close reports: use Resolve after reviewing them. Restore original name may republish offensive content. Erasure is permanent and requires a reviewed privacy request.</p>
<div id="entries"></div><button id="next" disabled>Next 50</button>
<details><summary>Audit log (all decisions, including anonymous erasures)</summary><button id="audit">Latest 100</button><pre id="audit-log"></pre><button id="audit-next" disabled>Older decisions</button></details>
</section><p id="status" role="status" aria-live="polite"></p>
<script nonce="${nonce}">
'use strict';
let secret = '', cursor = null, auditCursor = null, busy = false, idleTimer;
const el = id => document.getElementById(id);
const say = text => { el('status').textContent = text; };
function lock() { secret = ''; clearTimeout(idleTimer); el('token').value = ''; el('entries').replaceChildren(); el('audit-log').textContent = ''; el('console').hidden = true; el('login').hidden = false; }
async function api(path, body) {
  const session = secret;
  const r = await fetch('/api/v1/admin/' + path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15000),
    headers: { Authorization: 'Bearer ' + secret, ...(body === undefined ? {} : {'Content-Type':'application/json'}) },
    ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
  const data = await r.json();
  if (session !== secret) throw new Error('Session locked');
  if (!r.ok) { if (r.status === 401) lock(); throw new Error(data.error?.message || 'Request failed'); }
  return data;
}
async function task(fn) {
  if (busy) return; busy = true;
  clearTimeout(idleTimer); idleTimer = setTimeout(() => { lock(); say('Locked after 15 minutes of inactivity.'); }, 15 * 60 * 1000);
  try { await fn(); } catch(e) { say(e.message + ' Refresh before retrying an uncertain action.'); }
  finally { busy = false; }
}
function text(tag, value, parent) { const node = document.createElement(tag); node.textContent = value; parent.append(node); return node; }
function button(label, parent, fn) { const b = text('button',label,parent); b.type = 'button'; b.onclick = () => task(fn); return b; }
async function load(before = null) {
  const q = new URLSearchParams({filter:el('filter').value});
  if (before !== null) q.set('before', before);
  if (el('lookup').value.trim()) q.set('id', el('lookup').value.trim());
  const data = await api('scores?' + q);
  el('entries').replaceChildren(); cursor = data.next; el('next').disabled = cursor === null;
  for (const s of data.entries) {
    const card = document.createElement('article'); el('entries').append(card);
    text('h2',s.displayName + ' — ' + s.score.toLocaleString() + ' points',card);
    text('small','ID ' + s.id + ' | ' + s.visibility + ' | rules ' + s.rulesVersion + ' | revision ' + s.revision,card);
    text('p','Original: ' + s.originalName + ' | ' + new Date(s.completedAt).toISOString() + ' | duration ' + s.durationMs/1000 + 's | asteroids ' + s.asteroids + ' | UFOs ' + s.ufos,card);
    text('p',s.openReports + ' open reports. ' + (s.suspicious ? 'Integrity anomaly: score exceeds kill bound, or invalid duration/counts. ' + (s.suspicionReviewed ? 'Reviewed.' : 'Needs review.') : 'No supported integrity anomaly.'),card);
    const history = document.createElement('pre');
    button('Reports / decision history',card,async () => { const h = await api('scores/' + s.id + '/history'); history.textContent =
      'Reports by category (no reporter identifiers):\\n' + h.reports.map(r => r.count + ' ' + r.status + ' / ' + r.reason + ' / first ' + new Date(r.firstAt).toISOString()).join('\\n') +
      '\\nLatest 100 decisions (older entries in Audit log):\\n' + h.audit.map(a => new Date(a.created_at).toISOString() + ' / ' + a.action + ' / ' + a.category + ' / revision ' + a.revision + ' / open reports ' + a.open_reports).join('\\n'); });
    card.append(history);
    const label = text('label','Decision category ',card), category = document.createElement('select');
    for (const c of ['offensive','personal_info','suspicious_score','other','appeal']) { const o = text('option',c,category); o.value = c; } label.append(category);
    const nameLabel = text('label','Replacement name ',card), name = document.createElement('input'); name.value = 'Anonymous'; name.maxLength = 256; nameLabel.append(name);
    async function decide(action) {
      if (!confirm(action + ' entry ' + s.id + '?')) return;
      await api('scores/' + s.id + '/moderate',{action,category:category.value,revision:s.revision,...(action === 'rename' ? {name:name.value} : {})});
      await load(); say('Decision saved with audit record.');
    }
    for (const [label,action] of [['Hide','hide'],['Restore score','restore'],['Replace name','rename'],['Restore original name','restore_name'],['Resolve reports / flag','resolve'],['Reopen review','reopen']]) button(label,card,() => decide(action));
    button('Erase score and linked records',card,async () => {
      if (prompt('Permanent privacy erasure. Verify the request first. Type the full score ID to confirm:') !== s.id) return;
      await api('scores/' + s.id + '/delete',{}); await load(); say('Entry and linked run/reports erased. Anonymous decision metadata retained.');
    });
  }
  if (!data.entries.length) text('p','No entries in this view.',el('entries'));
}
el('login').onsubmit = e => { e.preventDefault(); task(async () => { secret = el('token').value; el('token').value = ''; await load(); el('console').hidden = false; el('login').hidden = true; say('Unlocked. Token stays only in this tab memory.'); }); };
el('logout').onclick = () => { lock(); say('Locked.'); };
el('refresh').onclick = () => task(() => load()); el('filter').onchange = () => task(() => load()); el('next').onclick = () => task(() => load(cursor));
async function audit(before) { const a = await api('audit' + (before === null ? '' : '?before=' + before)); el('audit-log').textContent = a.entries.map(r => '#' + r.id + ' / ' + new Date(r.created_at).toISOString() + ' / ' + (r.score_id || '[erased entry]') + ' / ' + r.action + ' / ' + r.category + ' / revision ' + r.revision).join('\\n'); auditCursor = a.next; el('audit-next').disabled = a.next === null; }
el('audit').onclick = () => task(() => audit(null)); el('audit-next').onclick = () => task(() => audit(auditCursor));
window.addEventListener('pagehide',lock);
</script></html>`, { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  } });
}
