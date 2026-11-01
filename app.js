/* MyBizTools.my — app.js
 * No inline handlers (CSP-friendly). Working data lives in JS memory only. */
(function () {
  'use strict';

  /* ---------- CONFIG: fill these in when ready ---------- */
  const CONFIG = {
    APP_VERSION: '2026.10.29-a',
    // Stripe Payment Links, one per tip amount. Leave '' until your Stripe account is approved.
    // Format: 'https://buy.stripe.com/xxxxxxxx'
    STRIPE_LINKS: { 10: '', 20: '', 50: '' },
    // Optional: a Google Form (or similar) link where visitors suggest the next tool. Leave '' to disable.
    VOTE_FORM_URL: '',
    IDLE_CLEAR_MS: 30 * 60 * 1000,
    MAX_LOG_ENTRIES: 200
  };

  const TOOLS = {
    'sst-calculator': {
      title: 'SST & Profit Margin Calculator',
      desc: 'Calculate service tax (8% or 6%) or sales tax (10% or 5%), tax-inclusive or tax-exclusive prices, profit margin and markup, and 5-sen cash rounding.',
      template: 'tpl-sst-calculator',
      init: initSstCalculator
    }
  };

  const PILL_ACTIVE = 'cat-pill px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-600 text-white transition';
  const PILL_IDLE = 'cat-pill px-2.5 py-1 rounded-md text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 transition';
  const KOPI_ACTIVE = 'kopi-btn border-2 border-amber-500 bg-amber-50 text-slate-900 rounded-xl p-3 text-center transition';
  const KOPI_IDLE = 'kopi-btn border border-slate-200 hover:border-amber-400 rounded-xl p-3 text-center transition';

  const $ = (id) => document.getElementById(id);
  const refreshIcons = () => { if (window.MBTIcons) window.MBTIcons.refresh(); };

  /* =====================================================
   * MONEY MATHS — integer sen only, no floating point sums
   * ===================================================== */
  function parseSen(text) {
    if (text == null) return null;
    const cleaned = String(text).replace(/[,\s]/g, '').replace(/^RM/i, '');
    if (cleaned === '') return null;
    if (!/^\d*\.?\d+$|^\d+\.$/.test(cleaned)) return NaN;
    const n = Number(cleaned);
    if (!isFinite(n) || n > 1e12) return NaN;
    return Math.round(n * 100);
  }

  // Bank Negara rounding: nearest 5 sen. Last digit 1,2 -> down; 3,4 -> up; 6,7 -> down; 8,9 -> up.
  function roundTo5Sen(sen) {
    const r = sen % 5;
    if (r === 0) return sen;
    return r <= 2 ? sen - r : sen + (5 - r);
  }

  function formatSen(sen) {
    const sign = sen < 0 ? '-' : '';
    const abs = Math.abs(sen);
    const rm = Math.floor(abs / 100).toLocaleString('en-MY');
    const cents = String(abs % 100).padStart(2, '0');
    return sign + 'RM ' + rm + '.' + cents;
  }

  // basisPoints: 800 = 8.00%. mode: 'excl' | 'incl'.
  function calcSst({ amountSen, mode, basisPoints, costSen, cashRound }) {
    let net, tax, gross;
    if (mode === 'incl') {
      gross = amountSen;
      net = Math.round((gross * 10000) / (10000 + basisPoints));
      tax = gross - net;
    } else {
      net = amountSen;
      tax = Math.round((net * basisPoints) / 10000);
      gross = net + tax;
    }
    const payable = cashRound ? roundTo5Sen(gross) : gross;
    const out = { net, tax, gross, payable, adjustment: payable - gross, profit: null, marginPct: null, markupPct: null };
    if (costSen != null && !Number.isNaN(costSen)) {
      out.profit = net - costSen;
      out.marginPct = net > 0 ? (out.profit / net) * 100 : null;
      out.markupPct = costSen > 0 ? (out.profit / costSen) * 100 : null;
    }
    return out;
  }

  /* =====================================================
   * SESSION STORE — memory only; idle auto-clear; honest log
   * ===================================================== */
  const Session = {
    data: new Map(),
    blobUrls: new Set(),
    log: [],
    loggedKeys: new Set(),
    timer: null,
    lastClear: null,

    record(msg) {
      this.log.push('[' + new Date().toLocaleTimeString('en-MY') + '] ' + msg);
      if (this.log.length > CONFIG.MAX_LOG_ENTRIES) this.log.shift();
      const el = $('sessionAuditLog');
      if (el) el.textContent = this.log.join('\n');
    },
    set(key, value) {
      this.data.set(key, value);
      if (!this.loggedKeys.has(key)) {
        this.loggedKeys.add(key);
        this.record('Working data for "' + key + '" is now held in this tab\'s memory.');
      }
      this.touch();
    },
    get(key) { return this.data.get(key); },
    trackBlobUrl(url) { this.blobUrls.add(url); this.touch(); },
    touch() {
      clearTimeout(this.timer);
      if (this.data.size || this.blobUrls.size) {
        this.timer = setTimeout(() => this.clear('30 minutes of inactivity'), CONFIG.IDLE_CLEAR_MS);
      }
    },
    clear(reason) {
      clearTimeout(this.timer);
      const items = this.data.size;
      const urls = this.blobUrls.size;
      this.blobUrls.forEach((u) => URL.revokeObjectURL(u));
      this.blobUrls.clear();
      this.data.clear();
      this.loggedKeys.clear();
      this.lastClear = { at: new Date().toISOString(), reason, items, urls };
      this.record('Cleared (' + reason + '): ' + items + ' working-data item(s), ' + urls + ' temporary link(s).');
      const active = document.querySelector('#toolModuleContainer [data-tool-active]');
      if (active && active.dataset.toolActive === 'sst-calculator') resetSstFields();
    }
  };

  function buildReceipt() {
    const lines = [
      'MYBIZTOOLS.MY — SESSION RECEIPT',
      'Generated: ' + new Date().toISOString(),
      'Site version: ' + CONFIG.APP_VERSION,
      'Page: ' + location.origin + location.pathname,
      '',
      'AT THE MOMENT OF THIS RECEIPT',
      '- Working-data items held in this tab\'s memory: ' + Session.data.size,
      '- Temporary download links held: ' + Session.blobUrls.size,
      '- Automatic clearing: after 30 minutes of inactivity, or when the tab is closed',
      '',
      'LAST "CLEAR" EVENT',
      Session.lastClear
        ? '- ' + Session.lastClear.at + ' (' + Session.lastClear.reason + '): ' +
          Session.lastClear.items + ' item(s), ' + Session.lastClear.urls + ' link(s) removed'
        : '- None yet in this tab',
      '',
      'ACTIVITY LOG (this tab only)',
      ...Session.log,
      '',
      'HOW TO CHECK THIS YOURSELF',
      '1. Open your browser developer tools and choose the Network tab.',
      '2. Use a tool, then look at the requests listed.',
      '3. Confirm none of them carries your figures or files.',
      '',
      'LIMITS OF THIS RECEIPT',
      '- It is produced by this page from its own log, not by an independent party.',
      '- It does not cover content loaded by third parties (such as ads, once enabled),',
      '  your browser extensions, or copies you saved yourself.'
    ];
    return lines.join('\n');
  }

  function downloadReceipt() {
    const blob = new Blob([buildReceipt()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'MyBizTools_Session_Receipt_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    Session.record('Session receipt downloaded.');
  }

  /* =====================================================
   * MODALS — Escape, backdrop click, focus trap, scroll lock
   * ===================================================== */
  let lastFocus = null;
  let openModalId = null;

  function openModal(id) {
    const m = $(id);
    if (!m) return;
    lastFocus = document.activeElement;
    m.classList.remove('hidden');
    m.classList.add('flex');
    document.body.classList.add('overflow-hidden');
    openModalId = id;
    if (id === 'securityModal') {
      const el = $('sessionAuditLog');
      if (el) el.textContent = Session.log.join('\n');
    }
    const first = m.querySelector('button, [href], input, select, textarea');
    if (first) first.focus();
  }

  function closeModal() {
    if (!openModalId) return;
    const m = $(openModalId);
    m.classList.add('hidden');
    m.classList.remove('flex');
    document.body.classList.remove('overflow-hidden');
    openModalId = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.addEventListener('keydown', (e) => {
    if (!openModalId) return;
    if (e.key === 'Escape') { closeModal(); return; }
    if (e.key === 'Tab') {
      const focusable = $(openModalId).querySelectorAll('button:not([disabled]), [href], input, select, textarea');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* =====================================================
   * ROUTING — #tool-key, so Back button and links work
   * ===================================================== */
  function showHome() {
    $('toolWorkspaceView').classList.add('hidden');
    $('dashboardView').classList.remove('hidden');
    document.title = 'MyBizTools.my | Free Malaysian Business Tools';
  }

  function showTool(key) {
    const tool = TOOLS[key];
    const tpl = $(tool.template);
    const container = $('toolModuleContainer');
    container.replaceChildren();
    const wrap = document.createElement('div');
    wrap.dataset.toolActive = key;
    wrap.appendChild(tpl.content.cloneNode(true));
    container.appendChild(wrap);
    $('activeToolTitle').textContent = tool.title;
    $('activeToolDesc').textContent = tool.desc;
    $('dashboardView').classList.add('hidden');
    $('toolWorkspaceView').classList.remove('hidden');
    document.title = tool.title + ' | MyBizTools.my';
    tool.init(wrap);
    refreshIcons();
    $('activeToolTitle').focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }

  function route() {
    const key = decodeURIComponent(location.hash.slice(1));
    if (Object.prototype.hasOwnProperty.call(TOOLS, key)) showTool(key);
    else showHome();
  }

  function goHome() {
    if (location.hash) history.pushState(null, '', location.pathname + location.search);
    route();
    window.scrollTo({ top: 0 });
  }

  /* =====================================================
   * SEARCH + CATEGORY FILTER (combined)
   * ===================================================== */
  let currentCategory = 'all';

  function applyFilters() {
    const q = $('toolSearch').value.trim().toLowerCase();
    let visibleTotal = 0;
    document.querySelectorAll('.tool-card').forEach((card) => {
      const catOk = currentCategory === 'all' || card.dataset.cat === currentCategory;
      const text = (card.dataset.name + ' ' + card.textContent).toLowerCase();
      const show = catOk && (q === '' || text.includes(q));
      card.classList.toggle('hidden', !show);
      if (show) visibleTotal++;
    });
    document.querySelectorAll('.suite-section').forEach((sec) => {
      sec.classList.toggle('hidden', sec.querySelectorAll('.tool-card:not(.hidden)').length === 0);
    });
    $('noResults').classList.toggle('hidden', visibleTotal > 0);
  }

  function setCategory(cat) {
    currentCategory = cat;
    document.querySelectorAll('.cat-pill').forEach((btn) => {
      const on = btn.dataset.cat === cat;
      btn.className = on ? PILL_ACTIVE : PILL_IDLE;
      btn.setAttribute('aria-pressed', String(on));
    });
    applyFilters();
  }

  /* =====================================================
   * TIP JAR — real Stripe Payment Links, or an honest "not open yet"
   * ===================================================== */
  let kopiAmount = 10;

  function validLink(url) { return typeof url === 'string' && /^https:\/\/[^\s]+$/.test(url); }

  function updateKopiUI() {
    [10, 20, 50].forEach((v) => {
      const b = $('kopi-' + v);
      const on = v === kopiAmount;
      b.className = on ? KOPI_ACTIVE : KOPI_IDLE;
      b.setAttribute('aria-pressed', String(on));
    });
    const ready = validLink(CONFIG.STRIPE_LINKS[kopiAmount]);
    $('kopiSubmitBtn').disabled = !ready;
    $('kopiSubmitBtn').textContent = ready ? 'Tip RM ' + kopiAmount + ' securely' : 'Tip jar opens soon';
    $('kopiNote').textContent = ready ? 'You will be taken to Stripe\'s secure checkout.' : 'The tip jar is not open yet. Thank you for the thought!';
  }

  function kopiCheckout() {
    const link = CONFIG.STRIPE_LINKS[kopiAmount];
    if (!validLink(link)) return;
    window.open(link, '_blank', 'noopener,noreferrer');
    closeModal();
  }

  /* =====================================================
   * PHASE 2 SUGGESTIONS — honest: only claims what really happens
   * ===================================================== */
  function suggestTool(name) {
    const fb = $('voteFeedback');
    if (validLink(CONFIG.VOTE_FORM_URL)) {
      window.open(CONFIG.VOTE_FORM_URL, '_blank', 'noopener,noreferrer');
      fb.textContent = 'Opening the suggestion form for "' + name + '"';
    } else {
      fb.textContent = 'Suggestions open soon. Thanks for your interest in "' + name + '"!';
    }
  }

  /* =====================================================
   * SST CALCULATOR UI
   * ===================================================== */
  const SST_KEY = 'sst-calculator';

  function sstEls() {
    return {
      rate: $('sst-rate'), amount: $('sst-amount'), cost: $('sst-cost'), round: $('sst-round'),
      modes: document.querySelectorAll('input[name="sst-mode"]'), err: $('sst-error')
    };
  }

  function resetSstFields() {
    const e = sstEls();
    if (!e.rate) return;
    e.rate.value = '800'; e.amount.value = ''; e.cost.value = ''; e.round.checked = false;
    e.modes.forEach((r) => { r.checked = r.value === 'excl'; });
    renderSst();
  }

  function renderSst() {
    const e = sstEls();
    if (!e.rate) return;
    const mode = [...e.modes].find((r) => r.checked).value;
    const amountSen = parseSen(e.amount.value);
    const costSen = parseSen(e.cost.value);
    const bp = Number(e.rate.value);

    if (e.amount.value.trim() || e.cost.value.trim()) {
      Session.set(SST_KEY, { rate: e.rate.value, amount: e.amount.value, cost: e.cost.value, round: e.round.checked, mode });
    }

    const show = (id, visible) => $(id).classList.toggle('hidden', !visible);
    const blank = () => {
      ['out-net', 'out-tax', 'out-gross', 'out-adj', 'out-payable', 'out-profit', 'out-margin', 'out-markup']
        .forEach((id) => { $(id).textContent = '—'; });
      $('out-rate').textContent = (bp / 100) + '%';
      show('row-rounding', false); show('row-payable', false); show('margin-block', false);
    };

    let error = '';
    if (Number.isNaN(amountSen)) error = 'Enter the price as a number, for example 1250 or 1,250.50.';
    else if (Number.isNaN(costSen)) error = 'Enter your cost as a number, for example 800 or 800.00.';
    e.err.textContent = error;
    e.err.classList.toggle('hidden', !error);

    if (amountSen == null || Number.isNaN(amountSen)) { blank(); return; }

    const r = calcSst({ amountSen, mode, basisPoints: bp, costSen: Number.isNaN(costSen) ? null : costSen, cashRound: e.round.checked });
    $('out-rate').textContent = (bp / 100) + '%';
    $('out-net').textContent = formatSen(r.net);
    $('out-tax').textContent = formatSen(r.tax);
    $('out-gross').textContent = formatSen(r.gross);
    show('row-rounding', e.round.checked);
    show('row-payable', e.round.checked);
    if (e.round.checked) {
      $('out-adj').textContent = (r.adjustment > 0 ? '+' : r.adjustment < 0 ? '-' : '') + 'RM ' + (Math.abs(r.adjustment) / 100).toFixed(2);
      $('out-payable').textContent = formatSen(r.payable);
    }
    const hasCost = r.profit != null;
    show('margin-block', hasCost);
    if (hasCost) {
      $('out-profit').textContent = formatSen(r.profit);
      $('out-margin').textContent = r.marginPct == null ? 'n/a' : r.marginPct.toFixed(2) + '%';
      $('out-markup').textContent = r.markupPct == null ? 'n/a' : r.markupPct.toFixed(2) + '%';
    }
  }

  function initSstCalculator() {
    const saved = Session.get(SST_KEY);
    const e = sstEls();
    if (saved) {
      e.rate.value = saved.rate; e.amount.value = saved.amount; e.cost.value = saved.cost; e.round.checked = saved.round;
      e.modes.forEach((r) => { r.checked = r.value === saved.mode; });
    }
    [e.rate, e.amount, e.cost, e.round, ...e.modes].forEach((el) => {
      el.addEventListener('input', renderSst);
      el.addEventListener('change', renderSst);
    });
    renderSst();
  }

  /* =====================================================
   * EVENT WIRING (delegation — no inline onclick anywhere)
   * ===================================================== */
  document.addEventListener('click', (ev) => {
    const modalRoot = ev.target.closest('[data-modal-root]');
    if (modalRoot && ev.target === modalRoot) { closeModal(); return; }

    const card = ev.target.closest('[data-tool]');
    if (card) { location.hash = card.dataset.tool; return; }

    const el = ev.target.closest('[data-action]');
    if (!el) return;
    switch (el.dataset.action) {
      case 'go-home': ev.preventDefault(); goHome(); break;
      case 'open-modal': openModal(el.dataset.modal); break;
      case 'close-modal': closeModal(); break;
      case 'set-category': setCategory(el.dataset.cat); break;
      case 'kopi-amount': kopiAmount = Number(el.dataset.amount); updateKopiUI(); break;
      case 'kopi-checkout': kopiCheckout(); break;
      case 'vote': suggestTool(el.dataset.toolName); break;
      case 'purge': Session.clear('you pressed Clear memory'); break;
      case 'download-receipt': downloadReceipt(); break;
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const card = ev.target.closest && ev.target.closest('[data-tool]');
    if (card && ev.target === card) { ev.preventDefault(); location.hash = card.dataset.tool; }
  });

  $('toolSearch').addEventListener('input', applyFilters);
  window.addEventListener('hashchange', route);
  window.addEventListener('pagehide', () => Session.clear('you left or closed the page'));

  /* ---------- Boot ---------- */
  Session.record('Ready. Nothing is held in this tab\'s memory yet.');
  updateKopiUI();
  refreshIcons();
  route();

  // Expose pure functions for testing only.
  window.MBT = { parseSen, roundTo5Sen, formatSen, calcSst };
})();
