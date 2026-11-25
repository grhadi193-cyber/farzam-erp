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

// ---------- users table self-heal ----------
// CREATE TABLE IF NOT EXISTS never alters an existing table, so a database
// whose `users` table predates the current schema (e.g. an early version
// with differently-named columns) keeps the old shape forever — and every
// query against the new columns throws ("no such column: email"), which
// surfaced in production as a 500 on POST /api/auth/login for EVERY login
// attempt, even for nonexistent users. Repair at boot, before seed() runs:
// if any required column is missing, rename the old table aside (it is
// never dropped), create a fresh table with the current schema, and copy
// over whatever columns exist in both. No other table is touched.
const USERS_REQUIRED_COLUMNS = ['id', 'name', 'email', 'password_hash', 'role', 'created_at'];
const USERS_CREATE_SQL = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','finance','employee','viewer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

function repairUsersTable() {
  let cols = null;
  try { cols = db.pragma('table_info(users)'); } catch (e) {
    console.warn('[db] users schema check failed:', e.message);
    return;
  }
  if (!Array.isArray(cols) || cols.length === 0) {
    // No users table at all (the CREATE TABLE IF NOT EXISTS above should
    // have made one, but never leave login broken if it somehow did not).
    try {
      db.exec(USERS_CREATE_SQL);
      console.warn('[db] users table was missing — created it with the current schema');
    } catch (e) {
      console.warn('[db] could not create the users table:', e.message);
    }
    return;
  }
  const existing = cols.map((c) => c.name);
  const missing = USERS_REQUIRED_COLUMNS.filter((c) => !existing.includes(c));
  if (missing.length === 0) return; // schema is current — nothing to do

  // Pick a legacy name that is not already taken.
  let legacy = 'users_legacy';
  try {
    const taken = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'users_legacy%'")
      .all().map((r) => r.name);
    if (taken.includes(legacy)) {
      let i = 2;
      while (taken.includes(`${legacy}_${i}`)) i += 1;
      legacy = `${legacy}_${i}`;
    }
  } catch (_) { /* fall back to the plain name */ }

  console.warn(`[db] users table is missing required column(s): ${missing.join(', ')} — renaming it to ${legacy} and rebuilding with the current schema`);
  const shared = USERS_REQUIRED_COLUMNS.filter((c) => existing.includes(c));
  const work = () => {
    db.exec(`ALTER TABLE users RENAME TO ${legacy}`);
    db.exec(USERS_CREATE_SQL);
    if (shared.includes('email') && shared.includes('password_hash')) {
      // Copy the columns that exist in both schemas. `name` is NOT NULL
      // with no default, so when the old table lacks it, fill '' so
      // salvageable rows still satisfy the new constraints; role and
      // created_at fall back to their defaults when absent.
      const insertCols = [...shared];
      const selectExprs = shared.map((c) => `"${c}"`);
      if (!insertCols.includes('name')) { insertCols.push('name'); selectExprs.push("''"); }
      try {
        const info = db.prepare(
          `INSERT INTO users (${insertCols.join(',')}) SELECT ${selectExprs.join(',')} FROM ${legacy}`
        ).run();
        console.warn(`[db] users repair: copied ${info.changes} row(s) from ${legacy} into the rebuilt users table`);
      } catch (e) {
        // e.g. duplicate/NULL emails in the legacy data — retry row by row
        // so every salvageable account survives; the rest stays in legacy.
        const rows = db.prepare(`SELECT ${shared.map((c) => `"${c}"`).join(',')} FROM ${legacy}`).all();
        const ins = db.prepare(
          `INSERT OR IGNORE INTO users (${insertCols.join(',')}) VALUES (${insertCols.map(() => '?').join(',')})`
        );
        let copied = 0;
        for (const row of rows) {
          copied += ins.run(...insertCols.map((c) => (shared.includes(c) ? row[c] : ''))).changes;
        }
        console.warn(`[db] users repair: bulk copy failed (${e.message}); salvaged ${copied} of ${rows.length} row(s) row-by-row — the rest remain in ${legacy}`);
      }
    } else {
      console.warn(`[db] users repair: legacy table ${legacy} has no email/password_hash columns to salvage — its rows were left untouched in ${legacy}`);
    }
  };
  try {
    if (typeof db.transaction === 'function') db.transaction(work)(); else work();
  } catch (e) {
    console.warn('[db] users repair failed (old table left as-is):', e.message);
  }
}

repairUsersTable();

// ---------- General schema verification (read-only, all tables) ----------
// The users repair above exists because CREATE TABLE IF NOT EXISTS never
// upgrades an existing table: a stale table keeps its old columns forever
// and queries against newer columns throw at runtime. The same silent
// failure could hit any table after a future column addition, so at boot we
// PRAGMA-compare every table against the columns the code expects and log a
// LOUD, specific warning per missing column. This check NEVER alters a
// table (auto-repair stays users-only); it only makes the drift visible in
// the boot log instead of as a 500 on some later request. Failure-isolated:
// an error here must never break boot.
const EXPECTED_COLUMNS = {
  users: USERS_REQUIRED_COLUMNS,
  events: ['id', 'source', 'sender_name', 'sender_ref', 'raw_text', 'event_type', 'status', 'payload', 'receipt_image', 'created_at'],
  expenses: ['id', 'event_id', 'date_shamsi', 'time_ir', 'person', 'telegram_ref', 'description', 'amount_rial', 'category', 'payment_method', 'tracking_no', 'receipt_date_time', 'receipt_status', 'review_status', 'record_folder', 'notes', 'receipt_image', 'created_at'],
  income: ['id', 'event_id', 'date_shamsi', 'time_ir', 'person', 'telegram_ref', 'description', 'amount_rial', 'account_dest', 'payment_method', 'tracking_no', 'receipt_date_time', 'receipt_status', 'review_status', 'record_folder', 'notes', 'receipt_image', 'created_at'],
  payroll: ['id', 'event_id', 'date_shamsi', 'time_ir', 'person', 'telegram_ref', 'description', 'basis', 'amount_rial', 'payment_method', 'tracking_no', 'receipt_date_time', 'receipt_status', 'review_status', 'record_folder', 'notes', 'receipt_image', 'created_at'],
  ledger_items: ['id', 'kind', 'party', 'description', 'amount_rial', 'due_date_shamsi', 'status', 'cheque_sayad_no', 'created_at'],
  customers: ['id', 'name', 'code', 'national_id', 'phone', 'notes', 'created_at'],
  products: ['id', 'name', 'code', 'unit', 'sale_price_rial', 'notes', 'created_at'],
  bank_accounts: ['id', 'name', 'bank', 'branch', 'iban', 'account_no', 'balance_rial', 'notes', 'created_at'],
  knowledge_entries: ['id', 'title', 'body', 'kind', 'created_at'],
  tasks: ['id', 'title', 'assignee', 'deadline', 'details', 'status', 'report', 'created_by', 'created_at', 'updated_at'],
  questions: ['id', 'group_name', 'question', 'answer', 'status', 'created_at', 'answered_at'],
  audit_log: ['id', 'actor', 'action', 'entity', 'entity_id', 'created_at'],
};

function verifySchema() {
  for (const [table, expected] of Object.entries(EXPECTED_COLUMNS)) {
    let cols = null;
    try { cols = db.pragma(`table_info(${table})`); } catch (e) {
      console.warn(`[db] SCHEMA WARNING: could not inspect table "${table}":`, e.message);
      continue;
    }
    if (!Array.isArray(cols) || cols.length === 0) {
      console.warn(`[db] SCHEMA WARNING: table "${table}" is missing entirely (expected columns: ${expected.join(', ')}) — no automatic alteration was made`);
      continue;
    }
    const existing = cols.map((c) => c.name);
    for (const col of expected) {
      if (!existing.includes(col)) {
        console.warn(`[db] SCHEMA WARNING: table "${table}" is missing column "${col}" — queries using it will fail; no automatic alteration was made`);
      }
    }
  }
}

try { verifySchema(); } catch (e) {
  console.warn('[db] schema verification failed (boot continues):', e.message);
}

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

// ---------- Jalali due-date parsing (deterministic, no LLM math) ----------
// due_date_shamsi is free text; accept Latin, Persian or Arabic digits and
// '/' or '-' separators. Anything unparseable returns null and the item
// falls into the no_due_date aging bucket — never guessed.
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
function latinDigits(s) {
  return String(s ?? '')
    .replace(/[۰-۹]/g, (d) => FA_DIGITS.indexOf(d))
    .replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d));
}
const toFaDigits = (s) => String(s).replace(/\d/g, (d) => FA_DIGITS[d]);

// Arithmetic Jalali day number (33-year-cycle algorithm). Only DIFFERENCES
// between two day numbers are ever used, and "today" is converted with this
// same function, so aging buckets are exact regardless of the epoch offset.
function jalaliDayNumber(y, m, d) {
  const gy = y + 1595;
  let days = -355668 + 365 * gy + Math.floor(gy / 33) * 8 + Math.floor(((gy % 33) + 3) / 4) + d;
  days += m < 7 ? (m - 1) * 31 : (m - 7) * 30 + 186;
  return days;
}

function parseJalaliDate(text) {
  const m = latinDigits(text).match(/(\d{3,4})\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > (mo <= 6 ? 31 : 30)) return null;
  return { y, m: mo, d, dayNumber: jalaliDayNumber(y, mo, d) };
}

// Today's Jalali date in Asia/Tehran via the ICU Persian calendar.
function todayJalali() {
  try {
    const parts = new Intl.DateTimeFormat('en-u-ca-persian', {
      timeZone: 'Asia/Tehran', year: 'numeric', month: 'numeric', day: 'numeric',
    }).formatToParts(new Date());
    const get = (t) => Number(parts.find((p) => p.type === t).value);
    const y = get('year');
    const m = get('month');
    const d = get('day');
    return { y, m, d, dayNumber: jalaliDayNumber(y, m, d) };
  } catch (_) { return null; }
}

function analyticsSummary() {
  // Aggregate the dashboard's review metrics in SQL instead of transferring
  // hundreds of register rows (and their potentially large receipt images).
  const registerSummary = (table) => db.prepare(`SELECT
    COALESCE(SUM(amount_rial), 0) AS s, COUNT(*) AS c,
    COALESCE(SUM(CASE WHEN COALESCE(review_status, '') != 'تأیید شده' THEN 1 ELSE 0 END), 0) AS attention,
    COALESCE(SUM(CASE WHEN COALESCE(review_status, '') LIKE '%تکراری%' THEN amount_rial ELSE 0 END), 0) AS duplicates,
    COALESCE(SUM(CASE WHEN receipt_status = 'ندارد' THEN 1 ELSE 0 END), 0) AS no_receipt
    FROM ${table}`).get();
  const exp = registerSummary('expenses');
  const inc = registerSummary('income');
  const pay = registerSummary('payroll');
  const byCategory = db.prepare(
    "SELECT COALESCE(NULLIF(category,''),'بدون دسته') AS category, COALESCE(SUM(amount_rial),0) AS total, COUNT(*) AS count FROM expenses GROUP BY category ORDER BY total DESC"
  ).all();
  const eventCounts = db.prepare('SELECT status, COUNT(*) AS c FROM events GROUP BY status').all();
  const counts = { unprocessed: 0, registered: 0, needs_review: 0 };
  for (const r of eventCounts) counts[r.status] = r.c;
  const unclear = db.prepare("SELECT COUNT(*) AS c FROM events WHERE event_type = 'unclear' OR status = 'needs_review'").get().c;
  const ledgerOpen = db.prepare("SELECT kind, COALESCE(SUM(amount_rial),0) AS total, COUNT(*) AS count FROM ledger_items WHERE status = 'باز' GROUP BY kind").all();
  const cashRow = db.prepare('SELECT COALESCE(SUM(balance_rial),0) AS s, COUNT(*) AS c FROM bank_accounts').get();
  // Ledger aging: open items bucketed by Jalali due date vs today
  // (Asia/Tehran). Items whose due date is missing or unparseable are
  // counted in no_due_date — never guessed into a dated bucket.
  const AGING_BUCKETS = ['no_due_date', 'current', 'overdue_1_30', 'overdue_31_90', 'overdue_90_plus'];
  const emptyAging = () => Object.fromEntries(AGING_BUCKETS.map((b) => [b, { count: 0, total_rial: 0 }]));
  const aging = emptyAging();
  const agingByKind = { receivable: emptyAging(), payable: emptyAging(), cheque: emptyAging() };
  const today = todayJalali();
  const openItems = db.prepare("SELECT kind, amount_rial, due_date_shamsi FROM ledger_items WHERE status = 'باز'").all();
  for (const it of openItems) {
    const parsed = parseJalaliDate(it.due_date_shamsi);
    let bucket = 'no_due_date';
    if (parsed && today) {
      const diff = today.dayNumber - parsed.dayNumber;
      bucket = diff <= 0 ? 'current' : diff <= 30 ? 'overdue_1_30' : diff <= 90 ? 'overdue_31_90' : 'overdue_90_plus';
    }
    const amt = Number(it.amount_rial || 0);
    aging[bucket].count += 1;
    aging[bucket].total_rial += amt;
    if (agingByKind[it.kind]) {
      agingByKind[it.kind][bucket].count += 1;
      agingByKind[it.kind][bucket].total_rial += amt;
    }
  }
  // Review / anomaly signals, computed server-side with the same definitions
  // the panel uses, so every consumer (UI, agent API, reports) reads one
  // consistent set instead of re-deriving them.
  const review = {
    duplicate_expenses_rial: db.prepare("SELECT COALESCE(SUM(amount_rial),0) AS s FROM expenses WHERE review_status LIKE '%تکراری%'").get().s,
    expenses_without_receipt: db.prepare("SELECT COUNT(*) AS c FROM expenses WHERE receipt_status = 'ندارد'").get().c,
    attention_count: db.prepare(
      "SELECT (SELECT COUNT(*) FROM expenses WHERE review_status != 'تأیید شده')"
      + " + (SELECT COUNT(*) FROM income WHERE review_status != 'تأیید شده')"
      + " + (SELECT COUNT(*) FROM payroll WHERE review_status != 'تأیید شده') AS c"
    ).get().c,
    // Distinct non-empty tracking numbers appearing on more than one row
    // across all three registers — the reused-receipt signature.
    reused_tracking_numbers: db.prepare(
      'SELECT COUNT(*) AS c FROM (SELECT tracking_no FROM ('
      + "SELECT tracking_no FROM expenses WHERE tracking_no IS NOT NULL AND TRIM(tracking_no) != '' "
      + "UNION ALL SELECT tracking_no FROM income WHERE tracking_no IS NOT NULL AND TRIM(tracking_no) != '' "
      + "UNION ALL SELECT tracking_no FROM payroll WHERE tracking_no IS NOT NULL AND TRIM(tracking_no) != ''"
      + ') GROUP BY tracking_no HAVING COUNT(*) > 1)'
    ).get().c,
    zero_amount_with_receipt: db.prepare(
      "SELECT (SELECT COUNT(*) FROM expenses WHERE amount_rial = 0 AND receipt_status = 'دارد')"
      + " + (SELECT COUNT(*) FROM income WHERE amount_rial = 0 AND receipt_status = 'دارد')"
      + " + (SELECT COUNT(*) FROM payroll WHERE amount_rial = 0 AND receipt_status = 'دارد') AS c"
    ).get().c,
  };
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
    review: { duplicate_expenses_rial: exp.duplicates, expenses_without_receipt: exp.no_receipt, attention_count: exp.attention + inc.attention + pay.attention },
    events: counts,
    unclear_count: unclear,
    expenses_by_category: byCategory,
    ledger_open: ledgerOpen,
    review,
    ledger_aging: {
      today_shamsi: today ? toFaDigits(`${today.y}/${String(today.m).padStart(2, '0')}/${String(today.d).padStart(2, '0')}`) : null,
      buckets: aging,
      by_kind: agingByKind,
    },
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
