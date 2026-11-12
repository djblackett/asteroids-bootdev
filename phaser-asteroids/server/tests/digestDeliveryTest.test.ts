import { spawn } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDEMPOTENCY_PREFIX } from '../src/digest';

// The operator delivery-test script, against a loopback mock provider only. Nothing here can reach a real provider.
const script = resolve(import.meta.dirname, '..', 'scripts', 'digest-delivery-test.mjs');
const KEY = 're_test_DO_NOT_LEAK_delivery_9876';
const seen: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
let status = 200;
let server: http.Server;
let base = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen.push({ headers: req.headers, body });
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(status === 200 ? { id: 'mock-1' } : { name: 'validation_error', message: `bad ${KEY}` }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/emails`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function run(args: string[], extraEnv: Record<string, string> = {}): Promise<{ code: number | null; out: string }> {
  const env = { PATH: process.env.PATH ?? '', SYSTEMROOT: process.env.SYSTEMROOT ?? '', RESEND_API_KEY: KEY, MODERATION_DIGEST_FROM: 'Hull & Havoc <moderation@digest.test>', MODERATION_DIGEST_TO: 'operator@digest.test', RESEND_API_URL: base, ...extraEnv };
  return new Promise((done) => {
    const child = spawn(process.execPath, [script, ...args], { env });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => done({ code, out }));
  });
}

describe('scripts/digest-delivery-test.mjs', () => {
  it('sends nothing without the explicit confirmation flag', async () => {
    const before = seen.length;
    const r = await run([]);
    expect(r.code).toBe(2);
    expect(r.out).toContain('dry run only');
    expect(seen.length).toBe(before);
    expect(r.out).not.toContain(KEY);
  });

  it('sends exactly one fixed test email with a key that cannot collide with the daily digest', async () => {
    status = 200;
    const before = seen.length;
    const r = await run(['--confirm-one-live-email']);
    expect(r.code).toBe(0);
    expect(seen.length).toBe(before + 1);
    const req = seen.at(-1)!;
    expect(req.headers.authorization).toBe(`Bearer ${KEY}`);
    const idem = String(req.headers['idempotency-key']);
    expect(idem).toMatch(/^hull-and-havoc-digest-delivery-test-\d{8}T\d{4}$/);
    expect(idem.startsWith(IDEMPOTENCY_PREFIX)).toBe(false);
    const body = JSON.parse(req.body);
    expect(body).toMatchObject({ from: 'Hull & Havoc <moderation@digest.test>', to: ['operator@digest.test'], subject: 'Hull & Havoc — moderation digest delivery test' });
    expect(r.out).toContain('"status":"sent"');
    expect(r.out).not.toContain(KEY);
  });

  it('reports provider errors by status and name only, and refuses non-loopback http', async () => {
    status = 422;
    const r = await run(['--confirm-one-live-email']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('http_422:validation_error');
    expect(r.out).not.toContain(KEY);
    const before = seen.length;
    const insecure = await run(['--confirm-one-live-email'], { RESEND_API_URL: 'http://mail.example/emails' });
    expect(insecure.code).toBe(1);
    expect(insecure.out).toContain('must be https or loopback http');
    expect(seen.length).toBe(before);
  });
});
