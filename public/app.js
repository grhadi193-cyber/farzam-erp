'use strict';
/* Farzam ERP — vanilla SPA. Token in localStorage; all data via /api. */

const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');
const faMoney = (n) => faNum(n) + ' ریال';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let token = localStorage.getItem('farzam_token') || '';
let currentUser = null;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'خطا در ارتباط با سرور');
  return data;
}

const canWrite = () => currentUser && ['admin', 'finance'].includes(currentUser.role);
const canCreateEvent = () => currentUser && ['admin', 'finance', 'employee'].includes(currentUser.role);

// ---------- Login ----------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: { email: $('#login-email').value.trim(), password: $('#login-password').value },
    });
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('farzam_token', token);
    showApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#logout-btn').addEventListener('click', () => {
  token = '';
  currentUser = null;
  localStorage.removeItem('farzam_token');
  $('#app-view').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
});

function showApp() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  const roleFa = { admin: 'مدیر', finance: 'مالی', employee: 'کارمند', viewer: 'مشاهده‌گر' };
  $('#user-info').textContent = `${currentUser.name} — ${roleFa[currentUser.role] || currentUser.role}`;
  loadTab('dashboard');
}

// ---------- Tabs ----------
$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  $$('#tabs .tab').forEach((t) => t.classList.toggle('active', t === btn));
  loadTab(btn.dataset.tab);
});

const loaded = {};
function loadTab(name) {
  $$('main .panel').forEach((p) => p.classList.add('hidden'));
  $('#tab-' + name).classList.remove('hidden');
  const loaders = {
    dashboard: loadDashboard, intake: loadIntake,
    expenses: () => loadRegister('expenses'), income: () => loadRegister('income'), payroll: () => loadRegister('payroll'),
    ledgers: loadLedgers, customers: loadCustomers, products: loadProducts, knowledge: loadKnowledge,
  };
  if (loaders[name]) loaders[name]();
}

// ---------- Dashboard ----------
async function loadDashboard() {
  const el = $('#tab-dashboard');
  el.innerHTML = '<p class="muted">در حال بارگذاری…</p>';
  try {
    const s = await api('/api/analytics/summary');
    const t = s.totals;
    el.innerHTML = `
      <div class="cards">
        <div class="card"><div class="lbl">جمع درآمدها</div><div class="num">${faMoney(t.income_rial)}</div><div class="muted">${faNum(s.counts.income)} رکورد</div></div>
        <div class="card"><div class="lbl">جمع هزینه‌ها</div><div class="num">${faMoney(t.expenses_rial)}</div><div class="muted">${faNum(s.counts.expenses)} رکورد</div></div>
        <div class="card"><div class="lbl">جمع حقوق</div><div class="num">${faMoney(t.payroll_rial)}</div><div class="muted">${faNum(s.counts.payroll)} رکورد</div></div>
        <div class="card"><div class="lbl">خالص (درآمد − هزینه − حقوق)</div><div class="num">${faMoney(t.net_rial)}</div></div>
        <div class="card ${s.unclear_count ? 'alert' : ''}"><div class="lbl">رویداد نامشخص / نیازمند بررسی</div><div class="num">${faNum(s.unclear_count)}</div><div class="muted">پردازش‌نشده: ${faNum(s.events.unprocessed)} — ثبت‌شده: ${faNum(s.events.registered)}</div></div>
      </div>
      <div class="grid2">
        <div class="card"><h2 class="sec">مقایسه جریان مالی (ریال)</h2>${barChart([
          { label: 'درآمد', value: t.income_rial, color: '#0e7c5b' },
          { label: 'هزینه', value: t.expenses_rial, color: '#b3261e' },
          { label: 'حقوق', value: t.payroll_rial, color: '#102333' },
        ])}</div>
        <div class="card"><h2 class="sec">سهم دسته‌های هزینه</h2>${donutChart(s.expenses_by_category)}</div>
      </div>
      <div class="card" style="margin-top:12px"><h2 class="sec">دفاتر باز</h2>
        ${s.ledger_open.length ? `<table><tr><th>نوع</th><th>تعداد</th><th>جمع (ریال)</th></tr>${s.ledger_open.map((r) => `<tr><td>${ledgerKindFa(r.kind)}</td><td>${faNum(r.count)}</td><td>${faMoney(r.total)}</td></tr>`).join('')}</table>` : '<div class="empty">دفتر بازی وجود ندارد</div>'}
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
}

function barChart(items) {
  const max = Math.max(...items.map((i) => i.value), 1);
  const W = 460, H = 190, base = 155, bw = 74;
  const gap = (W - items.length * bw) / (items.length + 1);
  let bars = '';
  items.forEach((it, i) => {
    const h = Math.round((it.value / max) * 120);
    const x = gap + i * (bw + gap);
    bars += `<rect x="${x}" y="${base - h}" width="${bw}" height="${h}" rx="5" fill="${it.color}"></rect>
      <text x="${x + bw / 2}" y="${base - h - 8}" text-anchor="middle" font-size="12">${faNum(it.value)}</text>
      <text x="${x + bw / 2}" y="${base + 20}" text-anchor="middle" font-size="13">${it.label}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"><line x1="8" y1="${base}" x2="${W - 8}" y2="${base}" stroke="#dde3e8"/>${bars}</svg>`;
}

function donutChart(cats) {
  if (!cats || !cats.length) return '<div class="empty">هنوز هزینه‌ای ثبت نشده است</div>';
  const total = cats.reduce((a, c) => a + Number(c.total || 0), 0) || 1;
  const colors = ['#102333', '#0e7c5b', '#b26a00', '#5b7fa6', '#b3261e', '#7a5ba6', '#3f8f6e'];
  const R = 60, C = 2 * Math.PI * R;
  let offset = 0, segs = '', legend = '';
  cats.forEach((c, i) => {
    const frac = Number(c.total || 0) / total;
    const len = frac * C;
    segs += `<circle cx="90" cy="90" r="${R}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="26"
      stroke-dasharray="${Math.max(len - 2, 0)} ${C - len + 2}" stroke-dashoffset="${-offset}" transform="rotate(-90 90 90)"></circle>`;
    offset += len;
    legend += `<div><span class="badge" style="background:${colors[i % colors.length]};color:#fff">${esc(c.category)}</span> ${faMoney(c.total)} (${faNum(Math.round(frac * 100))}٪)</div>`;
  });
  return `<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"><svg viewBox="0 0 180 180" width="170" height="170">${segs}
    <text x="90" y="95" text-anchor="middle" font-size="13">${faMoney(total)}</text></svg><div>${legend}</div></div>`;
}

// ---------- Universal intake ----------
const TYPE_FA = { expense: 'هزینه', income: 'درآمد', payroll: 'حقوق', unclear: 'نامشخص' };
const STATUS_FA = { unprocessed: 'پردازش‌نشده', registered: 'ثبت‌شده', needs_review: 'نیازمند بررسی' };

async function loadIntake() {
  const el = $('#tab-intake');
  let events = [];
  try { events = await api('/api/events'); } catch (err) { el.innerHTML = `<div class="error">${esc(err.message)}</div>`; return; }
  el.innerHTML = `
    ${canCreateEvent() ? `<form id="event-form" class="form-card">
      <h2 class="sec">ثبت رویداد جدید — یک پیام آزاد کافی است</h2>
      <div class="form-grid">
        <label style="grid-column: span 2">متن رویداد (مثلاً: خریدیم… / فروختیم… / حقوق فلانی…)
          <input name="raw_text" required placeholder="خریدیم سه کارتن کاغذ، ۲ میلیون تومان">
        </label>
        <label>مبلغ (ریال) — اختیاری<input name="amount_rial" type="number" min="0" placeholder="20000000"></label>
        <label>نام ثبت‌کننده<input name="sender_name" value="${esc(currentUser.name)}"></label>
      </div>
      <button class="btn primary" type="submit">ثبت رویداد</button>
    </form>` : ''}
    <div id="events-list">
      ${events.length ? events.map(eventCard).join('') : '<div class="empty">هنوز رویدادی ثبت نشده است</div>'}
    </div>`;
  const form = $('#event-form');
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      await api('/api/events', { method: 'POST', body: { raw_text: fd.get('raw_text'), sender_name: fd.get('sender_name'), amount_rial: fd.get('amount_rial') || undefined } });
      loadIntake();
    } catch (err) { alert(err.message); }
  });
  $$('.classify-btn', el).forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.dataset.id;
    const wrap = btn.closest('.event-card');
    const type = $('.cf-type', wrap).value;
    const amount = $('.cf-amount', wrap).value;
    const desc = $('.cf-desc', wrap).value;
    try {
      await api(`/api/events/${id}/classify`, { method: 'POST', body: { event_type: type, amount_rial: amount ? Number(amount) : undefined, description: desc || undefined } });
      loadIntake();
    } catch (err) { alert(err.message); }
  }));
}

function eventCard(ev) {
  const badgeCls = ev.status === 'registered' ? 'ok' : ev.status === 'needs_review' ? 'bad' : 'warn';
  const payloadAmount = ev.payload && ev.payload.amount_rial ? faMoney(ev.payload.amount_rial) : '';
  return `<div class="event-card">
    <div class="raw">${esc(ev.raw_text || '(بدون متن)')}</div>
    <div class="muted">${esc(ev.sender_name || '')} ${ev.sender_ref ? '— ' + esc(ev.sender_ref) : ''} · منبع: ${esc(ev.source)} ${payloadAmount ? '· مبلغ پیام: ' + payloadAmount : ''}</div>
    <div><span class="badge ${badgeCls}">${STATUS_FA[ev.status] || ev.status}</span>
    ${ev.event_type ? `<span class="badge">${TYPE_FA[ev.event_type] || ev.event_type}</span>` : ''}</div>
    ${canWrite() && ev.status !== 'registered' ? `<div class="classify-row">
      <label>نوع رویداد<select class="cf-type">
        <option value="expense">هزینه (خرید)</option><option value="income">درآمد (فروش)</option>
        <option value="payroll">حقوق</option><option value="unclear">نامشخص</option>
      </select></label>
      <label>مبلغ (ریال)<input class="cf-amount" type="number" min="0" value="${ev.payload && ev.payload.amount_rial ? esc(ev.payload.amount_rial) : ''}"></label>
      <label>شرح<input class="cf-desc" value="${esc(ev.raw_text || '')}"></label>
      <button class="btn primary classify-btn" data-id="${ev.id}">طبقه‌بندی و ثبت</button>
    </div>` : ''}
  </div>`;
}

// ---------- Registers (generic) ----------
const REGISTER_CONF = {
  expenses: {
    title: 'هزینه‌ها',
    fields: [
      ['date_shamsi', 'تاریخ شمسی'], ['time_ir', 'ساعت'], ['person', 'شخص'], ['telegram_ref', 'شناسه تلگرام'],
      ['description', 'شرح'], ['amount_rial', 'مبلغ (ریال)', 'number'], ['category', 'دسته'],
      ['payment_method', 'روش پرداخت'], ['tracking_no', 'شماره پیگیری'], ['receipt_date_time', 'تاریخ/ساعت روی رسید'],
      ['record_folder', 'نام پوشه رکورد'], ['notes', 'توضیحات'],
    ],
    cols: [['date_shamsi', 'تاریخ'], ['person', 'شخص'], ['description', 'شرح'], ['category', 'دسته'], ['amount_rial', 'مبلغ', 'money'], ['tracking_no', 'پیگیری'], ['receipt_status', 'رسید']],
  },
  income: {
    title: 'درآمدها',
    fields: [
      ['date_shamsi', 'تاریخ شمسی'], ['time_ir', 'ساعت'], ['person', 'پرداخت‌کننده'], ['telegram_ref', 'شناسه تلگرام'],
      ['description', 'شرح / بابت'], ['amount_rial', 'مبلغ (ریال)', 'number'], ['account_dest', 'حساب/کارت مقصد'],
      ['payment_method', 'روش پرداخت'], ['tracking_no', 'شماره پیگیری / سند'], ['receipt_date_time', 'تاریخ/ساعت روی فیش'],
      ['record_folder', 'نام پوشه رکورد'], ['notes', 'توضیحات'],
    ],
    cols: [['date_shamsi', 'تاریخ'], ['person', 'پرداخت‌کننده'], ['description', 'شرح'], ['amount_rial', 'مبلغ', 'money'], ['account_dest', 'حساب مقصد'], ['tracking_no', 'پیگیری'], ['receipt_status', 'فیش']],
  },
  payroll: {
    title: 'حقوق و مزایا',
    fields: [
      ['date_shamsi', 'تاریخ شمسی'], ['time_ir', 'ساعت'], ['person', 'کارمند'], ['telegram_ref', 'ثبت‌کننده (تلگرام)'],
      ['description', 'شرح'], ['basis', 'بابت'], ['amount_rial', 'مبلغ (ریال)', 'number'],
      ['payment_method', 'روش پرداخت'], ['tracking_no', 'شماره پیگیری / سند'], ['receipt_date_time', 'تاریخ/ساعت روی فیش'],
      ['record_folder', 'نام پوشه رکورد'], ['notes', 'توضیحات'],
    ],
    cols: [['date_shamsi', 'تاریخ'], ['person', 'کارمند'], ['basis', 'بابت'], ['description', 'شرح'], ['amount_rial', 'مبلغ', 'money'], ['tracking_no', 'پیگیری'], ['receipt_status', 'فیش']],
  },
};
const REVIEW_STATUSES = ['در انتظار بررسی', 'تأیید شده', 'ناقص', 'رد شده'];

async function loadRegister(kind) {
  const conf = REGISTER_CONF[kind];
  const el = $('#tab-' + kind);
  let rows = [];
  try { rows = await api(`/api/registers/${kind}`); } catch (err) { el.innerHTML = `<div class="error">${esc(err.message)}</div>`; return; }
  const total = rows.reduce((a, r) => a + Number(r.amount_rial || 0), 0);
  el.innerHTML = `
    ${canWrite() ? `<form class="form-card" id="reg-form">
      <h2 class="sec">ثبت رکورد جدید — ${conf.title}</h2>
      <div class="form-grid">
        ${conf.fields.map(([name, label, type]) => `<label>${label}<input name="${name}" ${type === 'number' ? 'type="number" min="0"' : ''} ${name === 'amount_rial' || name === 'description' ? 'required' : ''}></label>`).join('')}
        <label>رسید / فیش<select name="receipt_status"><option>ندارد</option><option>دارد</option></select></label>
      </div>
      <button class="btn primary" type="submit">ثبت</button>
    </form>` : ''}
    <div class="card" style="margin-bottom:12px"><span class="lbl">جمع ${conf.title}: </span><b>${faMoney(total)}</b> — ${faNum(rows.length)} رکورد</div>
    ${rows.length ? `<div style="overflow-x:auto"><table><tr>${conf.cols.map((c) => `<th>${c[1]}</th>`).join('')}<th>وضعیت بررسی</th>${canWrite() ? '<th></th>' : ''}</tr>
      ${rows.map((r) => `<tr>
        ${conf.cols.map(([name, , kind2]) => `<td>${kind2 === 'money' ? faMoney(r[name]) : esc(r[name] ?? '')}</td>`).join('')}
        <td>${canWrite() ? `<select class="rv-sel" data-id="${r.id}">${REVIEW_STATUSES.map((s) => `<option ${s === r.review_status ? 'selected' : ''}>${s}</option>`).join('')}</select>` : `<span class="badge">${esc(r.review_status)}</span>`}</td>
        ${canWrite() ? `<td><button class="btn small rv-save" data-id="${r.id}">ذخیره</button></td>` : ''}
      </tr>`).join('')}
    </table></div>` : '<div class="empty">هنوز رکوردی ثبت نشده است</div>'}`;
  const form = $('#reg-form', el);
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    new FormData(form).forEach((v, k) => { if (v !== '') body[k] = k === 'amount_rial' ? Number(v) : v; });
    try { await api(`/api/registers/${kind}`, { method: 'POST', body }); loadRegister(kind); }
    catch (err) { alert(err.message); }
  });
  $$('.rv-save', el).forEach((btn) => btn.addEventListener('click', async () => {
    const sel = $(`.rv-sel[data-id="${btn.dataset.id}"]`, el);
    try { await api(`/api/registers/${kind}/${btn.dataset.id}`, { method: 'PATCH', body: { review_status: sel.value } }); loadRegister(kind); }
    catch (err) { alert(err.message); }
  }));
}

// ---------- Ledgers ----------
const LEDGER_KINDS = { receivable: 'دریافتنی', payable: 'پرداختنی', cheque: 'چک' };
const ledgerKindFa = (k) => LEDGER_KINDS[k] || k;

async function loadLedgers() {
  const el = $('#tab-ledgers');
  let rows = [];
  try { rows = await api('/api/ledgers'); } catch (err) { el.innerHTML = `<div class="error">${esc(err.message)}</div>`; return; }
  el.innerHTML = `
    ${canWrite() ? `<form class="form-card" id="ledger-form">
      <h2 class="sec">ثبت مورد جدید در دفاتر</h2>
      <div class="form-grid">
        <label>نوع<select name="kind"><option value="receivable">دریافتنی</option><option value="payable">پرداختنی</option><option value="cheque">چک</option></select></label>
        <label>طرف حساب<input name="party"></label>
        <label>شرح<input name="description"></label>
        <label>مبلغ (ریال)<input name="amount_rial" type="number" min="0" required></label>
        <label>سررسید (شمسی)<input name="due_date_shamsi" placeholder="۱۴۰۵/۱۰/۰۱"></label>
        <label>شماره صیادی (برای چک)<input name="cheque_sayad_no"></label>
      </div>
      <button class="btn primary" type="submit">ثبت</button>
    </form>` : ''}
    ${rows.length ? `<div style="overflow-x:auto"><table><tr><th>نوع</th><th>طرف حساب</th><th>شرح</th><th>مبلغ</th><th>سررسید</th><th>صیادی</th><th>وضعیت</th>${canWrite() ? '<th></th>' : ''}</tr>
      ${rows.map((r) => `<tr><td>${ledgerKindFa(r.kind)}</td><td>${esc(r.party)}</td><td>${esc(r.description)}</td><td>${faMoney(r.amount_rial)}</td><td>${esc(r.due_date_shamsi || '')}</td><td>${esc(r.cheque_sayad_no || '')}</td>
      <td>${canWrite() ? `<select class="lg-sel" data-id="${r.id}">${['باز', 'تسویه شده', 'برگشتی'].map((s) => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select>` : `<span class="badge">${esc(r.status)}</span>`}</td>
      ${canWrite() ? `<td><button class="btn small lg-save" data-id="${r.id}">ذخیره</button></td>` : ''}</tr>`).join('')}
    </table></div>` : '<div class="empty">هنوز موردی در دفاتر ثبت نشده است</div>'}`;
  const form = $('#ledger-form', el);
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    new FormData(form).forEach((v, k) => { if (v !== '') body[k] = k === 'amount_rial' ? Number(v) : v; });
    try { await api('/api/ledgers', { method: 'POST', body }); loadLedgers(); }
    catch (err) { alert(err.message); }
  });
  $$('.lg-save', el).forEach((btn) => btn.addEventListener('click', async () => {
    const sel = $(`.lg-sel[data-id="${btn.dataset.id}"]`, el);
    try { await api(`/api/ledgers/${btn.dataset.id}`, { method: 'PATCH', body: { status: sel.value } }); loadLedgers(); }
    catch (err) { alert(err.message); }
  }));
}

// ---------- Customers / Products ----------
async function loadCustomers() {
  const el = $('#tab-customers');
  let rows = [];
  try { rows = await api('/api/customers'); } catch (err) { el.innerHTML = `<div class="error">${esc(err.message)}</div>`; return; }
  el.innerHTML = `
    ${canWrite() ? `<form class="form-card" id="cust-form"><h2 class="sec">مشتری جدید</h2>
      <div class="form-grid">
        <label>نام<input name="name" required></label><label>کد<input name="code"></label>
        <label>شناسه / کد ملی<input name="national_id"></label><label>تلفن<input name="phone"></label>
        <label>توضیحات<input name="notes"></label>
      </div><button class="btn primary" type="submit">ثبت</button></form>` : ''}
    ${rows.length ? `<table><tr><th>نام</th><th>کد</th><th>شناسه ملی</th><th>تلفن</th><th>توضیحات</th></tr>
      ${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.code || '')}</td><td>${esc(r.national_id || '')}</td><td>${esc(r.phone || '')}</td><td>${esc(r.notes || '')}</td></tr>`).join('')}</table>`
      : '<div class="empty">هنوز مشتری‌ای ثبت نشده است</div>'}`;
  const form = $('#cust-form', el);
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    new FormData(form).forEach((v, k) => { if (v !== '') body[k] = v; });
    try { await api('/api/customers', { method: 'POST', body }); loadCustomers(); }
    catch (err) { alert(err.message); }
  });
}

async function loadProducts() {
  const el = $('#tab-products');
  let rows = [];
  try { rows = await api('/api/products'); } catch (err) { el.innerHTML = `<div class="error">${esc(err.message)}</div>`; return; }
  el.innerHTML = `
    ${canWrite() ? `<form class="form-card" id="prod-form"><h2 class="sec">کالای جدید</h2>
      <div class="form-grid">
        <label>نام کالا<input name="name" required></label><label>کد<input name="code"></label>
        <label>واحد<input name="unit" placeholder="عدد"></label>
        <label>قیمت فروش (ریال)<input name="sale_price_rial" type="number" min="0"></label>
        <label>توضیحات<input name="notes"></label>
      </div><button class="btn primary" type="submit">ثبت</button></form>` : ''}
    ${rows.length ? `<table><tr><th>نام</th><th>کد</th><th>واحد</th><th>قیمت فروش</th><th>توضیحات</th></tr>
      ${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.code || '')}</td><td>${esc(r.unit || '')}</td><td>${faMoney(r.sale_price_rial)}</td><td>${esc(r.notes || '')}</td></tr>`).join('')}</table>`
      : '<div class="empty">هنوز کالایی ثبت نشده است</div>'}`;
  const form = $('#prod-form', el);
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    new FormData(form).forEach((v, k) => { if (v !== '') body[k] = k === 'sale_price_rial' ? Number(v) : v; });
    try { await api('/api/products', { method: 'POST', body }); loadProducts(); }
    catch (err) { alert(err.message); }
  });
}

// ---------- Knowledge ----------
const KIND_FA = { rule: 'قاعده', answer: 'پاسخ مدیریت', note: 'یادداشت' };
async function loadKnowledge() {
  const el = $('#tab-knowledge');
  let rows = [];
  try { rows = await api('/api/knowledge'); } catch (err) { el.innerHTML = `<div class="error">${esc(err.message)}</div>`; return; }
  el.innerHTML = `
    ${canWrite() ? `<form class="form-card" id="kn-form"><h2 class="sec">ورودی جدید دانش</h2>
      <div class="form-grid">
        <label>عنوان<input name="title" required></label>
        <label>نوع<select name="kind"><option value="rule">قاعده</option><option value="answer">پاسخ مدیریت</option><option value="note">یادداشت</option></select></label>
        <label style="grid-column: span 2">متن<textarea name="body" rows="3"></textarea></label>
      </div><button class="btn primary" type="submit">ثبت</button></form>` : ''}
    ${rows.length ? rows.map((r) => `<div class="kitem"><h3>${esc(r.title)} <span class="badge">${KIND_FA[r.kind] || r.kind}</span></h3><div>${esc(r.body || '')}</div></div>`).join('')
      : '<div class="empty">هنوز ورودی دانشی ثبت نشده است</div>'}`;
  const form = $('#kn-form', el);
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    new FormData(form).forEach((v, k) => { body[k] = v; });
    try { await api('/api/knowledge', { method: 'POST', body }); loadKnowledge(); }
    catch (err) { alert(err.message); }
  });
}

// ---------- Boot ----------
(async function boot() {
  if (!token) return;
  try {
    const data = await api('/api/auth/me');
    currentUser = data.user;
    showApp();
  } catch (_) {
    token = '';
    localStorage.removeItem('farzam_token');
  }
})();
