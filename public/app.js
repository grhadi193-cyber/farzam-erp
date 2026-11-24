'use strict';
/* Farzam ERP — vanilla SPA. Token in localStorage; all data via /api. */

const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');
// Display unit only: amounts are always stored in Rial. The تومان view
// divides by 10 for display and never touches stored values.
let unit = localStorage.getItem('farzam_unit') || 'rial';
const unitDiv = () => (unit === 'toman' ? 10 : 1);
const unitName = () => (unit === 'toman' ? 'تومان' : 'ریال');
const faMoney = (n) => faNum(Math.round(Number(n || 0) / unitDiv())) + ' ' + unitName();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Receipt photos ----------
// Photos are compressed in the browser (canvas, max 1200px, JPEG 0.82) into a
// data URL and stored with the record as receipt_image. No photo keeps the
// exact old behaviour: the record simply reads «رسید ندارد».
const photoStore = {};

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 1200;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function photoFieldHTML(prefix) {
  return `<label>عکس رسید / فیش (اختیاری)
    <input type="file" id="photo-${prefix}" accept="image/*">
    <img id="photo-prev-${prefix}" class="photo-preview hidden" alt="پیش‌نمایش رسید">
    <span class="photo-hint">عکس به‌صورت خودکار فشرده و همراه رکورد ذخیره می‌شود؛ بدون عکس، رکورد «رسید ندارد» می‌ماند.</span>
  </label>`;
}

function wirePhotoField(prefix) {
  const input = document.getElementById('photo-' + prefix);
  if (!input) return;
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      photoStore[prefix] = await fileToDataURL(file);
      const prev = document.getElementById('photo-prev-' + prefix);
      if (prev) { prev.src = photoStore[prefix]; prev.classList.remove('hidden'); }
    } catch (_) {
      alert('خواندن عکس ممکن نشد؛ یک فایل تصویری انتخاب کنید.');
    }
  });
}

function thumbHTML(src) {
  return src ? `<img class="thumb" src="${esc(src)}" alt="عکس رسید" title="برای بزرگ‌نمایی کلیک کنید">` : '';
}

// Full-size image viewer (one shared modal; thumbnails delegate to it).
function ensureImgModal() {
  if (document.getElementById('img-modal')) return;
  const d = document.createElement('div');
  d.id = 'img-modal';
  d.className = 'img-modal hidden';
  d.innerHTML = '<img id="img-modal-img" alt="عکس رسید">';
  d.addEventListener('click', () => d.classList.add('hidden'));
  document.body.appendChild(d);
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('img.thumb');
  if (!t) return;
  ensureImgModal();
  document.getElementById('img-modal-img').src = t.src;
  document.getElementById('img-modal').classList.remove('hidden');
});

// Colored chip class for a review status (viewer rendering).
const statusCls = (s) => (s === 'تأیید شده' ? 'ok'
  : (s === 'رد شده' || String(s || '').includes('تکراری')) ? 'bad'
  : (s === 'نیازمند تکمیل' || s === 'ناقص') ? 'warn' : '');

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

// ---------- Unit toggle & refresh ----------
let currentTab = 'dashboard';

function applyUnitUI() {
  $$('#unit-toggle .unit-btn').forEach((b) => b.classList.toggle('active', b.dataset.unit === unit));
}

$('#unit-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-unit]');
  if (!btn || btn.dataset.unit === unit) return;
  unit = btn.dataset.unit;
  localStorage.setItem('farzam_unit', unit);
  applyUnitUI();
  loadTab(currentTab);
});

$('#refresh-btn').addEventListener('click', () => {
  loadBadges();
  loadTab(currentTab);
});

function renderBadges(s) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ? faNum(v) : ''; };
  set('badge-expenses', s.counts.expenses);
  set('badge-customers', s.counts.customers);
  set('badge-intake', s.events.unprocessed);
  set('badge-questions', s.counts.questions_open);
  // Header subtitle reports DATA STATUS (like the panel), not a clock:
  // what was read, and which modules are honestly empty.
  const ds = document.getElementById('data-status');
  if (ds) {
    const c = s.counts;
    const read = [];
    if (c.expenses) read.push(`${faNum(c.expenses)} هزینه`);
    if (c.income) read.push(`${faNum(c.income)} درآمد`);
    if (c.payroll) read.push(`${faNum(c.payroll)} حقوق`);
    if (c.customers) read.push(`${faNum(c.customers)} مشتری`);
    if (c.products) read.push(`${faNum(c.products)} کالا`);
    const joinFa = (arr) => (arr.length > 1 ? `${arr.slice(0, -1).join('، ')} و ${arr[arr.length - 1]}` : (arr[0] || ''));
    let txt = `آخرین به‌روزرسانی: ${read.length ? `${joinFa(read)} خوانده شد` : 'هنوز داده‌ای خوانده نشده است'}`;
    const empty = [];
    if (!c.income) empty.push('درآمد');
    if (!c.payroll) empty.push('حقوق');
    if (!c.ledger_items) empty.push('دفاتر');
    if (empty.length) txt += `؛ ${joinFa(empty)} خالی بودند`;
    ds.textContent = txt;
  }
}

async function loadBadges() {
  if (!token) return;
  try { renderBadges(await api('/api/analytics/summary')); } catch (_) { /* badges are best-effort */ }
}

function showApp() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  const roleFa = { admin: 'مدیر', finance: 'مالی', employee: 'کارمند', viewer: 'مشاهده‌گر' };
  $('#user-info').textContent = `${currentUser.name} — ${roleFa[currentUser.role] || currentUser.role}`;
  applyUnitUI();
  loadBadges();
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
  currentTab = name;
  $$('main .panel').forEach((p) => p.classList.add('hidden'));
  $('#tab-' + name).classList.remove('hidden');
  const loaders = {
    dashboard: loadDashboard, intake: loadIntake, monitoring: loadMonitoring,
    expenses: () => loadRegister('expenses'), income: () => loadRegister('income'), payroll: () => loadRegister('payroll'),
    ledgers: loadLedgers, customers: loadCustomers, products: loadProducts,
    tasks: loadTasks, questions: loadQuestions, knowledge: loadKnowledge,
  };
  if (loaders[name]) loaders[name]();
}

// ---------- Dashboard ----------
async function loadDashboard() {
  const el = $('#tab-dashboard');
  el.innerHTML = '<p class="muted">در حال بارگذاری…</p>';
  try {
    const s = await api('/api/analytics/summary');
    renderBadges(s);
    let bankAccounts = [];
    try { bankAccounts = await api('/api/bank-accounts'); } catch (_) { /* bank section renders empty */ }
    const cashTotal = bankAccounts.reduce((a, r) => a + Number(r.balance_rial || 0), 0);
    const t = s.totals;
    const c = s.counts;
    const lo = {};
    s.ledger_open.forEach((r) => { lo[r.kind] = r; });
    const rec = lo.receivable || { total: 0, count: 0 };
    const pay = lo.payable || { total: 0, count: 0 };
    const chq = lo.cheque || { total: 0, count: 0 };
    // Panel definitions: هزینه قطعی = gross expenses minus duplicate-pending rows
    // (review_status includes «تکراری»); موارد نیازمند پیگیری = register rows across
    // expenses+income+payroll whose review_status is not «تأیید شده».
    let confirmedExp = t.expenses_rial;
    let attentionCount = s.unclear_count;
    let dupTotal = 0;
    let noReceiptCount = 0;
    try {
      const expRows = await api('/api/registers/expenses');
      dupTotal = expRows.filter((r) => String(r.review_status || '').includes('تکراری'))
        .reduce((a, r) => a + Number(r.amount_rial || 0), 0);
      confirmedExp = t.expenses_rial - dupTotal;
      noReceiptCount = expRows.filter((r) => r.receipt_status === 'ندارد').length;
      try {
        const incRows = await api('/api/registers/income');
        const payRows = await api('/api/registers/payroll');
        attentionCount = [...expRows, ...incRows, ...payRows]
          .filter((r) => r.review_status !== 'تأیید شده').length;
      } catch (_) { /* attention count falls back to analytics unclear_count */ }
    } catch (_) { /* confirmed expenses fall back to the analytics gross total */ }
    const netRial = t.income_rial - confirmedExp - t.payroll_rial;
    const kpi = (lbl, val, cap, cls = '') =>
      `<div class="kpi"><div class="kpi-lbl"><span class="kpi-dot ${cls}"></span>${lbl}</div><div class="kpi-num ${cls}">${val}</div><div class="kpi-cap">${cap}</div></div>`;
    el.innerHTML = `
      <div class="kpis">
        ${kpi('جمع هزینه‌های ثبت‌شده', faMoney(t.expenses_rial), `${faNum(c.expenses)} رکورد از ربات و پنل`, 'neg')}
        ${kpi('هزینه قطعی (بدون ردیف تکراری)', faMoney(confirmedExp), dupTotal ? `ردیف تکراری در انتظار تصمیم: ${faMoney(dupTotal)}` : 'ردیف تکراری در انتظار تصمیم نیست', 'neg')}
        ${kpi('جمع درآمدهای ثبت‌شده', faMoney(t.income_rial), c.income ? `${faNum(c.income)} رکورد` : 'هنوز رکوردی ثبت نشده', 'pos')}
        ${kpi('تراز ثبت‌شده (درآمد − هزینه قطعی)', faMoney(netRial), 'مانده حساب‌ها نیست؛ فقط جمع همین ثبت‌هاست', netRial < 0 ? 'neg' : 'pos')}
        ${kpi('جمع حقوق و دستمزد', faMoney(t.payroll_rial), c.payroll ? `${faNum(c.payroll)} رکورد` : 'هنوز رکوردی ثبت نشده')}
        ${kpi('جمع کل خروجی (هزینه قطعی + حقوق)', faMoney(confirmedExp + t.payroll_rial), 'کل پول خارج‌شده ثبت‌شده از شرکت', 'neg')}
        ${kpi('دریافتنی‌های باز', faMoney(rec.total), rec.count ? `${faNum(rec.count)} مورد باز` : 'طلب بازی ثبت نشده', 'pos')}
        ${kpi('پرداختنی‌های باز', faMoney(pay.total), pay.count ? `${faNum(pay.count)} مورد باز` : 'بدهی بازی ثبت نشده')}
        ${kpi('چک‌های در جریان', faNum(chq.count), `مجموع مبلغ: ${faMoney(chq.total)}`)}
        ${kpi('موارد نیازمند پیگیری', faNum(attentionCount), noReceiptCount ? `${faNum(noReceiptCount)} رکورد هزینه بدون رسید` : 'همه رکوردهای هزینه رسید دارند', attentionCount ? 'warn-num' : '')}
        ${kpi('مشتریان', faNum(c.customers), `${faNum(c.customers_without_id || 0)} نفر بدون شناسه ملی`)}
        ${kpi('پرسش‌های باز مدیریت', faNum(c.questions_open || 0), `از ${faNum(c.questions_total || 0)} پرسش رسمی بخش مالی`, c.questions_open ? 'warn-num' : '')}
      </div>
      <div class="intake-banner">
        <div class="banner-head">
          <h2>کانال یک‌پیامی شرکت — راحت‌ترین راه ارتباط مالی</h2>
          <button type="button" class="btn primary" id="goto-intake">رفتن به ورودی یکپارچه</button>
        </div>
        <p>کارمند فقط یک پیام آزاد می‌فرستد — متن، و اگر دارد عکس رسید — از ربات تلگرام یا از تب «ورودی یکپارچه» همین پنل. سیستم خودش نوع رویداد را تشخیص می‌دهد، مبلغ را می‌خواند و در ماژول درست ثبت می‌کند؛ چیزی که نوعش قطعی نباشد حدس زده نمی‌شود و می‌رود به صف تصمیم شما.</p>
        <div class="chips">
          <div class="chip"><span class="badge bad">خرید / هزینه</span><p>«خریدیم ۵۰ رام کاغذ A4، دو میلیون و چهارصد هزار تومان، از کارت شرکت» + عکس رسید</p></div>
          <div class="chip"><span class="badge ok">فروش / وصولی</span><p>«فروختیم ۱۰ تا ردیاب GT08 به شرکت نمونه، فاکتور ۱۲۳، واریز شد به حساب شرکت»</p></div>
          <div class="chip"><span class="badge navy">حقوق</span><p>«حقوق آبان رضا پرداخت شد، ۱۸ میلیون تومان، حواله به حساب خودش»</p></div>
        </div>
      </div>
      <div class="grid2">
        <div class="card"><h2 class="sec">مقایسه جریان مالی (${unitName()})</h2>${barChart([
          { label: 'درآمد', value: t.income_rial, color: '#2f8f5b' },
          { label: 'هزینه', value: t.expenses_rial, color: '#a83a26' },
          { label: 'حقوق', value: t.payroll_rial, color: '#102333' },
        ])}</div>
        <div class="card"><h2 class="sec">سهم دسته‌های هزینه</h2>${donutChart(s.expenses_by_category)}</div>
      </div>
      <div class="card" style="margin-top:12px"><h2 class="sec">دفاتر باز</h2>
        ${s.ledger_open.length ? `<table><tr><th>نوع</th><th>تعداد</th><th>جمع (${unitName()})</th></tr>${s.ledger_open.map((r) => `<tr><td>${ledgerKindFa(r.kind)}</td><td>${faNum(r.count)}</td><td>${faMoney(r.total)}</td></tr>`).join('')}</table>` : '<div class="empty">دفتر بازی وجود ندارد</div>'}
      </div>
      <div class="card" style="margin-top:12px"><h2 class="sec">حساب‌های بانکی</h2>
        ${bankAccounts.length ? `<table><tr><th>حساب</th><th>بانک</th><th>مانده افتتاحیه (${unitName()})</th></tr>${bankAccounts.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.bank || '')}</td><td>${faMoney(r.balance_rial)}</td></tr>`).join('')}<tr><td colspan="2"><b>جمع نقد — مانده افتتاحیه حساب‌ها</b></td><td><b>${faMoney(cashTotal)}</b></td></tr></table>` : '<div class="empty">هنوز حساب بانکی ثبت نشده است</div>'}
      </div>`;
    const gi = $('#goto-intake', el);
    if (gi) gi.addEventListener('click', () => {
      $$('#tabs .tab').forEach((tb) => tb.classList.toggle('active', tb.dataset.tab === 'intake'));
      loadTab('intake');
    });
  } catch (err) {
    el.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
}

function barChart(items) {
  const dv = (v) => Math.round(Number(v || 0) / unitDiv());
  const max = Math.max(...items.map((i) => dv(i.value)), 1);
  const W = 460, H = 190, base = 155, bw = 74;
  const gap = (W - items.length * bw) / (items.length + 1);
  let bars = '';
  items.forEach((it, i) => {
    const h = Math.round((dv(it.value) / max) * 120);
    const x = gap + i * (bw + gap);
    bars += `<rect x="${x}" y="${base - h}" width="${bw}" height="${h}" rx="5" fill="${it.color}"></rect>
      <text x="${x + bw / 2}" y="${base - h - 8}" text-anchor="middle" font-size="12">${faNum(dv(it.value))}</text>
      <text x="${x + bw / 2}" y="${base + 20}" text-anchor="middle" font-size="13">${it.label}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"><line x1="8" y1="${base}" x2="${W - 8}" y2="${base}" stroke="#dde3e8"/>${bars}</svg>`;
}

function donutChart(cats) {
  if (!cats || !cats.length) return '<div class="empty">هنوز هزینه‌ای ثبت نشده است</div>';
  const total = cats.reduce((a, c) => a + Number(c.total || 0), 0) || 1;
  const colors = ['#102333', '#c9a227', '#a83a26', '#8fae94', '#5b7fa6', '#d9b96a', '#7a5ba6'];
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

// ---------- Monitoring & analytics ----------
async function loadMonitoring() {
  const el = $('#tab-monitoring');
  el.innerHTML = '<p class="muted">در حال بارگذاری…</p>';
  try {
    const s = await api('/api/analytics/summary');
    const t = s.totals;
    const c = s.counts;
    const rows = await api('/api/registers/expenses').catch(() => []);
    const questions = await api('/api/questions').catch(() => []);
    // Panel definitions, same as the dashboard.
    const dupRows = rows.filter((r) => String(r.review_status || '').includes('تکراری'));
    const dupTotal = dupRows.reduce((a, r) => a + Number(r.amount_rial || 0), 0);
    const confirmedExp = t.expenses_rial - dupTotal;
    const netRial = t.income_rial - confirmedExp - t.payroll_rial;
    const attentionCount = rows.filter((r) => r.review_status !== 'تأیید شده').length;
    // Per-person expense totals + counts, from the register itself.
    const byPerson = {};
    rows.forEach((r) => {
      const p = r.person || 'نامشخص';
      if (!byPerson[p]) byPerson[p] = { total: 0, count: 0 };
      byPerson[p].total += Number(r.amount_rial || 0);
      byPerson[p].count += 1;
    });
    const personRows = Object.entries(byPerson).sort((a, b) => b[1].total - a[1].total);
    const personMax = personRows.length ? personRows[0][1].total : 0;
    // Automatic alerts: real gaps in the data, not guesses.
    const alerts = [];
    const noReceipt = rows.filter((r) => r.receipt_status === 'ندارد' && Number(r.amount_rial || 0) > 0);
    if (noReceipt.length) alerts.push(`${faNum(noReceipt.length)} هزینه بدون رسید ثبت شده است — جمع ${faMoney(noReceipt.reduce((a, r) => a + Number(r.amount_rial || 0), 0))}`);
    if (dupRows.length) alerts.push(`${faNum(dupRows.length)} ردیف تکراری هنوز در انتظار تصمیم شماست — ${faMoney(dupTotal)} در جمع هزینه‌ها هست و از هزینه قطعی کم شده است`);
    const incomplete = rows.filter((r) => ['نیازمند تکمیل', 'ناقص'].includes(r.review_status));
    if (incomplete.length) alerts.push(`${faNum(incomplete.length)} رکورد نیازمند تکمیل است (مبلغ یا شرح ناقص)`);
    if (s.events.unprocessed) alerts.push(`${faNum(s.events.unprocessed)} رویداد پردازش‌نشده در ورودی یکپارچه منتظر طبقه‌بندی است`);
    if (s.events.needs_review) alerts.push(`${faNum(s.events.needs_review)} رویداد در صف «نیازمند بررسی» منتظر تصمیم است`);
    const openQ = questions.filter((q) => q.status !== 'پاسخ داده شد').length;
    if (openQ) alerts.push(`${faNum(openQ)} پرسش مدیریت هنوز بی‌پاسخ است — پاسخ‌ها موجودی افتتاحیه و پیش‌بینی نقدینگی را روشن می‌کنند`);
    if (!t.income_rial) alerts.push('هنوز درآمدی ثبت نشده است؛ تراز فقط خروجی‌ها را نشان می‌دهد، نه مانده حساب‌ها را');
    const quality = rows.length ? Math.round(100 * rows.filter((r) => r.receipt_status === 'دارد' || Number(r.amount_rial || 0) === 0).length / rows.length) : 100;
    // Rule-based analysis: every figure below is computed from the rows above.
    const analysis = [];
    if (rows.length) {
      analysis.push(`تا امروز ${faNum(rows.length)} رکورد هزینه با جمع ${faMoney(t.expenses_rial)} ثبت شده است${dupTotal ? ` که ${faMoney(dupTotal)} آن ردیف تکراریِ در انتظار تصمیم است؛ هزینه قطعی ${faMoney(confirmedExp)} است` : ''}.`);
      const cats = (s.expenses_by_category || []).filter((x) => Number(x.total || 0) > 0);
      if (cats.length && t.expenses_rial) {
        const top = cats[0];
        analysis.push(`بزرگ‌ترین دسته «${top.category}» است با ${faMoney(top.total)}، یعنی ${faNum(Math.round(100 * Number(top.total) / t.expenses_rial))}٪ از کل هزینه‌ها.`);
      }
      if (personRows.length && t.expenses_rial) {
        const [pName, pVal] = personRows[0];
        analysis.push(`بیشترین ثبت هزینه به نام «${pName}» است: ${faMoney(pVal.total)} در ${faNum(pVal.count)} رکورد (${faNum(Math.round(100 * pVal.total / t.expenses_rial))}٪ از کل).`);
      }
      analysis.push(`پوشش رسید ${faNum(quality)}٪ است${noReceipt.length ? ` و ${faNum(noReceipt.length)} رکوردِ دارای مبلغ هنوز رسید ندارند` : ''}.`);
    } else {
      analysis.push('هنوز رکورد هزینه‌ای ثبت نشده است؛ به‌محض ثبت اولین رکوردها، تحلیل اینجا از روی همان اعداد واقعی ساخته می‌شود.');
    }
    if (!t.income_rial && !t.payroll_rial) analysis.push('درآمد و حقوقی هنوز ثبت نشده است؛ پس تراز فعلی فقط سمت خروجی شرکت را نشان می‌دهد و مانده حساب‌ها نیست.');
    if (openQ) analysis.push(`${faNum(openQ)} پرسش از ${faNum(questions.length)} پرسش رسمی بخش مالی هنوز بی‌پاسخ است؛ تا پاسخ‌ها نرسد، مانده‌های افتتاحیه و پیش‌بینی نقدینگی قابل ساخت نیست.`);
    const strip = (lbl, val, cls = '') => `<div class="card"><div class="lbl">${lbl}</div><div class="num ${cls}">${val}</div></div>`;
    el.innerHTML = `
      <div class="cards">
        ${strip('جمع هزینه‌های ثبت‌شده', faMoney(t.expenses_rial), 'neg')}
        ${strip('هزینه قطعی (بدون ردیف تکراری)', faMoney(confirmedExp), 'neg')}
        ${strip('جمع درآمدهای ثبت‌شده', faMoney(t.income_rial), 'pos')}
        ${strip('جمع حقوق و دستمزد', faMoney(t.payroll_rial))}
        ${strip('تراز ثبت‌شده', faMoney(netRial), netRial < 0 ? 'neg' : 'pos')}
      </div>
      <div class="grid2">
        <div class="card"><h2 class="sec">مقایسه جریان مالی (${unitName()})</h2>${barChart([
          { label: 'درآمد', value: t.income_rial, color: '#2f8f5b' },
          { label: 'هزینه', value: t.expenses_rial, color: '#a83a26' },
          { label: 'حقوق', value: t.payroll_rial, color: '#102333' },
        ])}</div>
        <div class="card"><h2 class="sec">سهم دسته‌های هزینه</h2>${donutChart(s.expenses_by_category)}</div>
      </div>
      <div class="grid2" style="margin-top:12px">
        <div class="card"><h2 class="sec">هزینه به تفکیک شخص</h2>
          ${personRows.length ? `<table><tr><th>شخص</th><th>سهم از کل</th><th>تعداد</th><th>جمع (${unitName()})</th></tr>${personRows.map(([p, v]) => `<tr><td>${esc(p)}</td><td><div class="pbar-track"><div class="pbar" style="width:${personMax ? Math.max(4, Math.round(100 * v.total / personMax)) : 0}%"></div></div></td><td>${faNum(v.count)}</td><td>${faMoney(v.total)}</td></tr>`).join('')}</table>` : '<div class="empty">هنوز هزینه‌ای ثبت نشده است</div>'}
        </div>
        <div class="card"><h2 class="sec">شاخص‌های کیفیت داده</h2>
          <div class="kpi-lbl">پوشش رسید</div><div class="kpi-num">${faNum(quality)}٪</div>
          <div class="kpi-cap">سهم رکوردهای هزینه با رسید (یا مبلغ صفر) از کل رکوردها</div>
          <div class="kpi-lbl" style="margin-top:10px">موارد نیازمند پیگیری</div><div class="kpi-num ${attentionCount ? 'warn-num' : ''}">${faNum(attentionCount)}</div>
          <div class="kpi-cap">رکوردهای هزینه که هنوز «تأیید شده» نیستند — پردازش‌نشده: ${faNum(s.events.unprocessed)}، نیازمند بررسی: ${faNum(s.events.needs_review)}</div>
          <div class="kpi-lbl" style="margin-top:10px">مشتریان بدون شناسه ملی</div><div class="kpi-num">${faNum(c.customers_without_id || 0)}</div>
          <div class="kpi-cap">از ${faNum(c.customers)} مشتری ثبت‌شده در داده‌های پایه</div>
        </div>
      </div>
      <div class="card" style="margin-top:12px"><h2 class="sec">هشدارهای خودکار</h2>
        ${alerts.length ? `<ul style="margin:0;padding-inline-start:18px">${alerts.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : '<div class="empty">هشداری نیست — داده‌ها کامل‌اند</div>'}
      </div>
      <div class="card" style="margin-top:12px"><h2 class="sec">تحلیل</h2>
        <p style="margin:0;line-height:2">${analysis.map(esc).join(' ')}</p>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
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
        ${photoFieldHTML('ev')}
      </div>
      <button class="btn primary" type="submit">ثبت رویداد</button>
    </form>` : ''}
    <div id="events-list">
      ${events.length ? events.map(eventCard).join('') : '<div class="empty">هنوز رویدادی ثبت نشده است</div>'}
    </div>`;
  const form = $('#event-form');
  if (form) {
    wirePhotoField('ev');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await api('/api/events', { method: 'POST', body: { raw_text: fd.get('raw_text'), sender_name: fd.get('sender_name'), amount_rial: fd.get('amount_rial') || undefined, receipt_image: photoStore.ev || undefined } });
        delete photoStore.ev;
        loadIntake();
      } catch (err) { alert(err.message); }
    });
  }
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
  const evImg = ev.receipt_image || (ev.payload && ev.payload.receipt_image);
  return `<div class="event-card">
    <div class="raw">${esc(ev.raw_text || '(بدون متن)')}</div>
    ${evImg ? `<div class="ev-photo">${thumbHTML(evImg)}</div>` : ''}
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
const REVIEW_STATUSES = ['در انتظار بررسی', 'تأیید شده', 'ناقص', 'نیازمند تکمیل', 'تکراری — در انتظار تصمیم', 'رد شده'];

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
        ${photoFieldHTML('reg')}
      </div>
      <button class="btn primary" type="submit">ثبت</button>
    </form>` : ''}
    <div class="card" style="margin-bottom:12px"><span class="lbl">جمع ${conf.title}: </span><b>${faMoney(total)}</b> — ${faNum(rows.length)} رکورد</div>
    ${rows.length ? `<div style="overflow-x:auto"><table><tr>${conf.cols.map((c) => `<th>${c[1]}</th>`).join('')}<th>وضعیت بررسی</th>${canWrite() ? '<th></th>' : ''}</tr>
      ${rows.map((r) => `<tr>
        ${conf.cols.map(([name, , kind2]) => (name === 'receipt_status'
          ? `<td>${thumbHTML(r.receipt_image)} ${esc(r.receipt_status ?? '')}</td>`
          : `<td>${kind2 === 'money' ? faMoney(r[name]) : esc(r[name] ?? '')}</td>`)).join('')}
        <td>${canWrite() ? `<select class="rv-sel" data-id="${r.id}">${REVIEW_STATUSES.map((s) => `<option ${s === r.review_status ? 'selected' : ''}>${s}</option>`).join('')}</select>` : `<span class="badge ${statusCls(r.review_status)}">${esc(r.review_status)}</span>`}</td>
        ${canWrite() ? `<td><button class="btn small rv-save" data-id="${r.id}">ذخیره</button></td>` : ''}
      </tr>`).join('')}
    </table></div>` : '<div class="empty">هنوز رکوردی ثبت نشده است</div>'}`;
  const form = $('#reg-form', el);
  if (form) {
    wirePhotoField('reg');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      new FormData(form).forEach((v, k) => { if (v !== '') body[k] = k === 'amount_rial' ? Number(v) : v; });
      if (photoStore.reg) { body.receipt_image = photoStore.reg; body.receipt_status = 'دارد'; }
      try {
        await api(`/api/registers/${kind}`, { method: 'POST', body });
        delete photoStore.reg;
        loadRegister(kind);
      } catch (err) { alert(err.message); }
    });
  }
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

// ---------- Tasks ----------
const TASK_STATUSES = ['در انتظار انجام', 'در حال انجام', 'انجام شد', 'نیازمند بررسی'];
const taskStatusCls = (s) => (s === 'انجام شد' ? 'ok' : s === 'در حال انجام' ? 'navy' : s === 'نیازمند بررسی' ? 'bad' : 'warn');

async function loadTasks() {
  const el = $('#tab-tasks');
  let rows = [];
  try { rows = await api('/api/tasks'); } catch (err) { el.innerHTML = `<div class="error">${esc(err.message)}</div>`; return; }
  const badge = document.getElementById('badge-tasks');
  if (badge) badge.textContent = rows.filter((r) => r.status !== 'انجام شد').length ? faNum(rows.filter((r) => r.status !== 'انجام شد').length) : '';
  el.innerHTML = `
    ${canWrite() ? `<form class="form-card" id="task-form"><h2 class="sec">تعریف وظیفه جدید</h2>
      <div class="form-grid">
        <label style="grid-column: span 2">عنوان وظیفه<input name="title" required placeholder="مثلاً: پیگیری وصول فاکتور ۱۲۳"></label>
        <label>مسئول انجام<input name="assignee" placeholder="نام کارمند"></label>
        <label>مهلت (شمسی)<input name="deadline" placeholder="۱۴۰۵/۰۹/۱۰"></label>
        <label style="grid-column: span 2">جزئیات<textarea name="details" rows="2"></textarea></label>
      </div><button class="btn primary" type="submit">تعریف وظیفه</button></form>` : ''}
    ${rows.length ? rows.map((r) => `<div class="kitem">
      <h3>${esc(r.title)} <span class="badge ${taskStatusCls(r.status)}">${esc(r.status)}</span></h3>
      <div class="muted">مسئول: ${esc(r.assignee || '—')} · مهلت: ${esc(r.deadline || '—')} · تعریف‌کننده: ${esc(r.created_by || '—')}</div>
      ${r.details ? `<div>${esc(r.details)}</div>` : ''}
      ${r.report ? `<div class="answer-box"><b>گزارش کارمند:</b> ${esc(r.report)}</div>` : ''}
      <div class="classify-row">
        <label>وضعیت<select class="tk-status" data-id="${r.id}">${TASK_STATUSES.map((s) => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>گزارش انجام کار<input class="tk-report" data-id="${r.id}" value="${esc(r.report || '')}" placeholder="گزارش پیشرفت یا نتیجه…"></label>
        <button class="btn primary tk-save" data-id="${r.id}">ثبت گزارش / وضعیت</button>
      </div>
    </div>`).join('') : '<div class="empty">هنوز وظیفه‌ای تعریف نشده است</div>'}`;
  const form = $('#task-form', el);
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    new FormData(form).forEach((v, k) => { if (v !== '') body[k] = v; });
    try { await api('/api/tasks', { method: 'POST', body }); loadTasks(); }
    catch (err) { alert(err.message); }
  });
  $$('.tk-save', el).forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.dataset.id;
    const status = $(`.tk-status[data-id="${id}"]`, el).value;
    const report = $(`.tk-report[data-id="${id}"]`, el).value;
    try { await api(`/api/tasks/${id}`, { method: 'PATCH', body: { status, report } }); loadTasks(); }
    catch (err) { alert(err.message); }
  }));
}

// ---------- Management questions ----------
// Questions live in their own `questions` table (migrated out of the
// knowledge base at boot). Grouped display, one answer form per question.
async function loadQuestions() {
  const el = $('#tab-questions');
  el.innerHTML = '<p class="muted">در حال بارگذاری…</p>';
  try {
    const rows = await api('/api/questions');
    const open = rows.filter((r) => r.status !== 'پاسخ داده شد').length;
    const badge = document.getElementById('badge-questions');
    if (badge) badge.textContent = open ? faNum(open) : '';
    const groups = [];
    const byGroup = {};
    rows.forEach((r) => {
      const g = r.group_name || 'بدون گروه';
      if (!byGroup[g]) { byGroup[g] = []; groups.push(g); }
      byGroup[g].push(r);
    });
    el.innerHTML = `
      <div class="card" style="margin-bottom:12px"><span class="lbl">پرسش‌های مدیریت: </span><b>${faNum(rows.length)} پرسش</b> — ${faNum(open)} بی‌پاسخ، ${faNum(rows.length - open)} پاسخ‌داده‌شده. پاسخ هر پرسش، حتی تقریبی، کار بخش مالی را جلو می‌برد.</div>
      ${rows.length ? groups.map((g) => `<h2 class="sec" style="margin-top:16px">${esc(g)}</h2>${byGroup[g].map((r) => {
        const answered = r.status === 'پاسخ داده شد';
        return `<div class="kitem"><h3>${esc(r.question)} <span class="badge ${answered ? 'ok' : 'warn'}">${answered ? 'پاسخ داده شده' : 'بی‌پاسخ'}</span></h3>
          ${answered && r.answer ? `<div class="answer-box"><b>پاسخ مدیریت:</b> ${esc(r.answer)}</div>` : ''}
          ${canWrite() ? `<div class="classify-row">
            <label>${answered ? 'ویرایش پاسخ' : 'پاسخ مدیریت'}<input class="qa-input" data-id="${r.id}" value="${answered ? esc(r.answer || '') : ''}" placeholder="پاسخ را اینجا بنویسید…"></label>
            <button class="btn primary qa-save" data-id="${r.id}">ثبت پاسخ</button>
          </div>` : ''}
        </div>`;
      }).join('')}`).join('') : '<div class="empty">هنوز پرسشی ثبت نشده است</div>'}`;
    $$('.qa-save', el).forEach((btn) => btn.addEventListener('click', async () => {
      const input = $(`.qa-input[data-id="${btn.dataset.id}"]`, el);
      const answer = input.value.trim();
      if (!answer) { alert('متن پاسخ را بنویسید'); return; }
      try {
        await api(`/api/questions/${btn.dataset.id}/answer`, { method: 'POST', body: { answer } });
        loadBadges();
        loadQuestions();
      } catch (err) { alert(err.message); }
    }));
  } catch (err) {
    el.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
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
