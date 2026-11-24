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
  receipt_image TEXT,
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
  receipt_image TEXT,
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
  receipt_image TEXT,
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
  receipt_image TEXT,
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

CREATE TABLE IF NOT EXISTS bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  bank TEXT,
  branch TEXT,
  iban TEXT,
  account_no TEXT,
  balance_rial INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  assignee TEXT,
  deadline TEXT,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'در انتظار انجام',
  report TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_name TEXT,
  question TEXT NOT NULL,
  answer TEXT,
  status TEXT NOT NULL DEFAULT 'در انتظار پاسخ',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at TEXT
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

// Migration for databases created before receipt photos existed: add the
// receipt_image column (a data URL stored with the record) wherever missing.
for (const table of ['events', 'expenses', 'income', 'payroll']) {
  try {
    const cols = db.pragma(`table_info(${table})`);
    if (Array.isArray(cols) && !cols.some((c) => c.name === 'receipt_image')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN receipt_image TEXT`);
      console.log(`[db] migrated: added receipt_image to ${table}`);
    }
  } catch (e) {
    console.warn(`[db] receipt_image migration check failed for ${table}:`, e.message);
  }
}

// Receipt images travel as data URLs (the client compresses to JPEG first).
const RECEIPT_IMAGE_MAX = 2000000;
function validateReceiptImage(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !v.startsWith('data:image/') || v.length > RECEIPT_IMAGE_MAX) {
    return 'عکس رسید نامعتبر است؛ یک فایل تصویری با حجم مجاز انتخاب کنید';
  }
  return null;
}

// Register definitions: API kind -> table + writable columns.
const REGISTERS = {
  expenses: {
    table: 'expenses',
    columns: ['date_shamsi', 'time_ir', 'person', 'telegram_ref', 'description',
      'amount_rial', 'category', 'payment_method', 'tracking_no', 'receipt_date_time',
      'receipt_status', 'review_status', 'record_folder', 'notes', 'receipt_image'],
  },
  income: {
    table: 'income',
    columns: ['date_shamsi', 'time_ir', 'person', 'telegram_ref', 'description',
      'amount_rial', 'account_dest', 'payment_method', 'tracking_no', 'receipt_date_time',
      'receipt_status', 'review_status', 'record_folder', 'notes', 'receipt_image'],
  },
  payroll: {
    table: 'payroll',
    columns: ['date_shamsi', 'time_ir', 'person', 'telegram_ref', 'description',
      'basis', 'amount_rial', 'payment_method', 'tracking_no', 'receipt_date_time',
      'receipt_status', 'review_status', 'record_folder', 'notes', 'receipt_image'],
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
  if (out.receipt_image !== undefined) {
    const imgError = validateReceiptImage(out.receipt_image);
    if (imgError) return { error: imgError };
    if (!out.receipt_image) delete out.receipt_image; // '' or null means: no image
  }
  return { data: out };
}

function insertRegisterRow(kind, data, eventId) {
  const { data: clean, error } = pickColumns(kind, data || {});
  if (error) return { error };
  if (clean.receipt_status === undefined) clean.receipt_status = (clean.receipt_image || clean.tracking_no) ? 'دارد' : 'ندارد';
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

// ---------- Bank accounts ----------
// balance_rial is the OPENING balance recorded when the account is created
// (a snapshot, not a live bank feed); the analytics cash total sums these.
function insertBankAccount(data) {
  const b = data || {};
  if (!b.name || !String(b.name).trim()) return { error: 'نام حساب لازم است' };
  const balance = toIntAmount(b.balance_rial);
  if (balance === null || balance < 0) return { error: 'مبلغ نامعتبر است' };
  const info = db.prepare(
    'INSERT INTO bank_accounts (name, bank, branch, iban, account_no, balance_rial, notes) VALUES (?,?,?,?,?,?,?)'
  ).run(String(b.name), b.bank || '', b.branch || '', b.iban || '', b.account_no || '', balance, b.notes || '');
  return { row: db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(info.lastInsertRowid) };
}

function listBankAccounts(limit = 500) {
  return db.prepare('SELECT * FROM bank_accounts ORDER BY id DESC LIMIT ?').all(limit);
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
  // The event keeps its own copy of the receipt photo (payload / column);
  // the register row created from it inherits the same image.
  if (!merged.receipt_image && ev.receipt_image) merged.receipt_image = ev.receipt_image;
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
  const cashRow = db.prepare('SELECT COALESCE(SUM(balance_rial),0) AS s, COUNT(*) AS c FROM bank_accounts').get();
  return {
    cash: {
      accounts: cashRow.c,
      total_rial: cashRow.s,
    },
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
      customers_without_id: db.prepare("SELECT COUNT(*) AS c FROM customers WHERE national_id IS NULL OR TRIM(national_id) = ''").get().c,
      products: db.prepare('SELECT COUNT(*) AS c FROM products').get().c,
      ledger_items: db.prepare('SELECT COUNT(*) AS c FROM ledger_items').get().c,
      questions_total: db.prepare('SELECT COUNT(*) AS c FROM questions').get().c,
      questions_open: db.prepare("SELECT COUNT(*) AS c FROM questions WHERE status != 'پاسخ داده شد'").get().c,
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

// ---------- Management questions migration ----------
// The 20 official finance questions originally lived inside knowledge_entries
// (titles «پرسش مدیریت N. …», body «گروه: …»). They now have their own module.
// Idempotent: runs only while the questions table is empty. Seeds from
// data/questions-seed.json and deletes the matching knowledge entries (matched
// by their original title), so the knowledge base returns to rules/findings
// only. On a fresh install — no matching knowledge rows — the questions are
// seeded from the file alone. The currency-unit question is pre-answered
// («ریال», management's recorded decision), so 19 of 20 start open.
function loadQuestionsSeed() {
  try {
    const list = require('../data/questions-seed.json');
    return Array.isArray(list) && list.length ? list : null;
  } catch (e) {
    console.warn('[db] questions-seed.json could not be loaded:', e.message);
    return null;
  }
}

// Insert the full seed set into an (empty) questions table and return how
// many were inserted. The currency-unit question is pre-answered («ریال»),
// so a fresh seed always yields 20 questions, 19 of them open.
function seedQuestions() {
  const seedList = loadQuestionsSeed();
  if (!seedList) return 0;
  const ins = db.prepare('INSERT INTO questions (group_name, question, answer, status, answered_at) VALUES (?,?,?,?,?)');
  for (const q of seedList) {
    ins.run(
      q.group_name || '',
      q.question,
      q.answer || null,
      q.status || 'در انتظار پاسخ',
      q.answer ? new Date().toISOString() : null
    );
  }
  return seedList.length;
}

function migrateQuestions() {
  const seedList = loadQuestionsSeed();
  if (!seedList) return;
  const existing = db.prepare('SELECT COUNT(*) AS c FROM questions').get().c;
  if (existing > 0) return;
  const delByTitle = db.prepare('DELETE FROM knowledge_entries WHERE title = ?');
  const work = () => {
    seedQuestions();
    let removed = 0;
    for (const q of seedList) {
      if (q.source_title) removed += delByTitle.run(q.source_title).changes;
    }
    console.log(`[db] questions migration: seeded ${seedList.length} questions, removed ${removed} question entries from knowledge`);
  };
  if (typeof db.transaction === 'function') db.transaction(work)(); else work();
}

migrateQuestions();

// ---------- Factory reset (agent-only, POST /api/agent/reset) ----------
// Wipes every business-data table back to day one in a single transaction:
// intake events, the three registers, ledgers, customers, products, bank
// accounts, tasks, questions, knowledge and the audit log. The users table is NEVER touched,
// so the admin login survives. Afterwards the 20 management questions are
// reseeded from data/questions-seed.json (19 open, currency question
// pre-answered «ریال»). Delete order matters: the registers reference
// events(id), so children are deleted before events.
const RESET_TABLES = [
  'expenses', 'income', 'payroll', 'events', 'ledger_items', 'customers',
  'products', 'bank_accounts', 'tasks', 'questions', 'knowledge_entries', 'audit_log',
];

function resetAllData() {
  const deleted = {};
  let reseeded = 0;
  const work = () => {
    for (const t of RESET_TABLES) {
      deleted[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
      db.exec(`DELETE FROM ${t}`);
    }
    try {
      const names = RESET_TABLES.map((t) => `'${t}'`).join(',');
      db.exec(`DELETE FROM sqlite_sequence WHERE name IN (${names})`);
    } catch (_) { /* sqlite_sequence may not exist — ids just keep counting */ }
    reseeded = seedQuestions();
  };
  if (typeof db.transaction === 'function') db.transaction(work)(); else work();
  return { deleted, questions_reseeded: reseeded };
}

module.exports = {
  db, REGISTERS, EVENT_TYPE_TO_REGISTER, pickColumns, insertRegisterRow,
  listRegisterRows, insertBankAccount, listBankAccounts,
  classifyEvent, analyticsSummary, audit, toIntAmount,
  validateReceiptImage, RECEIPT_IMAGE_MAX, resetAllData,
};
