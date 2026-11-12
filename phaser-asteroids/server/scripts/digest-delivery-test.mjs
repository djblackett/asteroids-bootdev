// One-off, operator-authorized check that the moderation digest's credentials work: sends ONE fixed test email (no player data)
// through the same Resend HTTPS contract that src/digest.ts uses. It does not touch D1 or the Worker.
//
//   node scripts/digest-delivery-test.mjs                          -> prints what it would send, sends nothing (exit 2)
//   node scripts/digest-delivery-test.mjs --confirm-one-live-email -> sends one email
//
// Settings come from the environment only: RESEND_API_KEY, MODERATION_DIGEST_FROM, MODERATION_DIGEST_TO, and optionally
// RESEND_API_URL (https, or loopback http for the automated test). The key is never printed; provider messages are never echoed.
// The Idempotency-Key uses its own prefix, so it can never collide with (and 409) a production daily digest key; repeats within
// the same UTC minute are deduplicated by the provider.
const ADDRESS = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const env = (name) => process.env[name]?.trim() ?? '';
const fail = (message, code = 1) => { console.error(`digest-delivery-test: ${message}`); process.exit(code); };

const key = env('RESEND_API_KEY');
const from = env('MODERATION_DIGEST_FROM');
const to = env('MODERATION_DIGEST_TO');
const apiUrl = env('RESEND_API_URL') || 'https://api.resend.com/emails';
const missing = ['RESEND_API_KEY', 'MODERATION_DIGEST_FROM', 'MODERATION_DIGEST_TO'].filter((n) => !env(n));
if (missing.length) fail(`missing ${missing.join(', ')}`);
const named = /^([^<>"\r\n]{1,80}) <([^<>]+)>$/.exec(from);
if (!ADDRESS.test(named ? named[2] : from)) fail('MODERATION_DIGEST_FROM is not an address or "Name <address>"');
if (!ADDRESS.test(to)) fail('MODERATION_DIGEST_TO must be one address');
let url;
try { url = new URL(apiUrl); } catch { fail('RESEND_API_URL is not a URL'); }
if (!(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) fail('RESEND_API_URL must be https or loopback http');

const minute = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '');
const idempotencyKey = `hull-and-havoc-digest-delivery-test-${minute}`;
const subject = 'Hull & Havoc — moderation digest delivery test';
const text = [
  'This is a one-off delivery test of the Hull & Havoc daily moderation digest.',
  '',
  'It was sent by an operator from scripts/digest-delivery-test.mjs. It contains no player data and changed nothing.',
  'If it arrived in spam, mark it as not spam so real digests reach the inbox.',
  '',
].join('\n');

console.log(JSON.stringify({ endpoint: url.origin + url.pathname, from, to, subject, idempotencyKey }));
if (!process.argv.includes('--confirm-one-live-email')) fail('dry run only; pass --confirm-one-live-email to send exactly one email', 2);

let res;
try {
  res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey, 'User-Agent': 'hull-and-havoc-digest-delivery-test' },
    body: JSON.stringify({ from, to: [to], subject, text }),
    signal: AbortSignal.timeout(15_000),
  });
} catch (e) {
  fail(`request failed (${e?.name === 'TimeoutError' ? 'timeout: the email may still have been accepted; check the Resend dashboard before retrying' : 'network error'})`);
}
const data = await res.json().catch(() => null);
if (!res.ok) fail(`provider returned http_${res.status}${typeof data?.name === 'string' ? `:${data.name.replace(/[^a-z0-9_]/gi, '').slice(0, 60)}` : ''}`);
console.log(JSON.stringify({ status: 'sent', id: typeof data?.id === 'string' ? data.id.slice(0, 100) : null }));
