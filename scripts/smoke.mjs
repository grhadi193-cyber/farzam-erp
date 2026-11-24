// Farzam ERP — repeatable smoke test (no dependencies, plain Node).
//
// Boots `node server.js` against a throwaway database in a temp dir with
// test-only env (admin login, agent key), then asserts the critical paths
// over HTTP: auth (the F-01 regression class), the agent API, bank accounts,
// the B-09 ledger-aging buckets, and the guarded factory reset. Prints one
// PASS/FAIL line per check and exits non-zero on any failure. The child is
// always killed and the temp dir always removed.
//
// Run: npm test   (or: node scripts/smoke.mjs)

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3400 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = 'smoke-admin@example.com';
const ADMIN_PASSWORD = 'smoke-test-password';
const AGENT_KEY = 'smoke-agent-key';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function req(method, p, { token, agent, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (agent) headers.Authorization = `Bearer ${AGENT_KEY}`;
  const res = await fetch(BASE + p, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function waitForHealth(child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}`);
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
      lastErr = new Error(`HTTP ${r.status}`);
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not answer /health in time (last error: ${lastErr && (lastErr.message + (lastErr.cause ? ' / ' + lastErr.cause.message : ''))})`);
}

const dataDir = mkdtempSync(path.join(tmpdir(), 'farzam-smoke-'));
const env = { ...process.env };
delete env.TURSO_DATABASE_URL;
delete env.TURSO_AUTH_TOKEN;
delete env.VERCEL;
delete env.SEED_DEMO;
Object.assign(env, {
  DATA_DIR: dataDir,
  PORT: String(PORT),
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  PIP_AGENT_API_KEY: AGENT_KEY,
  JWT_SECRET: 'smoke-test-secret',
});

const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });

let failed = false;
try {
  await waitForHealth(child);
  check('health endpoint answers 200', true);

  const fake = await req('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'wrong' } });
  check('fake login is rejected with 401 (not 500)', fake.status === 401, `got ${fake.status}`);

  const login = await req('POST', '/api/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  check('admin login returns 200 with a token', login.status === 200 && !!login.data.token, `got ${login.status}`);
  const token = login.data.token;

  const me = await req('GET', '/api/auth/me', { token });
  check('/api/auth/me with the token returns 200', me.status === 200 && me.data.user && me.data.user.email === ADMIN_EMAIL, `got ${me.status}`);

  const analytics = await req('GET', '/api/agent/analytics/summary', { agent: true });
  check('agent analytics returns 200', analytics.status === 200, `got ${analytics.status}`);
  check('analytics seeds exactly 20 management questions',
    analytics.status === 200 && analytics.data.counts && analytics.data.counts.questions_total === 20,
    `questions_total=${analytics.data.counts && analytics.data.counts.questions_total}`);
  check('analytics exposes ledger_aging buckets and review signals',
    analytics.status === 200 && !!analytics.data.ledger_aging && !!analytics.data.ledger_aging.buckets
      && !!analytics.data.review && typeof analytics.data.review.reused_tracking_numbers === 'number',
    '');

  const bank = await req('POST', '/api/agent/bank-accounts', {
    agent: true,
    body: { name: 'حساب آزمایشی اسموک', bank: 'بانک تست', balance_rial: 123456 },
  });
  check('agent bank-account create returns 201', bank.status === 201, `got ${bank.status}`);
  const banks = await req('GET', '/api/agent/bank-accounts', { agent: true });
  check('bank-account list contains the created account',
    banks.status === 200 && Array.isArray(banks.data) && banks.data.some((b) => b.id === (bank.data && bank.data.id)),
    '');

  // B-09 fixture: a clearly past Jalali due date must land in an overdue
  // bucket; an item with no due date must land in no_due_date.
  const past = await req('POST', '/api/agent/ledgers', {
    agent: true,
    body: { kind: 'receivable', party: 'طرف آزمایشی', description: 'سررسید گذشته (فیکسچر اسموک)', amount_rial: 1000, due_date_shamsi: '1405/01/01' },
  });
  check('agent ledger create (past due date) returns 201', past.status === 201, `got ${past.status}`);
  const noDate = await req('POST', '/api/agent/ledgers', {
    agent: true,
    body: { kind: 'receivable', party: 'طرف آزمایشی', description: 'بدون سررسید (فیکسچر اسموک)', amount_rial: 2000 },
  });
  check('agent ledger create (no due date) returns 201', noDate.status === 201, `got ${noDate.status}`);
  const agingRes = await req('GET', '/api/agent/analytics/summary', { agent: true });
  const byKind = (agingRes.data.ledger_aging || {}).by_kind || {};
  const recAging = byKind.receivable || {};
  const overdueCount = ['overdue_1_30', 'overdue_31_90', 'overdue_90_plus']
    .reduce((a, k) => a + ((recAging[k] || {}).count || 0), 0);
  check('past-due ledger item lands in an overdue bucket', overdueCount >= 1, `overdue receivable count=${overdueCount}`);
  check('no-due-date ledger item lands in no_due_date',
    ((recAging.no_due_date || {}).count || 0) >= 1,
    `no_due_date receivable count=${(recAging.no_due_date || {}).count}`);

  const reset = await req('POST', '/api/agent/reset', { agent: true, body: { confirm: 'RESET' } });
  check('agent factory reset returns 200', reset.status === 200, `got ${reset.status}`);

  const login2 = await req('POST', '/api/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  check('admin login still works after reset (users kept)', login2.status === 200 && !!login2.data.token, `got ${login2.status}`);
} catch (e) {
  failed = true;
  console.log(`FAIL  smoke run aborted — ${e.message}`);
  console.log('--- server log ---\n' + serverLog);
} finally {
  try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
  rmSync(dataDir, { recursive: true, force: true });
}

const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} checks passed`);
process.exit(failed || bad > 0 ? 1 : 0);
