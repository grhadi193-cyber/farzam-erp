'use strict';
// Minimal .env loader (no extra dependency): values in .env never override
// variables already set in the real environment (Docker Compose passes its own).
(function loadEnv() {
  const fs = require('fs');
  const p = require('path').join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const {
  db, REGISTERS, pickColumns, insertRegisterRow, listRegisterRows,
  classifyEvent, analyticsSummary, audit, toIntAmount,
} = require('./src/db');
const { signUser, requireAuth, requireRole, requireAgent } = require('./src/auth');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = Number(process.env.PORT || 3000);
const WRITE_ROLES = ['admin', 'finance'];
const EVENT_CREATE_ROLES = ['admin', 'finance', 'employee'];

app.get('/health', (req, res) => res.json({ ok: true, app: 'farzam-erp', time: new Date().toISOString() }));

// ---------- Auth ----------
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'ایمیل و رمز عبور لازم است' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'ایمیل یا رمز عبور نادرست است' });
  }
  return res.json({
    token: signUser(user),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.user.sub, name: req.user.name, email: req.user.email, role: req.user.role } });
});

// Admin-only user management (minimal).
app.get('/api/users', requireAuth, requireRole('admin'), (req, res) => {
  res.json(db.prepare('SELECT id, name, email, role, created_at FROM users ORDER BY id').all());
});

app.post('/api/users', requireAuth, requireRole('admin'), (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'نام، ایمیل و رمز عبور لازم است' });
  const r = ['admin', 'finance', 'employee', 'viewer'].includes(role) ? role : 'viewer';
  try {
    const info = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
      .run(String(name), String(email).trim().toLowerCase(), bcrypt.hashSync(String(password), 10), r);
    return res.status(201).json(db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    return res.status(409).json({ error: 'این ایمیل قبلاً ثبت شده است' });
  }
});

// ---------- Universal intake events ----------
app.get('/api/events', requireAuth, (req, res) => {
  const status = req.query.status;
  const rows = status
    ? db.prepare('SELECT * FROM events WHERE status = ? ORDER BY id DESC LIMIT 500').all(status)
    : db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 500').all();
  res.json(rows.map((r) => ({ ...r, payload: safeParse(r.payload) })));
});

app.post('/api/events', requireAuth, requireRole(...EVENT_CREATE_ROLES), (req, res) => {
  const b = req.body || {};
  if (!b.raw_text && !b.description) return res.status(400).json({ error: 'متن رویداد لازم است' });
  const payload = b.payload && typeof b.payload === 'object' ? b.payload : {};
  if (b.amount_rial !== undefined) payload.amount_rial = b.amount_rial;
  if (b.description) payload.description = b.description;
  const info = db.prepare(
    'INSERT INTO events (source, sender_name, sender_ref, raw_text, payload) VALUES (?,?,?,?,?)'
  ).run(
    b.source || 'manual',
    b.sender_name || req.user.name || '',
    b.sender_ref || '',
    b.raw_text || b.description || '',
    JSON.stringify(payload)
  );
  return res.status(201).json(db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid));
});

app.post('/api/events/:id/classify', requireAuth, requireRole(...WRITE_ROLES), (req, res) => {
  const result = classifyEvent(Number(req.params.id), req.body || {}, null);
  return res.status(result.status).json(result.body);
});

// ---------- Registers (expenses / income / payroll) ----------
// Reads: any logged-in user. Writes: admin | finance only.
const registersRouter = express.Router();
registersRouter.use(requireAuth);

registersRouter.get('/:kind', (req, res) => {
  if (!REGISTERS[req.params.kind]) return res.status(404).json({ error: 'دفتر نامعتبر است' });
  return res.json(listRegisterRows(req.params.kind));
});

registersRouter.post('/:kind', requireRole(...WRITE_ROLES), (req, res) => {
  if (!REGISTERS[req.params.kind]) return res.status(404).json({ error: 'دفتر نامعتبر است' });
  const { row, error } = insertRegisterRow(req.params.kind, req.body || {});
  if (error) return res.status(400).json({ error });
  return res.status(201).json(row);
});

registersRouter.patch('/:kind/:id', requireRole(...WRITE_ROLES), (req, res) => {
  const kind = req.params.kind;
  if (!REGISTERS[kind]) return res.status(404).json({ error: 'دفتر نامعتبر است' });
  const { data, error } = pickColumns(kind, req.body || {});
  if (error) return res.status(400).json({ error });
  const cols = Object.keys(data);
  if (!cols.length) return res.status(400).json({ error: 'چیزی برای ویرایش نیست' });
  const info = db.prepare(
    `UPDATE ${REGISTERS[kind].table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`
  ).run(...cols.map((c) => data[c]), Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'رکورد پیدا نشد' });
  return res.json(db.prepare(`SELECT * FROM ${REGISTERS[kind].table} WHERE id = ?`).get(Number(req.params.id)));
});

app.use('/api/registers', registersRouter);

// ---------- Ledgers ----------
app.get('/api/ledgers', requireAuth, (req, res) => {
  const kind = req.query.kind;
  const rows = kind
    ? db.prepare('SELECT * FROM ledger_items WHERE kind = ? ORDER BY id DESC LIMIT 500').all(kind)
    : db.prepare('SELECT * FROM ledger_items ORDER BY id DESC LIMIT 500').all();
  res.json(rows);
});

app.post('/api/ledgers', requireAuth, requireRole(...WRITE_ROLES), (req, res) => {
  const b = req.body || {};
  if (!['receivable', 'payable', 'cheque'].includes(b.kind)) return res.status(400).json({ error: 'نوع دفتر نامعتبر است' });
  const amount = toIntAmount(b.amount_rial);
  if (amount === null || amount < 0) return res.status(400).json({ error: 'مبلغ نامعتبر است' });
  const info = db.prepare(
    'INSERT INTO ledger_items (kind, party, description, amount_rial, due_date_shamsi, status, cheque_sayad_no) VALUES (?,?,?,?,?,?,?)'
  ).run(b.kind, b.party || '', b.description || '', amount, b.due_date_shamsi || '', b.status || 'باز', b.cheque_sayad_no || null);
  return res.status(201).json(db.prepare('SELECT * FROM ledger_items WHERE id = ?').get(info.lastInsertRowid));
});

app.patch('/api/ledgers/:id', requireAuth, requireRole(...WRITE_ROLES), (req, res) => {
  const b = req.body || {};
  const allowed = ['party', 'description', 'amount_rial', 'due_date_shamsi', 'status', 'cheque_sayad_no'];
  const cols = allowed.filter((c) => b[c] !== undefined);
  if (!cols.length) return res.status(400).json({ error: 'چیزی برای ویرایش نیست' });
  const values = cols.map((c) => (c === 'amount_rial' ? toIntAmount(b[c]) : b[c]));
  if (values.includes(null) && cols.includes('amount_rial')) return res.status(400).json({ error: 'مبلغ نامعتبر است' });
  const info = db.prepare(`UPDATE ledger_items SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...values, Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'رکورد پیدا نشد' });
  return res.json(db.prepare('SELECT * FROM ledger_items WHERE id = ?').get(Number(req.params.id)));
});

// ---------- Master data ----------
app.get('/api/customers', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM customers ORDER BY id DESC LIMIT 500').all());
});
app.post('/api/customers', requireAuth, requireRole(...WRITE_ROLES), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'نام مشتری لازم است' });
  const info = db.prepare('INSERT INTO customers (name, code, national_id, phone, notes) VALUES (?,?,?,?,?)')
    .run(b.name, b.code || '', b.national_id || '', b.phone || '', b.notes || '');
  return res.status(201).json(db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid));
});

app.get('/api/products', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY id DESC LIMIT 500').all());
});
app.post('/api/products', requireAuth, requireRole(...WRITE_ROLES), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'نام کالا لازم است' });
  const price = toIntAmount(b.sale_price_rial);
  if (price === null || price < 0) return res.status(400).json({ error: 'قیمت نامعتبر است' });
  const info = db.prepare('INSERT INTO products (name, code, unit, sale_price_rial, notes) VALUES (?,?,?,?,?)')
    .run(b.name, b.code || '', b.unit || '', price, b.notes || '');
  return res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
});

// ---------- Knowledge ----------
app.get('/api/knowledge', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM knowledge_entries ORDER BY id DESC LIMIT 500').all());
});
app.post('/api/knowledge', requireAuth, requireRole(...WRITE_ROLES), (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'عنوان لازم است' });
  const kind = ['rule', 'answer', 'note'].includes(b.kind) ? b.kind : 'note';
  const info = db.prepare('INSERT INTO knowledge_entries (title, body, kind) VALUES (?,?,?)')
    .run(b.title, b.body || '', kind);
  return res.status(201).json(db.prepare('SELECT * FROM knowledge_entries WHERE id = ?').get(info.lastInsertRowid));
});

// ---------- Analytics (user) ----------
app.get('/api/analytics/summary', requireAuth, (req, res) => {
  res.json(analyticsSummary());
});

// ---------- Telegram webhook (stub: store only, no outbound calls) ----------
app.post('/api/telegram/webhook', (req, res) => {
  try {
    const update = req.body || {};
    const msg = update.message || update.edited_message || {};
    const chat = msg.chat || {};
    const from = msg.from || {};
    let photoFileId = null;
    if (Array.isArray(msg.photo) && msg.photo.length) {
      photoFileId = msg.photo[msg.photo.length - 1].file_id;
    }
    const payload = { update_id: update.update_id, chat_id: chat.id, photo_file_id: photoFileId };
    if (msg.document) payload.document_file_id = msg.document.file_id;
    if (msg.voice) payload.voice_file_id = msg.voice.file_id;
    const info = db.prepare(
      'INSERT INTO events (source, sender_name, sender_ref, raw_text, payload) VALUES (?,?,?,?,?)'
    ).run(
      'telegram',
      [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || '',
      from.username ? `@${from.username}` : String(chat.id || ''),
      msg.text || msg.caption || '',
      JSON.stringify(payload)
    );
    return res.json({ ok: true, event_id: info.lastInsertRowid });
  } catch (e) {
    return res.status(400).json({ ok: false, error: 'آپدیت نامعتبر است' });
  }
});

// ---------- Agent API (API key, audit-logged writes) ----------
const agent = express.Router();
agent.use(requireAgent);

agent.get('/events/incoming', (req, res) => {
  const rows = db.prepare("SELECT * FROM events WHERE status = 'unprocessed' ORDER BY id ASC LIMIT 500").all();
  res.json(rows.map((r) => ({ ...r, payload: safeParse(r.payload) })));
});

agent.post('/events/:id/classify', (req, res) => {
  const result = classifyEvent(Number(req.params.id), req.body || {}, 'pip-agent');
  return res.status(result.status).json(result.body);
});

agent.get('/registers/:kind', (req, res) => {
  if (!REGISTERS[req.params.kind]) return res.status(404).json({ error: 'دفتر نامعتبر است' });
  return res.json(listRegisterRows(req.params.kind));
});

agent.post('/registers/:kind', (req, res) => {
  if (!REGISTERS[req.params.kind]) return res.status(404).json({ error: 'دفتر نامعتبر است' });
  const { row, error } = insertRegisterRow(req.params.kind, req.body || {});
  if (error) return res.status(400).json({ error });
  audit('pip-agent', 'create', REGISTERS[req.params.kind].table, row.id);
  return res.status(201).json(row);
});

agent.get('/ledgers', (req, res) => {
  res.json(db.prepare('SELECT * FROM ledger_items ORDER BY id DESC LIMIT 500').all());
});

agent.post('/ledgers', (req, res) => {
  const b = req.body || {};
  if (!['receivable', 'payable', 'cheque'].includes(b.kind)) return res.status(400).json({ error: 'نوع دفتر نامعتبر است' });
  const amount = toIntAmount(b.amount_rial);
  if (amount === null || amount < 0) return res.status(400).json({ error: 'مبلغ نامعتبر است' });
  const info = db.prepare(
    'INSERT INTO ledger_items (kind, party, description, amount_rial, due_date_shamsi, status, cheque_sayad_no) VALUES (?,?,?,?,?,?,?)'
  ).run(b.kind, b.party || '', b.description || '', amount, b.due_date_shamsi || '', b.status || 'باز', b.cheque_sayad_no || null);
  audit('pip-agent', 'create', 'ledger_items', Number(info.lastInsertRowid));
  return res.status(201).json(db.prepare('SELECT * FROM ledger_items WHERE id = ?').get(info.lastInsertRowid));
});

agent.get('/knowledge', (req, res) => {
  res.json(db.prepare('SELECT * FROM knowledge_entries ORDER BY id DESC LIMIT 500').all());
});

agent.post('/knowledge', (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'عنوان لازم است' });
  const kind = ['rule', 'answer', 'note'].includes(b.kind) ? b.kind : 'note';
  const info = db.prepare('INSERT INTO knowledge_entries (title, body, kind) VALUES (?,?,?)')
    .run(b.title, b.body || '', kind);
  audit('pip-agent', 'create', 'knowledge_entries', Number(info.lastInsertRowid));
  return res.status(201).json(db.prepare('SELECT * FROM knowledge_entries WHERE id = ?').get(info.lastInsertRowid));
});

agent.get('/analytics/summary', (req, res) => {
  res.json(analyticsSummary());
});

agent.get('/audit', (req, res) => {
  res.json(db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all());
});

app.use('/api/agent', agent);

function safeParse(s) {
  if (!s) return {};
  try { return JSON.parse(s); } catch (_) { return {}; }
}

// SPA fallback for non-API GETs.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'خطای داخلی سرور' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Farzam ERP running at http://localhost:${PORT}`);
  });
}

module.exports = app;
