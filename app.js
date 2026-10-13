(() => {
  'use strict';

  const STORAGE_KEY = 'kurs-belanja-impor-state-v1';
  const DIVISION_SCALE = 34;
  const MAX_DIGITS = 100;
  const MAX_SCALE = 100;
  const TEN = 10n;
  const pow10 = n => TEN ** BigInt(n);

  function decimal(n, scale = 0) {
    if (scale < 0 || scale > MAX_SCALE) throw new Error('Hasil terlalu besar.');
    if (n === 0n) return { n: 0n, s: 0 };
    while (scale > 0 && n % 10n === 0n) { n /= 10n; scale--; }
    checkDecimal(n, scale);
    return { n, s: scale };
  }
  function checkDecimal(n, scale) {
    const abs = n < 0n ? -n : n;
    if (scale > MAX_SCALE || abs.toString().length > MAX_DIGITS || abs >= pow10(MAX_DIGITS + scale)) throw new Error('Hasil terlalu besar.');
  }
  function parseDecimal(text) {
    const value = String(text).trim();
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) throw new Error('Masukkan angka desimal yang valid.');
    const parts = value.split('.');
    const scale = (parts[1] || '').length;
    if (scale > MAX_SCALE) throw new Error('Angka memiliki terlalu banyak digit desimal.');
    return decimal(BigInt((parts[0] || '0') + (parts[1] || '')), scale);
  }
  function align(a, b) {
    const s = Math.max(a.s, b.s);
    return [a.n * pow10(s - a.s), b.n * pow10(s - b.s), s];
  }
  function add(a, b) { const [x, y, s] = align(a, b); return decimal(x + y, s); }
  function subtract(a, b) { const [x, y, s] = align(a, b); return decimal(x - y, s); }
  function multiply(a, b) { return decimal(a.n * b.n, a.s + b.s); }
  function divide(a, b) {
    if (b.n === 0n) throw new Error('Tidak bisa membagi dengan nol.');
    // Keep 34 fractional digits for non-terminating quotients, then round once.
    const exponent = b.s + DIVISION_SCALE - a.s;
    let numerator = a.n;
    let denominator = b.n;
    if (exponent >= 0) numerator *= pow10(exponent); else denominator *= pow10(-exponent);
    if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
    let quotient = numerator / denominator;
    const remainder = numerator % denominator;
    const absRemainder = remainder < 0n ? -remainder : remainder;
    if (absRemainder * 2n >= denominator) quotient += numerator < 0n ? -1n : 1n;
    return decimal(quotient, DIVISION_SCALE);
  }
  function negate(a) { return decimal(-a.n, a.s); }
  function compare(a, b) { const [x, y] = align(a, b); return x < y ? -1 : x > y ? 1 : 0; }
  function decimalString(value) {
    const d = typeof value === 'string' ? parseDecimal(value) : value;
    const negative = d.n < 0n;
    let digits = (negative ? -d.n : d.n).toString();
    if (d.s > 0) {
      digits = digits.padStart(d.s + 1, '0');
      digits = digits.slice(0, -d.s) + '.' + digits.slice(-d.s);
    }
    return (negative ? '-' : '') + digits;
  }
  function roundedInteger(d) {
    if (d.s === 0) return d.n;
    const base = pow10(d.s);
    let q = d.n / base;
    const r = d.n % base;
    if ((r < 0n ? -r : r) * 2n >= base) q += d.n < 0n ? -1n : 1n;
    return q;
  }

  class ExpressionParser {
    constructor(source) { this.source = source; this.position = 0; }
    spaces() { while (/\s/.test(this.source[this.position] || '\u0000')) this.position++; }
    take(char) { this.spaces(); if (this.source[this.position] === char) { this.position++; return true; } return false; }
    expression() {
      let value = this.term();
      while (true) {
        if (this.take('+')) value = add(value, this.term());
        else if (this.take('-')) value = subtract(value, this.term());
        else return value;
      }
    }
    term() {
      let value = this.unary();
      while (true) {
        if (this.take('*')) value = multiply(value, this.unary());
        else if (this.take('/')) value = divide(value, this.unary());
        else return value;
      }
    }
    unary() {
      if (this.take('+')) return this.unary();
      if (this.take('-')) return negate(this.unary());
      return this.atom();
    }
    atom() {
      if (this.take('(')) {
        const value = this.expression();
        if (!this.take(')')) throw new Error('Kurung tutup belum ada.');
        return value;
      }
      this.spaces();
      const start = this.position;
      let sawDot = false;
      while (this.position < this.source.length) {
        const char = this.source[this.position];
        if (char >= '0' && char <= '9') this.position++;
        else if (char === '.' && !sawDot) { sawDot = true; this.position++; }
        else break;
      }
      const token = this.source.slice(start, this.position);
      if (!token || token === '.') throw new Error(`Angka atau operator tidak valid pada posisi ${start + 1}.`);
      return parseDecimal(token);
    }
  }
  function evaluate(expression) {
    const source = String(expression).trim();
    if (!source) throw new Error('Masukkan ekspresi terlebih dahulu.');
    if (source.length > 256) throw new Error('Ekspresi terlalu panjang.');
    const parser = new ExpressionParser(source);
    const result = parser.expression();
    parser.spaces();
    if (parser.position !== source.length) throw new Error(`Karakter tidak valid pada posisi ${parser.position + 1}.`);
    if (result.n < 0n) throw new Error('Nilai item tidak boleh negatif.');
    return result;
  }

  // Expose the pure calculator core to Node's built-in test runner; browser UI stays dependency-free.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { evaluate, parseDecimal, decimalString, add, subtract, multiply, divide, roundedInteger };
    return;
  }

  const $ = id => document.getElementById(id);
  const el = {
    sessionName: $('sessionName'), sessionMeta: $('sessionMeta'), rateInput: $('rateInput'), rateError: $('rateError'),
    itemName: $('itemName'), expression: $('expressionInput'), expressionError: $('expressionError'), previewBox: $('previewBox'), previewValue: $('previewValue'),
    itemList: $('itemList'), emptyState: $('emptyState'), itemCount: $('itemCount'), totalCount: $('totalCount'), totalYuan: $('totalYuan'),
    totalRupiah: $('totalRupiah'), summaryRate: $('summaryRate'), sessionDialog: $('sessionsDialog'), sessionList: $('sessionList'),
    nameDialog: $('nameDialog'), nameInput: $('sessionNameInput'), nameError: $('nameError'), nameTitle: $('nameDialogTitle'),
    nameEyebrow: $('nameDialogEyebrow'), confirmDialog: $('confirmDialog'), confirmTitle: $('confirmTitle'), confirmMessage: $('confirmMessage'),
    confirmAction: $('confirmAction'), toast: $('toast'), installButton: $('installButton')
  };
  const currencyFormatter = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
  const rupiah = value => `Rp${currencyFormatter.format(typeof value === 'bigint' ? value : roundedInteger(value))}`;
  const yuan = value => decimalString(value);
  const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const newSessionData = (name, rate) => ({ id: makeId(), name, rate, items: [], updatedAt: Date.now() });
  function validateSessionMath(session) {
    const rate = parseDecimal(session.rate);
    if (compare(rate, decimal(0n)) <= 0) throw new Error('Kurs harus lebih besar dari nol.');
    let total = decimal(0n);
    for (const item of session.items) {
      const amount = parseDecimal(item.yuan);
      total = add(total, amount);
      multiply(amount, rate);
    }
    multiply(total, rate);
  }

  function defaultState() {
    const session = newSessionData('Belanja Baru', '2700');
    return { sessions: [session], activeId: session.id, lastRate: '2700' };
  }
  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || !Array.isArray(saved.sessions)) return defaultState();
      const sessions = saved.sessions.filter(s => s && typeof s.id === 'string' && typeof s.name === 'string' && Array.isArray(s.items)).map(s => {
        const rate = parseDecimal(s.rate);
        if (compare(rate, decimal(0n)) <= 0) throw new Error('Kurs sesi tidak valid.');
        const items = s.items.filter(item => item && typeof item.name === 'string' && typeof item.expression === 'string').map(item => {
          const amount = parseDecimal(item.yuan);
          return { id: String(item.id || makeId()), name: item.name, expression: item.expression, yuan: decimalString(amount) };
        });
        return { id: s.id, name: s.name, rate: decimalString(rate), items, updatedAt: Number(s.updatedAt) || Date.now() };
      });
      if (!sessions.length) return defaultState();
      sessions.forEach(validateSessionMath);
      const activeId = sessions.some(s => s.id === saved.activeId) ? saved.activeId : sessions[0].id;
      const lastRate = decimalString(parseDecimal(saved.lastRate || sessions[0].rate));
      return { sessions, activeId, lastRate };
    } catch (_) { return defaultState(); }
  }
  let state = loadState();
  let toastTimer;
  let confirmCallback = null;
  let nameMode = 'new';
  let installPrompt = null;

  const active = () => state.sessions.find(session => session.id === state.activeId) || state.sessions[0];
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (_) { showToast('Penyimpanan browser penuh. Ekspor ringkasan untuk menyimpan salinan.'); }
  }
  function formatDate(timestamp) {
    try { return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp)); }
    catch (_) { return ''; }
  }
  function sessionTotal(session) {
    return session.items.reduce((sum, item) => add(sum, parseDecimal(item.yuan)), decimal(0n));
  }
  function render() {
    const session = active();
    if (!session) return;
    const total = sessionTotal(session);
    const rate = parseDecimal(session.rate);
    const totalRupiah = roundedInteger(multiply(total, rate));
    el.sessionName.textContent = session.name;
    el.sessionMeta.textContent = `${session.items.length} item · terakhir diperbarui ${formatDate(session.updatedAt)}`;
    el.itemCount.textContent = String(session.items.length);
    el.totalCount.textContent = `${session.items.length} ${session.items.length === 1 ? 'item' : 'item'}`;
    el.totalYuan.textContent = `¥${yuan(total)}`;
    el.totalRupiah.textContent = rupiah(totalRupiah);
    el.summaryRate.textContent = `Kurs 1 CNY = ${rupiah(rate)}`;
    el.emptyState.hidden = session.items.length !== 0;
    el.itemList.replaceChildren();
    session.items.forEach((item, index) => {
      const amount = parseDecimal(item.yuan);
      const card = document.createElement('article');
      card.className = 'item-card';
      const main = document.createElement('div');
      main.className = 'item-main';
      const title = document.createElement('h3');
      title.className = 'item-title';
      title.textContent = `${index + 1}. ${item.name}`;
      const expression = document.createElement('p');
      expression.className = 'item-expression';
      expression.textContent = `Ekspresi: ${item.expression}`;
      const result = document.createElement('p');
      result.className = 'item-result';
      result.textContent = `¥${yuan(amount)} = ${rupiah(roundedInteger(multiply(amount, rate)))}`;
      const remove = document.createElement('button');
      remove.className = 'delete-item';
      remove.type = 'button';
      remove.setAttribute('aria-label', `Hapus ${item.name}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        session.items = session.items.filter(candidate => candidate.id !== item.id);
        session.updatedAt = Date.now(); save(); render(); showToast('Item dihapus.');
      });
      main.append(title, expression, result);
      card.append(main, remove);
      el.itemList.append(card);
    });
  }
  function renderSessions() {
    el.sessionList.replaceChildren();
    [...state.sessions].sort((a, b) => b.updatedAt - a.updatedAt).forEach(session => {
      const row = document.createElement('div');
      row.className = 'session-row';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'session-open';
      const title = document.createElement('strong');
      title.textContent = `${session.id === state.activeId ? '✓ ' : ''}${session.name}`;
      const info = document.createElement('span');
      info.textContent = `${session.items.length} item · 1 CNY = ${rupiah(parseDecimal(session.rate))} · ${formatDate(session.updatedAt)}`;
      open.append(title, info);
      open.addEventListener('click', () => {
        state.activeId = session.id;
        el.rateInput.value = session.rate;
        save(); render(); el.sessionDialog.close();
      });
      const remove = document.createElement('button');
      remove.className = 'session-delete';
      remove.type = 'button';
      remove.setAttribute('aria-label', `Hapus sesi ${session.name}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => confirmDeleteSession(session));
      row.append(open, remove);
      el.sessionList.append(row);
    });
  }
  function clearDraft() {
    el.itemName.value = '';
    el.expression.value = '';
    el.expressionError.hidden = true;
    el.previewBox.hidden = true;
    el.itemName.focus();
  }
  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2300);
  }
  function setError(element, message) {
    element.textContent = message;
    element.hidden = !message;
  }
  function updatePreview() {
    const expression = el.expression.value;
    if (!expression.trim()) {
      el.previewBox.hidden = true;
      setError(el.expressionError, '');
      return;
    }
    try {
      const result = evaluate(expression);
      const rupiahValue = roundedInteger(multiply(result, parseDecimal(active().rate)));
      el.previewValue.textContent = `¥${yuan(result)} = ${rupiah(rupiahValue)}`;
      el.previewBox.hidden = false;
      setError(el.expressionError, '');
    } catch (error) {
      el.previewBox.hidden = true;
      setError(el.expressionError, error.message || 'Ekspresi tidak valid.');
    }
  }
  function addItem() {
    const name = el.itemName.value.trim();
    if (!name) { setError(el.expressionError, 'Nama item tidak boleh kosong.'); el.itemName.focus(); return; }
    try {
      const amount = evaluate(el.expression.value);
      const item = { id: makeId(), name, expression: el.expression.value.trim(), yuan: yuan(amount) };
      validateSessionMath({ ...active(), items: [...active().items, item] });
      active().items.push(item);
      active().updatedAt = Date.now();
      save(); render(); clearDraft(); showToast('Item ditambahkan ke daftar.');
    } catch (error) {
      el.previewBox.hidden = true;
      setError(el.expressionError, error.message || 'Ekspresi tidak valid.');
      el.expression.focus();
    }
  }
  function applyRate() {
    try {
      const rate = parseDecimal(el.rateInput.value);
      if (compare(rate, decimal(0n)) <= 0) throw new Error('Kurs harus lebih besar dari nol.');
      validateSessionMath({ ...active(), rate: yuan(rate) });
      active().rate = yuan(rate);
      active().updatedAt = Date.now();
      state.lastRate = yuan(rate);
      el.rateInput.value = state.lastRate;
      setError(el.rateError, '');
      save(); render(); updatePreview(); showToast('Kurs diperbarui; Rupiah seluruh item dihitung ulang.');
    } catch (error) { setError(el.rateError, error.message || 'Kurs tidak valid.'); }
  }
  function openNameDialog(mode) {
    nameMode = mode;
    el.nameEyebrow.textContent = mode === 'new' ? 'SESI BARU' : 'SESI BELANJA';
    el.nameTitle.textContent = mode === 'new' ? 'Buat sesi belanja' : 'Ubah nama sesi';
    el.nameInput.value = mode === 'new' ? '' : active().name;
    setError(el.nameError, '');
    el.nameDialog.showModal();
    setTimeout(() => el.nameInput.focus(), 0);
  }
  function createSession(name) {
    const session = newSessionData(name || 'Belanja Baru', state.lastRate);
    state.sessions.push(session);
    state.activeId = session.id;
    el.rateInput.value = session.rate;
    save(); render(); clearDraft();
  }
  function submitName(event) {
    event.preventDefault();
    const name = el.nameInput.value.trim();
    if (!name) { setError(el.nameError, 'Nama sesi tidak boleh kosong.'); el.nameInput.focus(); return; }
    if (nameMode === 'new') createSession(name);
    else { active().name = name; active().updatedAt = Date.now(); save(); render(); }
    el.nameDialog.close();
    if (nameMode === 'new') showToast('Sesi belanja baru dibuat.'); else showToast('Nama sesi diperbarui.');
  }
  function requestConfirm(title, message, buttonText, callback, danger = true) {
    el.confirmTitle.textContent = title;
    el.confirmMessage.textContent = message;
    el.confirmAction.textContent = buttonText;
    el.confirmAction.className = `button ${danger ? 'button-danger' : 'button-primary'}`;
    confirmCallback = callback;
    el.confirmDialog.showModal();
  }
  function confirmDeleteSession(session) {
    if (state.sessions.length === 1) {
      requestConfirm('Hapus sesi ini?', 'Ini adalah satu-satunya sesi. Isinya akan dikosongkan dan sesinya tetap tersedia.', 'Kosongkan', () => {
        session.items = []; session.updatedAt = Date.now(); save(); render(); renderSessions(); showToast('Daftar pada sesi dikosongkan.');
      });
      return;
    }
    requestConfirm('Hapus sesi?', `Sesi “${session.name}” beserta semua itemnya akan dihapus.`, 'Hapus sesi', () => {
      state.sessions = state.sessions.filter(candidate => candidate.id !== session.id);
      if (state.activeId === session.id) {
        state.activeId = [...state.sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
        el.rateInput.value = active().rate;
      }
      save(); render(); renderSessions(); showToast('Sesi dihapus.');
    });
  }
  function summaryText(session = active()) {
    const rate = parseDecimal(session.rate);
    const total = sessionTotal(session);
    const lines = ['RINGKASAN BELANJA IMPOR', `Sesi: ${session.name}`, `Kurs: 1 CNY = ${rupiah(rate)}`, ''];
    session.items.forEach((item, index) => {
      const amount = parseDecimal(item.yuan);
      lines.push(`${index + 1}. ${item.name}`, `   Ekspresi: ${item.expression}`, `   Total: ¥${yuan(amount)} = ${rupiah(roundedInteger(multiply(amount, rate)))}`, '');
    });
    lines.push(`TOTAL: ¥${yuan(total)} = ${rupiah(roundedInteger(multiply(total, rate)))}`);
    return lines.join('\n');
  }
  async function copySummary() {
    const text = summaryText();
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const helper = document.createElement('textarea');
        helper.value = text; helper.style.position = 'fixed'; helper.style.opacity = '0';
        document.body.append(helper); helper.select();
        if (!document.execCommand('copy')) throw new Error('Clipboard tidak tersedia.');
        helper.remove();
      }
      showToast('Ringkasan disalin ke clipboard.');
    } catch (_) { showToast('Gagal menyalin. Coba buka aplikasi melalui HTTPS.'); }
  }
  function exportSummary() {
    try {
      const blob = new Blob([summaryText()], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const safeName = active().name.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '') || 'belanja-impor';
      anchor.href = url; anchor.download = `${safeName}.txt`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('File ringkasan TXT berhasil dibuat.');
    } catch (_) { showToast('Gagal membuat file ringkasan.'); }
  }

  $('applyRateButton').addEventListener('click', applyRate);
  el.rateInput.addEventListener('keydown', event => { if (event.key === 'Enter') applyRate(); });
  el.expression.addEventListener('input', updatePreview);
  el.expression.addEventListener('keydown', event => { if (event.key === 'Enter') addItem(); });
  el.itemName.addEventListener('keydown', event => { if (event.key === 'Enter') el.expression.focus(); });
  $('addItemButton').addEventListener('click', addItem);
  $('clearInputButton').addEventListener('click', clearDraft);
  $('backspaceButton').addEventListener('click', () => { el.expression.value = el.expression.value.slice(0, -1); updatePreview(); el.expression.focus(); });
  $('historyButton').addEventListener('click', () => { renderSessions(); el.sessionDialog.showModal(); });
  $('newSessionButton').addEventListener('click', () => openNameDialog('new'));
  $('dialogNewSession').addEventListener('click', () => { el.sessionDialog.close(); openNameDialog('new'); });
  $('renameButton').addEventListener('click', () => openNameDialog('rename'));
  $('nameForm').addEventListener('submit', submitName);
  document.querySelectorAll('[data-close-name]').forEach(button => button.addEventListener('click', () => el.nameDialog.close()));
  document.querySelectorAll('[data-close-confirm]').forEach(button => button.addEventListener('click', () => el.confirmDialog.close()));
  $('confirmForm').addEventListener('submit', event => { event.preventDefault(); const callback = confirmCallback; confirmCallback = null; el.confirmDialog.close(); callback?.(); });
  $('clearAllButton').addEventListener('click', () => {
    if (!active().items.length) { showToast('Daftar belanja sudah kosong.'); return; }
    requestConfirm('Hapus semua item?', `Semua ${active().items.length} item pada sesi ini akan dihapus.`, 'Hapus semua', () => {
      active().items = []; active().updatedAt = Date.now(); save(); render(); showToast('Semua item dihapus.');
    });
  });
  $('copyButton').addEventListener('click', copySummary);
  $('exportButton').addEventListener('click', exportSummary);
  el.installButton.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    el.installButton.hidden = true;
  });
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event; el.installButton.hidden = false;
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; el.installButton.hidden = true; showToast('Aplikasi berhasil dipasang.'); });
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY) { state = loadState(); el.rateInput.value = active().rate; render(); }
  });

  el.rateInput.value = active().rate;
  render();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => showToast('Mode offline belum aktif; coba muat ulang halaman.')));
  }
})();
