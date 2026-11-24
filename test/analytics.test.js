'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farzam-test-'));
process.env.DATA_DIR = dir;
process.env.SEED_DEMO = 'false';
delete process.env.TURSO_DATABASE_URL;
const { db, analyticsSummary } = require('../src/db');
after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('dashboard review metrics cover all rows, not just the latest 500', () => {
  const insert = db.prepare('INSERT INTO expenses (amount_rial, review_status, receipt_status) VALUES (?, ?, ?)');
  insert.run(250, 'تکراری در انتظار بررسی', 'ندارد');
  for (let i = 0; i < 501; i++) insert.run(100, 'تأیید شده', 'دارد');
  db.prepare('INSERT INTO income (amount_rial, review_status) VALUES (?, ?)').run(1000, 'در انتظار بررسی');
  db.prepare('INSERT INTO payroll (amount_rial, review_status) VALUES (?, ?)').run(500, 'تأیید شده');
  const summary = analyticsSummary();
  assert.equal(summary.totals.expenses_rial, 50350);
  assert.equal(summary.counts.expenses, 502);
  assert.deepEqual(summary.review, { duplicate_expenses_rial: 250, expenses_without_receipt: 1, attention_count: 2 });
});
