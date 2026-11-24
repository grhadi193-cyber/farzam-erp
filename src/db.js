'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('libsql');
const bcrypt = require('bcryptjs');

let db;
if (process.env.TURSO_DATABASE_URL) {
  // Remote libSQL (e.g. Turso) — for serverless hosts like Vercel, where the
  // local filesystem does not persist between requests.
  db = new Database(process.env.TURSO_DATABASE_URL, {
    authToken: process.env.TURSO_AUTH_TOKEN || '',
  });
} else if (process.env.VERCEL) {
  // Vercel without a remote database: the deployment bundle is read-only, so
  // fall back to /tmp. The app boots and works, but data resets on cold
  // starts — set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN for persistence.
  db = new Database('/tmp/farzam.db');
  console.warn('[db] TURSO_DATABASE_URL is not set: using ephemeral /tmp storage on Vercel. Data will reset — set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN for a persistent database.');
} else {
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'farzam.db');
  db = new Database(DB_PATH);
  try { db.pragma('journal_mode = WAL'); } catch (_) { /* not supported everywhere */ }
}
try { db.pragma('foreign_keys = ON'); } catch (_) {
  try { db.exec('PRAGMA foreign_keys = ON'); } catch (_) { /* ignore */ }
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','finance','employee','viewer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'manual',
  sender_name TEXT,
  sender_ref TEXT,
  raw_text TEXT,
  event_type TEXT CHECK (event_type IN ('expense','income','payroll','unclear') OR event_type IS NULL),
  status TEXT NOT NULL DEFAULT 'unprocessed' CHECK (status IN ('unprocessed','registered','needs_review')),
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER REFERENCES events(id),
  date_shamsi TEXT,
  time_ir TEXT,
  person TEXT,
  telegram_ref TEXT,
  description TEXT,
  amount_rial INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  payment_method TEXT,
  tracking_no TEXT,
  receipt_date_time TEXT,
  receipt_status TEXT NOT NULL DEFAULT 'ندارد',
  review_status TEXT NOT NULL DEFAULT 'در انتظار بررسی',
  record_folder TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS income (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER REFERENCES events(id),
  date_shamsi TEXT,
  time_ir TEXT,
  person TEXT,
  telegram_ref TEXT,
  description TEXT,
  amount_rial INTEGER NOT NULL DEFAULT 0,
  account_dest TEXT,
  payment_method TEXT,
  tracking_no TEXT,
  receipt_date_time TEXT,
  receipt_status TEXT NOT NULL DEFAULT 'ندارد',
  review_status TEXT NOT NULL DEFAULT 'در انتظار بررسی',
  record_folder TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payroll (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER REFERENCES events(id),
  date_shamsi TEXT,
  time_ir TEXT,
  person TEXT,
  telegram_ref TEXT,
  description TEXT,
  basis TEXT,
  amount_rial INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT,
  tracking_no TEXT,
  receipt_date_time TEXT,
  receipt_status TEXT NOT NULL DEFAULT 'ندارد',
  review_status TEXT NOT NULL DEFAULT 'در انتظار بررسی',
  record_folder TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ledger_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('receivable','payable','cheque')),
  party TEXT,
  description TEXT,
  amount_rial INTEGER NOT NULL DEFAULT 0,
  due_date_shamsi TEXT,
  status TEXT NOT NULL DEFAULT 'باز',
  cheque_sayad_no TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT,
  national_id TEXT,
  phone TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT,
  unit TEXT,
  sale_price_rial INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT,
  kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('rule','answer','note')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Register definitions: API kind -> table + writable columns.
const REGISTERS = {
  expenses: {
    table: 'expenses',
    columns: ['date_shamsi', 'time_ir', 'person', 'telegram_ref', 'description',
      'amount_rial', 'category', 'payment_method', 'tracking_no', 'receipt_date_time',
      'receipt_status', 'review_status', 'record_folder', 'notes'],
  },
  income: {
    table: 'income',
    columns: ['date_shamsi', 'time_ir', 'person', 'telegram_ref', 'description',
      'amount_rial', 'account_dest', 'payment_method', 'tracking_no', 'receipt_date_time',
      'receipt_status', 'review_status', 'record_folder', 'notes'],
  },
  payroll: {
    table: 'payroll',
    columns: ['date_shamsi', 'time_ir', 'person', 'telegram_ref', 'description',
      'basis', 'amount_rial', 'payment_method', 'tracking_no', 'receipt_date_time',
      'receipt_status', 'review_status', 'record_folder', 'notes'],
  },
};

// event_type -> register kind
const EVENT_TYPE_TO_REGISTER = { expense: 'expenses', income: 'income', payroll: 'payroll' };

function toIntAmount(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(/[^\d-]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function pickColumns(kind, data) {
  const out = {};
  for (const col of REGISTERS[kind].columns) {
    if (data[col] !== undefined) out[col] = data[col];
  }
  if (out.amount_rial !== undefined) {
    const amt = toIntAmount(out.amount_rial);
    if (amt === null || amt < 0) return { error: 'مبلغ نامعتبر است' };
    out.amount_rial = amt;
  }
  return { data: out };
}

function insertRegisterRow(kind, data, eventId) {
  const { data: clean, error } = pickColumns(kind, data || {});
  if (error) return { error };
  if (clean.receipt_status === undefined) clean.receipt_status = clean.tracking_no ? 'دارد' : 'ندارد';
  if (clean.review_status === undefined) clean.review_status = 'در انتظار بررسی';
  if (clean.amount_rial === undefined) clean.amount_rial = 0;
  const cols = Object.keys(clean);
  const allCols = eventId ? ['event_id', ...cols] : cols;
  const values = eventId ? [eventId, ...cols.map((c) => clean[c])] : cols.map((c) => clean[c]);
  const sql = `INSERT INTO ${REGISTERS[kind].table} (${allCols.join(',')}) VALUES (${allCols.map(() => '?').join(',')})`;
  const info = db.prepare(sql).run(...values);
  return { row: db.prepare(`SELECT * FROM ${REGISTERS[kind].table} WHERE id = ?`).get(info.lastInsertRowid) };
}

function listRegisterRows(kind, limit = 500) {
  return db.prepare(`SELECT * FROM ${REGISTERS[kind].table} ORDER BY id DESC LIMIT ?`).all(limit);
}

function audit(actor, action, entity, entityId) {
  db.prepare('INSERT INTO audit_log (actor, action, entity, entity_id) VALUES (?,?,?,?)')
    .run(actor, action, entity || null, entityId || null);
}

// Classify an intake event: set its type and (for real types) create the register row.
function classifyEvent(eventId, input, actor) {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!ev) return { status: 404, body: { error: 'رویداد پیدا نشد' } };
  if (ev.status === 'registered') return { status: 409, body: { error: 'این رویداد قبلاً ثبت شده است' } };
  const type = input.event_type;
  if (!['expense', 'income', 'payroll', 'unclear'].includes(type)) {
    return { status: 400, body: { error: 'نوع رویداد نامعتبر است' } };
  }
  let payload = {};
  try { payload = ev.payload ? JSON.parse(ev.payload) : {}; } catch (_) { payload = {}; }
  if (type === 'unclear') {
    db.prepare("UPDATE events SET event_type = 'unclear', status = 'needs_review' WHERE id = ?").run(eventId);
    if (actor) audit(actor, 'classify_unclear', 'events', eventId);
    return { status: 200, body: { event: db.prepare('SELECT * FROM events WHERE id = ?').get(eventId), register_row: null } };
  }
  const kind = EVENT_TYPE_TO_REGISTER[type];
  const merged = {
    description: ev.raw_text || '',
    person: ev.sender_name || '',
    telegram_ref: ev.sender_ref || '',
    ...payload,
    ...(input.register || input),
  };
  delete merged.event_type;
  const { row, error } = insertRegisterRow(kind, merged, eventId);
  if (error) return { status: 400, body: { error } };
  db.prepare("UPDATE events SET event_type = ?, status = 'registered' WHERE id = ?").run(type, eventId);
  if (actor) audit(actor, 'classify', 'events', eventId);
  return { status: 200, body: { event: db.prepare('SELECT * FROM events WHERE id = ?').get(eventId), register_row: row } };
}

function analyticsSummary() {
  const sum = (t) => db.prepare(`SELECT COALESCE(SUM(amount_rial),0) AS s, COUNT(*) AS c FROM ${t}`).get();
  const exp = sum('expenses');
  const inc = sum('income');
  const pay = sum('payroll');
  const byCategory = db.prepare(
    "SELECT COALESCE(NULLIF(category,''),'بدون دسته') AS category, COALESCE(SUM(amount_rial),0) AS total, COUNT(*) AS count FROM expenses GROUP BY category ORDER BY total DESC"
  ).all();
  const eventCounts = db.prepare('SELECT status, COUNT(*) AS c FROM events GROUP BY status').all();
  const counts = { unprocessed: 0, registered: 0, needs_review: 0 };
  for (const r of eventCounts) counts[r.status] = r.c;
  const unclear = db.prepare("SELECT COUNT(*) AS c FROM events WHERE event_type = 'unclear' OR status = 'needs_review'").get().c;
  const ledgerOpen = db.prepare("SELECT kind, COALESCE(SUM(amount_rial),0) AS total, COUNT(*) AS count FROM ledger_items WHERE status = 'باز' GROUP BY kind").all();
  return {
    totals: {
      expenses_rial: exp.s,
      income_rial: inc.s,
      payroll_rial: pay.s,
      net_rial: inc.s - exp.s - pay.s,
    },
    counts: {
      expenses: exp.c,
      income: inc.c,
      payroll: pay.c,
      customers: db.prepare('SELECT COUNT(*) AS c FROM customers').get().c,
      products: db.prepare('SELECT COUNT(*) AS c FROM products').get().c,
      ledger_items: db.prepare('SELECT COUNT(*) AS c FROM ledger_items').get().c,
    },
    events: counts,
    unclear_count: unclear,
    expenses_by_category: byCategory,
    ledger_open: ledgerOpen,
  };
}

function seed() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (!existing) {
      const hash = bcrypt.hashSync(password, 10);
      db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
        .run(process.env.ADMIN_NAME || 'مدیر سیستم', email, hash, 'admin');
      console.log(`[seed] admin user created: ${email}`);
    }
  } else {
    console.warn('[seed] ADMIN_EMAIL / ADMIN_PASSWORD not set — no admin user seeded. Set them in .env to create the first login.');
  }

  if (String(process.env.SEED_DEMO).toLowerCase() === 'true') {
    const n = db.prepare('SELECT COUNT(*) AS c FROM expenses').get().c;
    if (n === 0) {
      insertRegisterRow('expenses', {
        date_shamsi: '۱۴۰۵/۰۹/۰۱', time_ir: '۱۰:۱۵', person: 'کارمند نمونه', telegram_ref: '@demo',
        description: 'خرید نمونه — اقلام اداری (داده آزمایشی)', amount_rial: 2500000, category: 'خرید',
        payment_method: 'کارت شرکت', receipt_status: 'دارد', review_status: 'تأیید شده', notes: 'نمونه',
      });
      insertRegisterRow('income', {
        date_shamsi: '۱۴۰۵/۰۹/۰۱', time_ir: '۱۱:۰۰', person: 'مشتری نمونه', telegram_ref: '',
        description: 'فروش نمونه (داده آزمایشی)', amount_rial: 45000000, payment_method: 'واریز به حساب',
        receipt_status: 'دارد', review_status: 'تأیید شده', notes: 'نمونه',
      });
      insertRegisterRow('payroll', {
        date_shamsi: '۱۴۰۵/۰۹/۰۱', time_ir: '۱۲:۰۰', person: 'کارمند نمونه', telegram_ref: '@demo',
        description: 'حقوق نمونه (داده آزمایشی)', basis: 'حقوق آبان', amount_rial: 250000000,
        payment_method: 'واریز بانکی', receipt_status: 'دارد', review_status: 'تأیید شده', notes: 'نمونه',
      });
      db.prepare('INSERT INTO events (source, sender_name, sender_ref, raw_text, status) VALUES (?,?,?,?,?)')
        .run('manual', 'کارمند نمونه', '@demo', 'خریدیم نمونه — سه کارتن کاغذ، ۲ میلیون تومان (داده آزمایشی)', 'unprocessed');
      db.prepare('INSERT INTO customers (name, code, national_id, phone, notes) VALUES (?,?,?,?,?)')
        .run('مشتری نمونه', '9001', '', '', 'نمونه');
      db.prepare('INSERT INTO products (name, code, unit, sale_price_rial, notes) VALUES (?,?,?,?,?)')
        .run('کالای نمونه', '90001', 'عدد', 10000000, 'نمونه');
      db.prepare('INSERT INTO knowledge_entries (title, body, kind) VALUES (?,?,?)')
        .run('قاعده نمونه', 'این یک رکورد آزمایشی است و داده واقعی شرکت نیست.', 'rule');
      console.log('[seed] demo data inserted (SEED_DEMO=true)');
    }
  }
}

seed();

module.exports = {
  db, REGISTERS, EVENT_TYPE_TO_REGISTER, pickColumns, insertRegisterRow,
  listRegisterRows, classifyEvent, analyticsSummary, audit, toIntAmount,
};
