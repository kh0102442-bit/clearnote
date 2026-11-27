/* ============================================================
   js/chat-ui.js — الجزء 1/3
   المحتوى: الاستيراد والثوابت والأيقونات، أدوات DOM، التنسيق،
            الحالة، الإشعارات، القوائم المنبثقة، الحوارات،
            الهيكل العام، قائمة المحادثات، والتبويبات.

   يُكمَل في الجزء 2/3: الغرفة والرسائل والسحب للرد والإدخال.
   يُكمَل في الجزء 3/3: البحث داخل المحادثة، والتحويل، والاختصارات،
                        والربط بأحداث ChatCore، والتصدير.

   حقن الاعتماديات (يُستدعى من chat.html بعد تحميل الوحدات الأخرى):
     ChatUI.use({
       media:     { pick(chatId, opts), recordVoice(chatId, opts),
                    renderAttachment(attachment, msg) => Node,
                    openAttachment(attachment) },
       settings:  { open(chatView) },
       profile:   { open(uid) },           // اختياري
       startChat: () => {},                // اختياري: لوحة بحث عن مستخدم
     });
   أي اعتمادية غير موجودة تُعطّل زرّها بهدوء ولا تكسر الواجهة.
   ============================================================ */

import { ChatCore } from './chat-core.js';

const { CHAT_STATUS, MESSAGE_STATE, CHAT_LIMITS } = ChatCore.constants;

/* ---------- ثوابت الواجهة ---------- */
const UI = Object.freeze({
  SWIPE_TRIGGER_PX: 56,
  SWIPE_MAX_PX: 84,
  LONG_PRESS_MS: 420,
  DOUBLE_TAP_MS: 280,
  GROUP_GAP_MS: 5 * 60 * 1000,
  NEAR_BOTTOM_PX: 140,
  LOAD_OLDER_PX: 90,
  TOAST_MAX: 3,
  TOAST_MS: 3200,
  QUICK_REACTIONS: Object.freeze(['❤️', '👍', '😂', '😮', '😢', '🙏']),
  TABS: Object.freeze([
    Object.freeze({ id: 'all', label: 'الكل' }),
    Object.freeze({ id: 'unread', label: 'غير مقروء' }),
    Object.freeze({ id: 'requests', label: 'الطلبات' }),
    Object.freeze({ id: 'archived', label: 'المؤرشفة' }),
  ]),
});

const DAY_MS = 86400000;

/* ---------- الأيقونات (مسارات SVG ثابتة ومصدرها داخلي) ---------- */
const ICON_PATHS = Object.freeze({
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  back: 'M9 18l6-6-6-6',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  attach: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
  mic: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8',
  smile: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  reply: 'M9 17l-5-5 5-5M4 12h11a5 5 0 0 1 5 5v2',
  forward: 'M15 17l5-5-5-5M20 12H9a5 5 0 0 0-5 5v2',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  pin: 'M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z',
  unpin: 'M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6zM3 3l18 18',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  check: 'M20 6L9 17l-5-5',
  checks: 'M1 12l5 5L17 6M7 12l5 5L23 6',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  archive: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  bellOff: 'M13.7 21a2 2 0 0 1-3.4 0M18.6 13.4A8.5 8.5 0 0 1 18 11V8a6 6 0 0 0-9.4-5M6.3 6.3A6 6 0 0 0 6 8v3c0 2-.8 3.9-2 5h14M1 1l22 22',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 16v-4M12 8h.01',
  x: 'M18 6L6 18M6 6l12 12',
  retry: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  eyeOff: 'M17.9 17.9A10.8 10.8 0 0 1 12 19c-7 0-11-7-11-7a19.8 19.8 0 0 1 5.1-5.9M9.9 4.2A10.9 10.9 0 0 1 12 4c7 0 11 7 11 7a19.6 19.6 0 0 1-2.2 3.2M1 1l22 22',
  more: 'M12 5h.01M12 12h.01M12 19h.01',
  block: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM4.9 4.9l14.2 14.2',
  down: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
});

function icon(name, cls = 'cs-ico') {
  const span = document.createElement('span');
  span.className = cls;
  span.setAttribute('aria-hidden', 'true');
  const d = ICON_PATHS[name];
  if (d) {
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  }
  return span;
}

/* ---------- أدوات DOM ---------- */
function appendKids(el, kids) {
  kids.flat(Infinity).forEach((c) => {
    if (c === null || c === undefined || c === false || c === true) return;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  });
}

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    Object.keys(props).forEach((k) => {
      const v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = String(v);
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    });
  }
  appendKids(el, kids);
  return el;
}

/* ---------- التنسيق والوقت ---------- */
const TIME_FMT = new Intl.DateTimeFormat('ar', { hour: 'numeric', minute: '2-digit' });
const WEEKDAY_FMT = new Intl.DateTimeFormat('ar', { weekday: 'long' });
const DATE_FMT = new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'long', year: 'numeric' });
const SHORT_DATE_FMT = new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short' });

function toMsValue(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  return 0;
}

function dayStart(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function fmtClock(ms) {
  return ms ? TIME_FMT.format(ms) : '';
}

function dayLabel(ms) {
  const diff = Math.round((dayStart(Date.now()) - dayStart(ms)) / DAY_MS);
  if (diff === 0) return 'اليوم';
  if (diff === 1) return 'أمس';
  if (diff > 1 && diff < 7) return WEEKDAY_FMT.format(ms);
  return DATE_FMT.format(ms);
}

function listStamp(ms) {
  if (!ms) return '';
  const diff = Math.round((dayStart(Date.now()) - dayStart(ms)) / DAY_MS);
  if (diff === 0) return fmtClock(ms);
  if (diff === 1) return 'أمس';
  if (diff < 7) return WEEKDAY_FMT.format(ms);
  return SHORT_DATE_FMT.format(ms);
}

/* ---------- الصور الرمزية ---------- */
function initialOf(name) {
  const t = String(name || '').trim();
  return t ? Array.from(t)[0].toUpperCase() : '?';
}

function hueOf(text) {
  let n = 0;
  for (const ch of String(text || '')) n = (n * 31 + ch.codePointAt(0)) % 360;
  return n;
}

function safeImageUrl(u) {
  return typeof u === 'string' && /^https:\/\//.test(u) && u.length <= 2048 ? u : '';
}

function avatarEl(name, photo, cls = 'cs-avatar') {
  const el = h('span', { class: cls, 'aria-hidden': 'true' });
  el.style.setProperty('--hue', String(hueOf(name)));
  const src = safeImageUrl(photo);
  if (src) {
    const img = h('img', { src, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => {
      img.remove();
      el.textContent = initialOf(name);
    }, { once: true });
    el.append(img);
  } else {
    el.textContent = initialOf(name);
  }
  return el;
}

/* ---------- الحالة ---------- */
const ST = {
  root: null,
  els: {},
  hooks: {},
  uid: null,
  isRtl: true,
  chats: [],              // ChatView[] آخر لقطة من ChatCore
  chatsReady: false,
  tab: 'all',
  query: '',
  activeId: null,
  active: null,           // { chat, blockedByMe, otherUid }
  rows: new Map(),        // chatId -> { el, sig }
  typing: new Map(),      // chatId -> uids[]
  room: null,             // حالة الغرفة (تُملأ في الجزء 2/3)
};

function viewById(id) {
  return ST.chats.find((v) => v.id === id) || null;
}

function runAction(fn) {
  return Promise.resolve().then(fn).catch(() => { /* الأخطاء تصل عبر حدث error */ });
}

/* ---------- الإشعارات ---------- */
function showToast(type, text) {
  const host = ST.els.toasts;
  if (!host || !text) return;
  while (host.children.length >= UI.TOAST_MAX) host.firstElementChild.remove();
  const kind = type || 'info';
  const iconName = kind === 'success' ? 'check' : kind === 'danger' ? 'alert' : 'info';
  const el = h('div', { class: `cs-toast is-${kind}`, role: 'status' },
    icon(iconName, 'cs-ico cs-toast-ico'),
    h('span', { class: 'cs-toast-text', text }));
  host.append(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 220);
  }, UI.TOAST_MS);
}

/* ---------- التركيز ---------- */
function trapFocus(e, container) {
  const items = [...container.querySelectorAll('button:not([disabled]), input, textarea, [tabindex]:not([tabindex="-1"])')];
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/* ---------- القائمة المنبثقة ---------- */
const MENU = { el: null, off: null };

function closeMenu() {
  const el = MENU.el;
  if (!el) return;
  MENU.el = null;
  if (MENU.off) {
    MENU.off();
    MENU.off = null;
  }
  el.classList.add('is-leaving');
  setTimeout(() => el.remove(), 160);
}

function placeMenu(menu, point) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw < 640) {
    menu.classList.add('is-sheet');
    return;
  }
  const r = menu.getBoundingClientRect();
  let x = point.x;
  let y = point.y;
  if (x + r.width + 8 > vw) x = vw - r.width - 8;
  if (y + r.height + 8 > vh) y = Math.max(8, y - r.height);
  x = Math.max(8, x);
  y = Math.max(8, y);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
}

function openMenu(point, items, opts = {}) {
  closeMenu();
  const menu = h('div', { class: 'cs-menu', role: 'menu', dir: ST.isRtl ? 'rtl' : 'ltr' });
  if (opts.title) menu.append(h('div', { class: 'cs-menu-title', text: opts.title }));

  items.filter(Boolean).forEach((it) => {
    if (it.separator) {
      menu.append(h('div', { class: 'cs-menu-sep', role: 'separator' }));
      return;
    }
    menu.append(h('button', {
      type: 'button',
      class: `cs-menu-item${it.danger ? ' is-danger' : ''}`,
      role: 'menuitem',
      disabled: it.disabled ? true : null,
      onclick: () => {
        closeMenu();
        if (typeof it.onSelect === 'function') it.onSelect();
      },
    }, icon(it.icon || 'more'), h('span', { class: 'cs-menu-label', text: it.label })));
  });

  document.body.append(menu);
  placeMenu(menu, point || { x: 16, y: 16 });
  MENU.el = menu;

  const onDown = (e) => { if (!menu.contains(e.target)) closeMenu(); };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
    }
  };
  const onScroll = (e) => { if (!menu.contains(e.target)) closeMenu(); };
  const onResize = () => closeMenu();

  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('resize', onResize);
  MENU.off = () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
  };

  const first = menu.querySelector('.cs-menu-item:not([disabled])');
  if (first) first.focus({ preventScroll: true });
  return menu;
}

/* ---------- الحوارات ---------- */
function openDialog({ title = '', body = null, actions = [], dismissable = true, tone = '' } = {}) {
  let settled = false;
  let resolveFn = null;
  const result = new Promise((res) => { resolveFn = res; });

  const btns = actions.map((a) => h('button', {
    type: 'button',
    class: `cs-btn cs-btn-${a.tone || 'ghost'}`,
    onclick: () => finish(a.value),
  }, a.label));

  const dialog = h('div', {
    class: `cs-dialog${tone ? ` is-${tone}` : ''}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title || 'حوار',
  },
    title ? h('h3', { class: 'cs-dialog-title', text: title }) : null,
    body ? h('div', { class: 'cs-dialog-body' }, body) : null,
    btns.length ? h('div', { class: 'cs-dialog-actions' }, btns) : null);

  const overlay = h('div', { class: 'cs-overlay' }, dialog);

  const onKey = (e) => {
    if (e.key === 'Escape' && dismissable) {
      e.preventDefault();
      finish(null);
      return;
    }
    if (e.key === 'Tab') trapFocus(e, dialog);
  };

  const finish = (value) => {
    if (settled) return;
    settled = true;
    document.removeEventListener('keydown', onKey, true);
    overlay.classList.remove('is-open');
    overlay.classList.add('is-leaving');
    setTimeout(() => overlay.remove(), 200);
    resolveFn(value);
  };

  overlay.addEventListener('pointerdown', (e) => {
    if (dismissable && e.target === overlay) finish(null);
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);

  requestAnimationFrame(() => {
    overlay.classList.add('is-open');
    const target = dialog.querySelector('input, textarea')
      || btns.find((b) => b.classList.contains('cs-btn-ghost'))
      || btns[0];
    if (target) target.focus({ preventScroll: true });
  });

  return {
    result,
    root: dialog,
    close: (value = null) => finish(value),
    setDisabled(index, flag) {
      if (btns[index]) btns[index].disabled = !!flag;
    },
  };
}

/* ---------- الضغط المطوّل والسياق (لوحة اللمس والفأرة) ---------- */
function bindLongPress(el, onLong) {
  let timer = null;
  let fired = false;
  let sx = 0;
  let sy = 0;
  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  el.addEventListener('pointerdown', (e) => {
    fired = false;
    if (e.pointerType === 'mouse') return;
    sx = e.clientX;
    sy = e.clientY;
    clear();
    timer = setTimeout(() => {
      timer = null;
      fired = true;
      onLong({ x: sx, y: sy }, el);
    }, UI.LONG_PRESS_MS);
  });
  el.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) clear();
  });
  el.addEventListener('pointerup', clear);
  el.addEventListener('pointercancel', clear);
  el.addEventListener('pointerleave', clear);
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (fired) return;
    onLong({ x: e.clientX, y: e.clientY }, el);
  });
  el.addEventListener('click', (e) => {
    if (fired) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}

/* ---------- الهيكل العام ---------- */
function buildShell(root) {
  ST.root = root;
  ST.isRtl = (document.documentElement.getAttribute('dir') || 'rtl') === 'rtl';
  root.classList.add('cs-root');

  /* الشريط الجانبي */
  const title = h('h2', { class: 'cs-side-title', text: 'المحادثات' });
  const searchToggle = h('button', {
    type: 'button',
    class: 'cs-icon-btn',
    title: 'بحث (Ctrl+K)',
    'aria-label': 'بحث في المحادثات',
    onclick: () => toggleSearch(),
  }, icon('search'));
  const newBtn = h('button', {
    type: 'button',
    class: 'cs-icon-btn cs-icon-btn-accent',
    title: 'محادثة جديدة',
    'aria-label': 'محادثة جديدة',
    onclick: () => startNewChat(),
  }, icon('plus'));
  const head = h('header', { class: 'cs-side-head' }, title, h('div', { class: 'cs-side-actions' }, searchToggle, newBtn));

  const searchInput = h('input', {
    type: 'search',
    class: 'cs-search-input',
    placeholder: 'ابحث في المحادثات',
    autocomplete: 'off',
    'aria-label': 'بحث في المحادثات',
  });
  searchInput.addEventListener('input', () => {
    ST.query = searchInput.value.trim().toLowerCase();
    renderList();
  });
  const searchBox = h('div', { class: 'cs-search' }, icon('search', 'cs-ico cs-search-ico'), searchInput);

  const tabs = h('nav', { class: 'cs-tabs', role: 'tablist', 'aria-label': 'تصفية المحادثات' });
  UI.TABS.forEach((t, i) => {
    tabs.append(h('button', {
      type: 'button',
      class: 'cs-tab',
      role: 'tab',
      id: `cs-tab-${t.id}`,
      dataset: { tab: t.id },
      'aria-selected': 'false',
      tabindex: '-1',
      onclick: () => setTab(t.id),
      onkeydown: (e) => onTabKey(e, i),
    },
      h('span', { class: 'cs-tab-label', text: t.label }),
      h('span', { class: 'cs-tab-count', hidden: true })));
  });

  const list = h('div', { class: 'cs-list', role: 'listbox', 'aria-label': 'المحادثات' });
  const sidebar = h('aside', { class: 'cs-sidebar', 'aria-label': 'قائمة المحادثات' }, head, searchBox, tabs, list);

  /* لوحة المحادثة */
  const empty = h('div', { class: 'cs-empty' },
    h('div', { class: 'cs-empty-art' }, icon('chat', 'cs-ico cs-ico-xl')),
    h('h3', { class: 'cs-empty-title', text: 'اختر محادثة للبدء' }),
    h('p', { class: 'cs-empty-sub', text: 'اختر محادثة من القائمة، أو ابدأ محادثة جديدة.' }));
  const roomHost = h('div', { class: 'cs-room-host' });
  const main = h('section', { class: 'cs-main' }, empty, roomHost);

  const toasts = h('div', { class: 'cs-toasts', role: 'region', 'aria-live': 'polite', 'aria-label': 'الإشعارات' });

  root.replaceChildren(sidebar, main, toasts);

  ST.els = { title, searchToggle, newBtn, searchBox, searchInput, tabs, list, sidebar, main, empty, roomHost, toasts };
  syncTabs();
  return ST.els;
}

function setRoomOpen(open) {
  if (!ST.root) return;
  ST.root.classList.toggle('has-chat', !!open);
  ST.els.main.classList.toggle('has-chat', !!open);
}

function toggleSearch(force) {
  const box = ST.els.searchBox;
  const open = typeof force === 'boolean' ? force : !box.classList.contains('is-open');
  box.classList.toggle('is-open', open);
  if (open) {
    ST.els.searchInput.focus();
  } else {
    ST.els.searchInput.value = '';
    ST.query = '';
    renderList();
  }
}

function startNewChat() {
  if (typeof ST.hooks.startChat === 'function') {
    ST.hooks.startChat();
    return;
  }
  showToast('info', 'ابدأ محادثة جديدة من صفحة المستخدم.');
}

/* ---------- التبويبات ---------- */
function syncTabs() {
  if (!ST.els.tabs) return;
  ST.els.tabs.querySelectorAll('.cs-tab').forEach((b) => {
    const on = b.dataset.tab === ST.tab;
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
    b.classList.toggle('is-active', on);
  });
}

function setTab(id) {
  if (!UI.TABS.some((t) => t.id === id) || ST.tab === id) return;
  ST.tab = id;
  syncTabs();
  const list = ST.els.list;
  list.classList.remove('is-switching');
  void list.offsetWidth; // إعادة تشغيل الأنيميشن
  list.classList.add('is-switching');
  renderList();
}

function onTabKey(e, index) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  e.preventDefault();
  const n = UI.TABS.length;
  let next = index;
  if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = n - 1;
  else {
    const dir = (e.key === 'ArrowLeft') === ST.isRtl ? 1 : -1;
    next = (index + dir + n) % n;
  }
  const id = UI.TABS[next].id;
  const btn = ST.els.tabs.querySelector(`[data-tab="${id}"]`);
  if (btn) btn.focus();
  setTab(id);
}

function tabCounts() {
  let unread = 0;
  let requests = 0;
  ST.chats.forEach((v) => {
    if (v.archived) return;
    if (v.status === CHAT_STATUS.PENDING) {
      if (v.isRequestIncoming) requests += 1;
      return;
    }
    if (v.unread > 0) unread += 1;
  });
  return { unread, requests };
}

function renderTabs() {
  if (!ST.els.tabs) return;
  const c = tabCounts();
  const counts = { unread: c.unread, requests: c.requests };
  ST.els.tabs.querySelectorAll('.cs-tab').forEach((b) => {
    const n = counts[b.dataset.tab] || 0;
    const tag = b.querySelector('.cs-tab-count');
    tag.hidden = n <= 0;
    tag.textContent = n > 99 ? '99+' : String(n);
  });
}

/* ---------- تصفية المحادثات ---------- */
function passesTab(v) {
  if (ST.tab === 'archived') return !!v.archived;
  if (v.archived) return false;
  if (ST.tab === 'requests') return v.status === CHAT_STATUS.PENDING;
  if (v.status === CHAT_STATUS.PENDING && v.isRequestIncoming) return false;
  if (ST.tab === 'unread') return v.unread > 0;
  return true;
}

function passesQuery(v) {
  if (!ST.query) return true;
  const hay = `${v.title || ''} ${v.username || ''} ${v.lastMessage || ''}`.toLowerCase();
  return hay.includes(ST.query);
}

/* ---------- نص المعاينة وتوقيع الصف ---------- */
function rowPreview(v, typing) {
  if (v.status === CHAT_STATUS.BLOCKED) {
    return { text: v.blockedByMe ? 'محظور من قِبلك' : 'محظور', kind: 'muted' };
  }
  if (v.status === CHAT_STATUS.PENDING) {
    if (v.isRequestIncoming) return { text: 'طلب محادثة جديد', kind: 'accent' };
    if (v.requestSent) return { text: 'بانتظار موافقة الطرف الآخر', kind: 'muted' };
    return { text: 'ابدأ المحادثة بإرسال رسالة', kind: 'muted' };
  }
  if (typing) return { text: 'يكتب…', kind: 'typing' };
  if (!v.lastMessage) return { text: 'لا توجد رسائل بعد', kind: 'muted' };
  const mine = !!v.lastSenderUid && v.lastSenderUid === ST.uid;
  return { text: `${mine ? 'أنت: ' : ''}${v.lastMessage}`, kind: '' };
}

function rowSig(v, extra) {
  return [
    v.title, v.username, v.photo, v.verified ? 1 : 0,
    v.lastMessage, v.lastMessageId, v.lastSenderUid, toMsValue(v.lastMessageAt),
    v.unread, v.muted ? 1 : 0, v.mutedForever ? 1 : 0, toMsValue(v.mutedUntil),
    v.pinned ? 1 : 0, v.archived ? 1 : 0, v.status, v.blockedByMe ? 1 : 0,
    v.requestSent ? 1 : 0, v.isRequestIncoming ? 1 : 0, v.isRequestOutgoing ? 1 : 0,
    extra.active ? 1 : 0, extra.typing ? 1 : 0,
  ].join('\u001f');
}

/* ---------- بناء الصف وتعبئته ---------- */
function buildRow(id) {
  const el = h('button', {
    type: 'button',
    class: 'cs-row',
    role: 'option',
    'aria-selected': 'false',
    dataset: { id },
  },
    h('span', { class: 'cs-row-avatar' }),
    h('span', { class: 'cs-row-body' },
      h('span', { class: 'cs-row-top' },
        h('span', { class: 'cs-row-title' }),
        h('span', { class: 'cs-row-time' })),
      h('span', { class: 'cs-row-bottom' },
        h('span', { class: 'cs-row-preview' }),
        h('span', { class: 'cs-row-badges' }))));

  el.addEventListener('click', () => openFromList(id));
  el.addEventListener('keydown', onRowKey);
  el.addEventListener('animationend', (e) => {
    if (e.target === el) el.classList.remove('is-enter');
  });
  bindLongPress(el, (pt) => chatMenu(id, pt));
  return el;
}

function fillRow(el, v, extra) {
  const title = v.title || v.username || 'مستخدم';
  const preview = rowPreview(v, extra.typing);

  el.classList.toggle('is-pinned', !!v.pinned);
  el.classList.toggle('is-muted', !!v.muted);
  el.classList.toggle('is-blocked', v.status === CHAT_STATUS.BLOCKED);
  el.classList.toggle('is-request', v.status === CHAT_STATUS.PENDING);
  el.classList.toggle('has-unread', v.unread > 0);

  el.querySelector('.cs-row-avatar').replaceChildren(avatarEl(title, v.photo, 'cs-avatar cs-avatar-sm'));

  const titleEl = el.querySelector('.cs-row-title');
  titleEl.textContent = title;
  if (v.verified) titleEl.append(icon('check', 'cs-ico cs-verified'));

  el.querySelector('.cs-row-time').textContent = listStamp(toMsValue(v.lastMessageAt));

  const previewEl = el.querySelector('.cs-row-preview');
  previewEl.textContent = preview.text;
  previewEl.className = `cs-row-preview${preview.kind ? ` is-${preview.kind}` : ''}`;

  const badges = el.querySelector('.cs-row-badges');
  badges.replaceChildren();
  if (v.pinned) badges.append(icon('pin', 'cs-ico cs-badge-ico'));
  if (v.muted) badges.append(icon('bellOff', 'cs-ico cs-badge-ico'));
  if (v.unread > 0) {
    badges.append(h('span', {
      class: `cs-badge${v.muted ? ' is-muted' : ''}`,
      text: v.unread > 99 ? '99+' : String(v.unread),
    }));
  }
}

/* ---------- الفتح من القائمة والتنقل ---------- */
function openFromList(id) {
  runAction(() => ChatCore.openChat(id));
}

function onRowKey(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const rows = [...ST.els.list.querySelectorAll('.cs-row:not(.is-leaving):not(.cs-skel-row)')];
  const i = rows.indexOf(e.currentTarget);
  const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
  if (next) next.focus();
}

/* ---------- الهيكل الانتقالي والقائمة الفارغة ---------- */
function renderSkeleton() {
  const list = ST.els.list;
  if (list.querySelector('.cs-skel-row')) return;
  const rows = Array.from({ length: 6 }, () => h('div', { class: 'cs-row cs-skel-row', 'aria-hidden': 'true' },
    h('span', { class: 'cs-skel cs-skel-avatar' }),
    h('span', { class: 'cs-row-body' },
      h('span', { class: 'cs-skel cs-skel-line w-60' }),
      h('span', { class: 'cs-skel cs-skel-line w-85' }))));
  list.replaceChildren(...rows);
}

function emptyNode() {
  let copy;
  if (ST.query) copy = { t: 'لا توجد نتائج', s: 'جرّب كلمات مختلفة.' };
  else if (ST.tab === 'requests') copy = { t: 'لا توجد طلبات', s: 'طلبات المحادثة الجديدة ستظهر هنا.' };
  else if (ST.tab === 'archived') copy = { t: 'لا توجد محادثات مؤرشفة', s: 'أرشِف محادثة من قائمتها لإخفائها.' };
  else if (ST.tab === 'unread') copy = { t: 'لا توجد رسائل غير مقروءة', s: 'أنت على اطلاع بكل شيء.' };
  else copy = { t: 'لا توجد محادثات بعد', s: 'ابدأ محادثة جديدة من زر (+).' };
  return h('div', { class: 'cs-list-empty' },
    icon('chat', 'cs-ico cs-ico-lg'),
    h('strong', { text: copy.t }),
    h('span', { text: copy.s }));
}

/* يعيد ترتيب الصفوف بأقل قدر من الحركة، ويحافظ على الصفوف المتحركة للخروج */
function reconcile(list, ordered) {
  const isLeaving = (n) => n.classList.contains('is-leaving');
  let ref = list.firstElementChild;
  ordered.forEach((el) => {
    while (ref && ref !== el && (isLeaving(ref) || !ref.classList.contains('cs-row'))) {
      ref = ref.nextElementSibling;
    }
    if (ref === el) {
      ref = ref.nextElementSibling;
      return;
    }
    list.insertBefore(el, ref);
  });
  [...list.children].forEach((n) => {
    if (!isLeaving(n) && !n.classList.contains('cs-row')) n.remove();
  });
}

/* ---------- عرض القائمة ---------- */
function renderList() {
  const list = ST.els.list;
  if (!list) return;
  renderTabs();

  if (!ST.chatsReady) {
    renderSkeleton();
    return;
  }
  if (list.querySelector('.cs-skel-row')) list.replaceChildren();

  const views = ST.chats.filter((v) => passesTab(v) && passesQuery(v));
  const seen = new Set();
  const ordered = [];

  views.forEach((v) => {
    seen.add(v.id);
    const extra = {
      active: ST.activeId === v.id,
      typing: (ST.typing.get(v.id) || []).length > 0,
    };
    const sig = rowSig(v, extra);
    let row = ST.rows.get(v.id);
    if (!row) {
      row = { el: buildRow(v.id), sig: '' };
      row.el.classList.add('is-enter');
      ST.rows.set(v.id, row);
    }
    if (row.sig !== sig) {
      fillRow(row.el, v, extra);
      row.sig = sig;
    }
    row.el.classList.toggle('is-active', extra.active);
    row.el.setAttribute('aria-selected', extra.active ? 'true' : 'false');
    ordered.push(row.el);
  });

  ST.rows.forEach((row, id) => {
    if (seen.has(id)) return;
    ST.rows.delete(id);
    row.el.classList.add('is-leaving');
    row.el.setAttribute('aria-hidden', 'true');
    setTimeout(() => row.el.remove(), 200);
  });

  reconcile(list, ordered);
  if (!ordered.length) list.append(emptyNode());
}

/* ---------- الإجراءات من القائمة ---------- */
function confirmDeleteChat(id) {
  openDialog({
    title: 'حذف المحادثة من قائمتك؟',
    body: h('p', {
      class: 'cs-dialog-text',
      text: 'ستُخفى المحادثة وسجلها من حسابك فقط، ولن تُحذف الرسائل عند الطرف الآخر.',
    }),
    tone: 'danger',
    actions: [
      { label: 'إلغاء', value: false, tone: 'ghost' },
      { label: 'حذف', value: true, tone: 'danger' },
    ],
  }).result.then((ok) => {
    if (ok) runAction(() => ChatCore.deleteChatForMe(id));
  });
}

function confirmClearHistory(id) {
  openDialog({
    title: 'مسح سجل الرسائل عندي؟',
    body: h('p', {
      class: 'cs-dialog-text',
      text: 'ستختفي الرسائل من حسابك فقط، وتبقى المحادثة في قائمتك.',
    }),
    tone: 'danger',
    actions: [
      { label: 'إلغاء', value: false, tone: 'ghost' },
      { label: 'مسح', value: true, tone: 'danger' },
    ],
  }).result.then((ok) => {
    if (ok) runAction(() => ChatCore.clearHistoryForMe(id));
  });
}

function confirmBlock(id) {
  openDialog({
    title: 'حظر هذا المستخدم؟',
    body: h('p', {
      class: 'cs-dialog-text',
      text: 'لن يتمكن من مراسلتك. يمكنك فك الحظر لاحقاً من قائمة المحادثة.',
    }),
    tone: 'danger',
    actions: [
      { label: 'إلغاء', value: false, tone: 'ghost' },
      { label: 'حظر', value: true, tone: 'danger' },
    ],
  }).result.then((ok) => {
    if (ok) runAction(() => ChatCore.blockUser(id));
  });
}

function openMuteMenu(id, point) {
  const options = [
    { label: 'لمدة ساعة', value: 3600000 },
    { label: 'لمدة 8 ساعات', value: 8 * 3600000 },
    { label: 'لمدة يوم', value: DAY_MS },
    { label: 'لمدة أسبوع', value: 7 * DAY_MS },
    { label: 'للأبد', value: 'forever' },
  ];
  openMenu(point, options.map((o) => ({
    label: o.label,
    icon: 'bellOff',
    onSelect: () => runAction(() => ChatCore.muteChat(id, o.value)),
  })), { title: 'كتم الإشعارات' });
}

function chatMenu(id, point) {
  const v = viewById(id);
  if (!v) return;

  const items = [];
  const incomingRequest = v.status === CHAT_STATUS.PENDING && v.isRequestIncoming;

  if (incomingRequest) {
    items.push({ label: 'قبول الطلب', icon: 'check', onSelect: () => runAction(() => ChatCore.acceptRequest(id)) });
    items.push({ label: 'رفض الطلب', icon: 'x', danger: true, onSelect: () => runAction(() => ChatCore.declineRequest(id)) });
    items.push({ separator: true });
  } else {
    items.push({
      label: v.pinned ? 'إلغاء التثبيت' : 'تثبيت المحادثة',
      icon: v.pinned ? 'unpin' : 'pin',
      onSelect: () => runAction(() => ChatCore.pinChat(id, !v.pinned)),
    });
    items.push({
      label: v.archived ? 'إلغاء الأرشفة' : 'أرشفة المحادثة',
      icon: 'archive',
      onSelect: () => runAction(() => ChatCore.archiveChat(id, !v.archived)),
    });
    items.push({
      label: v.muted ? 'إلغاء الكتم' : 'كتم الإشعارات',
      icon: v.muted ? 'bell' : 'bellOff',
      onSelect: () => (v.muted ? runAction(() => ChatCore.muteChat(id, false)) : openMuteMenu(id, point)),
    });
    items.push({ separator: true });
    items.push({ label: 'مسح السجل عندي', icon: 'eyeOff', onSelect: () => confirmClearHistory(id) });
    items.push({ label: 'حذف المحادثة عندي', icon: 'trash', danger: true, onSelect: () => confirmDeleteChat(id) });
    items.push({ separator: true });
  }

  if (v.blockedByMe) {
    items.push({ label: 'فك الحظر', icon: 'user', onSelect: () => runAction(() => ChatCore.unblockUser(id)) });
  } else if (v.status !== CHAT_STATUS.BLOCKED && v.otherUid) {
    items.push({ label: 'حظر المستخدم', icon: 'block', danger: true, onSelect: () => confirmBlock(id) });
  }

  openMenu(point, items, { title: v.title || v.username || 'محادثة' });
}

/* ---------- الكتابة المرئية في القائمة ---------- */
function setTypingIn(chatId, uids) {
  if (uids && uids.length) ST.typing.set(chatId, uids);
  else ST.typing.delete(chatId);
  renderList();
}
/* ============================================================
   js/chat-ui.js — الجزء 2/3
   يُلحق بعد نهاية الجزء 1/3 مباشرةً (لا يحتوي import).
   المحتوى: ثوابت الغرفة، بناء الغرفة، الترويسة والشريط المثبَّت،
            الرسائل (التجميع والفواصل والتحديث الانتقائي)، السحب للرد
            والنقر المزدوج، القوائم والتفاعلات والحذف والتعديل،
            الإدخال والإرسال والمسودات، لوحة المفاتيح، وإعادة التوجيه.
   يُكمَل في الجزء 3/3: البحث داخل المحادثة (toggleRoomSearch)،
            والاختصارات، وربط أحداث ChatCore، وuse()، والتصدير.
   ============================================================ */

/* ---------- ثوابت الغرفة ---------- */
const ROOM = Object.freeze({
  INPUT_MAX_PX: 160,
  FLASH_MS: 1300,
  HEART: '❤️',
  SWIPE_LOCK_PX: 8,
  SWIPE_MIN_RATIO: 1.2,
});

const isCoarse = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

function vibrate(ms = 10) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch (_) { /* تجاهل */ }
}

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} م.ب`;
  if (n >= 1024) return `${Math.round(n / 1024)} ك.ب`;
  return `${n} بايت`;
}

function isSafeHttps(u) {
  return typeof u === 'string' && u.startsWith('https://') && u.length <= 2048;
}

async function copyText(text) {
  const value = String(text || '');
  if (!value) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
    } else {
      const ta = h('textarea', { readonly: true, style: { position: 'fixed', opacity: '0', top: '0', left: '0' } });
      ta.value = value;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    showToast('success', 'تم نسخ النص.');
    return true;
  } catch (_) {
    showToast('danger', 'تعذر نسخ النص.');
    return false;
  }
}

function messagePreview(m) {
  if (!m) return '';
  const t = (m.text || '').trim();
  if (t) return t;
  const a = m.attachment;
  if (!a) return '';
  const names = { image: 'صورة', video: 'فيديو', audio: 'مقطع صوتي', pdf: 'ملف PDF' };
  return names[a.kind] || a.name || 'ملف';
}

function senderLabel(m) {
  if (m.mine) return 'نفسك';
  const v = ST.active && ST.active.chat;
  return (v && (v.title || v.username)) || 'المستخدم';
}

/* يضع العنصر قرب نقطة معيّنة مع حصره داخل الشاشة */
function placeFloating(el, point, preferAbove = false) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = el.getBoundingClientRect();
  let x = point.x - r.width / 2;
  let y = preferAbove ? point.y - r.height - 8 : point.y + 8;
  if (y + r.height > vh - 8) y = point.y - r.height - 8;
  if (y < 8) y = 8;
  x = Math.min(Math.max(8, x), vw - r.width - 8);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

/* ---------- شريط التفاعلات السريع ---------- */
const REACT = { el: null, off: null };

function closeReactBar() {
  const el = REACT.el;
  if (!el) return;
  REACT.el = null;
  if (REACT.off) {
    REACT.off();
    REACT.off = null;
  }
  el.classList.add('is-leaving');
  setTimeout(() => el.remove(), 160);
}

function openReactBar(m, point) {
  closeReactBar();
  if (!m || m.state !== MESSAGE_STATE.SENT) return;

  const mine = m.reactions ? m.reactions[ST.uid] : null;
  const buttons = UI.QUICK_REACTIONS.map((e) => h('button', {
    type: 'button',
    class: `cs-react-btn${mine === e ? ' is-on' : ''}`,
    role: 'menuitem',
    'aria-label': `تفاعل ${e}`,
    text: e,
    onclick: () => {
      closeReactBar();
      ChatCore.toggleReaction(m.chatId, m.id, e);
    },
  }));
  if (mine) {
    buttons.push(h('button', {
      type: 'button',
      class: 'cs-react-btn is-remove',
      role: 'menuitem',
      'aria-label': 'إزالة تفاعلي',
      onclick: () => {
        closeReactBar();
        ChatCore.removeReaction(m.chatId, m.id);
      },
    }, icon('x', 'cs-ico cs-ico-sm')));
  }

  const bar = h('div', { class: 'cs-reactbar', role: 'menu', 'aria-label': 'اختيار تفاعل' }, buttons);
  document.body.append(bar);
  placeFloating(bar, point, true);
  REACT.el = bar;

  const onDown = (e) => { if (!bar.contains(e.target)) closeReactBar(); };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeReactBar();
    }
  };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closeReactBar);
  REACT.off = () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', closeReactBar);
  };
  requestAnimationFrame(() => {
    if (buttons[0]) buttons[0].focus({ preventScroll: true });
  });
}

/* ---------- بناء الغرفة ---------- */
function buildRoom() {
  if (ST.room) return ST.room;

  const backBtn = h('button', {
    type: 'button',
    class: 'cs-icon-btn cs-back',
    'aria-label': 'رجوع إلى القائمة',
    title: 'رجوع',
    onclick: () => ChatCore.closeChat(),
  }, icon('back'));

  const avatarHost = h('span', { class: 'cs-room-avatar' });
  const titleEl = h('span', { class: 'cs-room-title' });
  const subEl = h('span', { class: 'cs-room-sub', 'aria-live': 'polite' });
  const whoBtn = h('button', {
    type: 'button',
    class: 'cs-room-who',
    'aria-label': 'معلومات المحادثة',
    title: 'معلومات المحادثة',
    onclick: () => openRoomInfo(),
  }, avatarHost, h('span', { class: 'cs-room-names' }, titleEl, subEl));

  const searchBtn = h('button', {
    type: 'button',
    class: 'cs-icon-btn',
    'aria-label': 'بحث في المحادثة',
    title: 'بحث في المحادثة (Ctrl+F)',
    onclick: () => toggleRoomSearch(),
  }, icon('search'));

  const moreBtn = h('button', {
    type: 'button',
    class: 'cs-icon-btn',
    'aria-label': 'خيارات المحادثة',
    title: 'خيارات',
    onclick: () => {
      if (!ST.activeId) return;
      const r = moreBtn.getBoundingClientRect();
      chatMenu(ST.activeId, { x: r.left, y: r.bottom + 6 });
    },
  }, icon('more'));

  const head = h('header', { class: 'cs-room-head' },
    backBtn, whoBtn, h('div', { class: 'cs-room-actions' }, searchBtn, moreBtn));

  const pinBar = h('button', {
    type: 'button',
    class: 'cs-pinned',
    'aria-label': 'الرسالة المثبتة. اضغط للانتقال إليها',
    onclick: () => cyclePinned(),
  },
    icon('pin', 'cs-ico cs-ico-sm cs-pinned-ico'),
    h('span', { class: 'cs-pinned-body' },
      h('strong', { class: 'cs-pinned-label', text: 'رسالة مثبتة' }),
      h('span', { class: 'cs-pinned-text' })),
    h('span', { class: 'cs-pinned-count' }));
  pinBar.hidden = true;

  const loader = h('div', { class: 'cs-loader', role: 'status' },
    h('span', { class: 'cs-spinner', 'aria-hidden': 'true' }),
    h('span', { text: 'جارٍ تحميل الرسائل السابقة…' }));
  loader.hidden = true;

  const thread = h('div', { class: 'cs-thread', 'aria-label': 'الرسائل' }, loader);
  const scroller = h('div', { class: 'cs-scroll' }, thread);

  const jumpBadge = h('span', { class: 'cs-jump-badge' });
  jumpBadge.hidden = true;
  const jump = h('button', {
    type: 'button',
    class: 'cs-jump',
    'aria-label': 'الانتقال إلى آخر رسالة',
    onclick: () => scrollToBottom(true),
  }, icon('down', 'cs-ico'), jumpBadge);
  jump.hidden = true;

  const roomBody = h('div', { class: 'cs-room-body' }, scroller, jump);

  const banner = h('div', { class: 'cs-gate', role: 'status' });
  banner.hidden = true;

  const ctxIcon = h('span', { class: 'cs-ctx-ico' });
  const ctxTitle = h('strong', { class: 'cs-ctx-title' });
  const ctxText = h('span', { class: 'cs-ctx-text' });
  const ctx = h('div', { class: 'cs-ctx' },
    ctxIcon,
    h('div', { class: 'cs-ctx-body' }, ctxTitle, ctxText),
    h('button', {
      type: 'button',
      class: 'cs-icon-btn cs-icon-btn-sm',
      'aria-label': 'إلغاء الرد أو التعديل',
      onclick: () => clearContext(),
    }, icon('x', 'cs-ico cs-ico-sm')));
  ctx.hidden = true;

  const input = h('textarea', {
    class: 'cs-input',
    rows: '1',
    placeholder: 'اكتب رسالة…',
    'aria-label': 'نص الرسالة',
    maxlength: String(CHAT_LIMITS.TEXT_MAX),
    autocomplete: 'off',
  });
  const attachBtn = h('button', {
    type: 'button',
    class: 'cs-icon-btn cs-attach',
    'aria-label': 'إرفاق ملف',
    title: 'إرفاق ملف',
    onclick: () => pickAttachment(),
  }, icon('attach'));
  const sendBtn = h('button', {
    type: 'button',
    class: 'cs-icon-btn cs-send',
    onclick: () => onSendOrMic(),
  });
  const composer = h('div', { class: 'cs-composer' },
    ctx,
    h('div', { class: 'cs-composer-row' },
      attachBtn,
      h('div', { class: 'cs-input-wrap' }, input),
      sendBtn));

  const el = h('div', { class: 'cs-room' }, head, pinBar, roomBody, banner, composer);
  el.hidden = true;
  ST.els.roomHost.append(el);

  ST.room = {
    el, head, avatarHost, titleEl, subEl, moreBtn,
    pinBar, pinnedList: [], pinIdx: 0,
    thread, scroller, loader, jump, jumpBadge,
    banner, ctx, ctxIcon, ctxTitle, ctxText,
    composer, input, attachBtn, sendBtn, sendMode: '',
    chatId: null, reply: null, edit: null, savedDraft: '',
    drafts: new Map(), rows: new Map(), seps: new Map(),
    typing: [], gateKey: '', atBottom: true, newBelow: 0, newestTs: 0,
    raf: 0, vvBound: false,
  };

  bindRoomEvents(ST.room);
  refreshSendMode();
  return ST.room;
}

function bindRoomEvents(room) {
  room.scroller.addEventListener('scroll', onRoomScroll, { passive: true });
  room.input.addEventListener('input', onInputChange);
  room.input.addEventListener('keydown', onInputKey);
  room.input.addEventListener('focus', () => {
    setTimeout(() => {
      if (ST.room && ST.room.atBottom) scrollToBottom(false);
    }, 180);
  });
  bindViewport();
}

/* لوحة المفاتيح على الهاتف: نحسب الارتفاع المحجوب ونمرّره لـCSS */
function bindViewport() {
  const vv = window.visualViewport;
  const room = ST.room;
  if (!vv || !room || room.vvBound) return;
  room.vvBound = true;
  const apply = () => {
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    if (ST.root) ST.root.style.setProperty('--cs-kb', `${kb}px`);
    if (kb > 0 && ST.room && ST.room.atBottom) scrollToBottom(false);
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  apply();
}

/* ---------- الترويسة ---------- */
function openRoomInfo() {
  const v = ST.active && ST.active.chat;
  if (!v) return;
  const settings = ST.hooks.settings;
  if (settings && typeof settings.open === 'function') {
    settings.open(v);
    return;
  }
  const profile = ST.hooks.profile;
  if (profile && typeof profile.open === 'function' && v.otherUid) {
    profile.open(v.otherUid);
    return;
  }
  showToast('info', 'لوحة المعلومات غير متاحة حالياً.');
}

function updateRoomHeader() {
  const room = ST.room;
  const v = ST.active && ST.active.chat;
  if (!room || !v) return;

  const title = v.title || v.username || 'مستخدم';
  room.avatarHost.replaceChildren(avatarEl(title, v.photo, 'cs-avatar cs-avatar-md'));

  const nodes = [document.createTextNode(title)];
  if (v.verified) nodes.push(icon('check', 'cs-ico cs-verified'));
  room.titleEl.replaceChildren(...nodes);

  let text = '';
  let kind = '';
  if (room.typing.length) {
    text = 'يكتب…';
    kind = 'typing';
  } else if (v.status === CHAT_STATUS.BLOCKED) {
    text = v.blockedByMe ? 'محظور' : 'غير متاح';
  } else if (v.status === CHAT_STATUS.PENDING) {
    text = v.isRequestIncoming ? 'طلب محادثة' : 'بانتظار الموافقة';
  } else if (v.username) {
    text = `@${v.username}`;
  }
  room.subEl.textContent = text;
  room.subEl.className = kind ? `cs-room-sub is-${kind}` : 'cs-room-sub';
}

/* ---------- البوابة: ما الذي يُسمح به في هذه المحادثة ---------- */
function roomGate(v) {
  if (!v) return { kind: 'none' };
  if (v.status === CHAT_STATUS.BLOCKED || v.blocked) {
    return { kind: v.blockedByMe ? 'blocked-me' : 'blocked-them' };
  }
  if (v.status === CHAT_STATUS.PENDING && v.isRequestIncoming) return { kind: 'incoming' };
  if (v.status === CHAT_STATUS.PENDING && v.isRequestOutgoing && v.requestSent) return { kind: 'waiting' };
  return { kind: 'none' };
}

function gateNodes(gate, v) {
  const id = v.id;
  const btn = (label, tone, fn) => h('button', { type: 'button', class: `cs-btn cs-btn-${tone}`, onclick: fn }, label);
  switch (gate.kind) {
    case 'blocked-me':
      return [
        h('p', { class: 'cs-gate-text', text: 'لقد حظرت هذا المستخدم.' }),
        btn('فك الحظر', 'primary', () => runAction(() => ChatCore.unblockUser(id))),
      ];
    case 'blocked-them':
      return [h('p', { class: 'cs-gate-text', text: 'لا يمكنك مراسلة هذا المستخدم.' })];
    case 'incoming':
      return [
        h('p', { class: 'cs-gate-text', text: 'أرسل لك هذا المستخدم طلب محادثة.' }),
        h('div', { class: 'cs-gate-actions' },
          btn('قبول', 'primary', () => runAction(() => ChatCore.acceptRequest(id))),
          btn('رفض', 'ghost', () => runAction(() => ChatCore.declineRequest(id))),
          btn('حظر', 'danger', () => confirmBlock(id))),
      ];
    case 'waiting':
      return [h('p', { class: 'cs-gate-text', text: 'بانتظار موافقة الطرف الآخر على طلب المحادثة.' })];
    default:
      return [];
  }
}

function updateGate(v) {
  const room = ST.room;
  if (!room) return;
  const gate = roomGate(v);
  const key = `${room.chatId}|${gate.kind}`;
  if (key !== room.gateKey) {
    room.gateKey = key;
    room.banner.replaceChildren(...gateNodes(gate, v));
    room.banner.hidden = gate.kind === 'none';
  }
  room.composer.hidden = gate.kind !== 'none';
  if (gate.kind !== 'none' && (room.reply || room.edit)) clearContext({ restore: false });
}

/* ---------- الإدخال: الإرسال والتعديل والرد والمسودات ---------- */
function autoGrow() {
  const room = ST.room;
  if (!room) return;
  const el = room.input;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, ROOM.INPUT_MAX_PX)}px`;
}

function refreshSendMode() {
  const room = ST.room;
  if (!room) return;
  const hasText = room.input.value.trim().length > 0;
  const mode = hasText || room.edit ? 'send' : 'mic';
  if (mode !== room.sendMode) {
    room.sendMode = mode;
    room.sendBtn.replaceChildren(icon(mode === 'send' ? 'send' : 'mic'));
    room.sendBtn.setAttribute('aria-label', mode === 'send' ? 'إرسال' : 'تسجيل رسالة صوتية');
  }
  room.sendBtn.classList.toggle('is-mic', mode === 'mic');
  room.composer.classList.toggle('has-text', mode === 'send');
  const canRecord = !!(ST.hooks.media && typeof ST.hooks.media.recordVoice === 'function');
  room.sendBtn.disabled = mode === 'mic' && !canRecord;
}

function saveDraft() {
  const room = ST.room;
  if (!room || !room.chatId) return;
  const text = room.edit ? room.savedDraft : room.input.value;
  if (text && text.trim()) room.drafts.set(room.chatId, text);
  else room.drafts.delete(room.chatId);
}

function fillCtx(isEdit, m) {
  const room = ST.room;
  room.ctx.classList.toggle('is-edit', isEdit);
  room.ctxIcon.replaceChildren(icon(isEdit ? 'edit' : 'reply'));
  room.ctxTitle.textContent = isEdit ? 'تعديل الرسالة' : `الرد على ${senderLabel(m)}`;
  room.ctxText.textContent = messagePreview(m) || '…';
}

function clearContext(opts = {}) {
  const room = ST.room;
  if (!room) return;
  const wasEdit = !!room.edit;
  room.reply = null;
  room.edit = null;
  room.ctx.hidden = true;
  if (wasEdit && opts.restore !== false) room.input.value = room.savedDraft || '';
  room.savedDraft = '';
  autoGrow();
  refreshSendMode();
}

function setReply(m) {
  const room = ST.room;
  if (!room || !m || !room.chatId) return;
  if (m.state !== MESSAGE_STATE.SENT) {
    showToast('info', 'انتظر حتى تُرسل الرسالة.');
    return;
  }
  if (room.composer.hidden) {
    showToast('info', 'لا يمكن الرد في هذه المحادثة الآن.');
    return;
  }
  if (room.edit) clearContext({ restore: true });
  room.reply = m;
  fillCtx(false, m);
  room.ctx.hidden = false;
  room.input.focus({ preventScroll: true });
}

function setEdit(m) {
  const room = ST.room;
  if (!room || !m || !m.text || !m.mine || m.state !== MESSAGE_STATE.SENT) return;
  if (room.composer.hidden) return;
  if (!room.edit) room.savedDraft = room.input.value;
  room.reply = null;
  room.edit = m;
  fillCtx(true, m);
  room.ctx.hidden = false;
  room.input.value = m.text;
  autoGrow();
  refreshSendMode();
  room.input.focus();
  room.input.setSelectionRange(m.text.length, m.text.length);
}

function onInputChange() {
  const room = ST.room;
  if (!room) return;
  autoGrow();
  refreshSendMode();
  if (!room.edit && room.chatId) {
    saveDraft();
    ChatCore.notifyTyping(room.chatId);
  }
}

function onInputKey(e) {
  const room = ST.room;
  if (!room) return;
  if (e.key === 'Escape' && (room.reply || room.edit)) {
    e.preventDefault();
    clearContext({ restore: true });
    return;
  }
  if (e.key !== 'Enter' || e.isComposing) return;
  const combo = e.ctrlKey || e.metaKey;
  // Enter يرسل على الكمبيوتر، وعلى الهاتف يضيف سطراً جديداً
  if (combo || (!e.shiftKey && !isCoarse())) {
    e.preventDefault();
    if (room.sendMode === 'send') sendCurrent();
  }
}

function sendCurrent() {
  const room = ST.room;
  if (!room || !room.chatId) return;
  const text = room.input.value.trim();

  if (room.edit) {
    if (!text) {
      showToast('danger', 'نص الرسالة فارغ.');
      return;
    }
    const target = room.edit;
    const chatId = room.chatId;
    if (text === target.text) {
      clearContext({ restore: true });
      return;
    }
    ChatCore.editMessage(chatId, target.id, text)
      .then((ok) => {
        if (ok && ST.room && ST.room.chatId === chatId && ST.room.edit === target) {
          clearContext({ restore: true });
        }
      })
      .catch(() => { /* الخطأ يصل عبر حدث error */ });
    return;
  }

  if (!text) return;
  const id = ChatCore.sendText(room.chatId, text, { replyTo: room.reply });
  if (!id) return;
  room.drafts.delete(room.chatId);
  room.input.value = '';
  clearContext({ restore: false });
  autoGrow();
  refreshSendMode();
  if (!isCoarse()) room.input.focus();
}

/* استدعاء وحدة الوسائط: تُعيد true عند إرسال رسالة فعلاً */
function mediaCall(method, chatId, opts) {
  const media = ST.hooks.media;
  if (!media || typeof media[method] !== 'function') {
    showToast('info', 'هذه الميزة غير متاحة حالياً.');
    return Promise.resolve(false);
  }
  return Promise.resolve()
    .then(() => media[method](chatId, opts))
    .then((ok) => ok === true)
    .catch(() => false);
}

function pickAttachment() {
  const room = ST.room;
  if (!room || !room.chatId) return;
  if (room.edit) {
    showToast('info', 'أنهِ تعديل الرسالة أولاً.');
    return;
  }
  const chatId = room.chatId;
  const caption = room.input.value.trim();
  mediaCall('pick', chatId, { replyTo: room.reply, text: caption }).then((ok) => {
    if (!ok || !ST.room || ST.room.chatId !== chatId) return;
    ST.room.drafts.delete(chatId);
    ST.room.input.value = '';
    clearContext({ restore: false });
  });
}

function onSendOrMic() {
  const room = ST.room;
  if (!room || !room.chatId) return;
  if (room.sendMode === 'send') {
    sendCurrent();
    return;
  }
  if (room.edit) return;
  const chatId = room.chatId;
  mediaCall('recordVoice', chatId, { replyTo: room.reply }).then((ok) => {
    if (ok && ST.room && ST.room.chatId === chatId) clearContext({ restore: false });
  });
}

/* ---------- التمرير والقراءة ---------- */
function isNearBottom() {
  const s = ST.room.scroller;
  return s.scrollHeight - s.scrollTop - s.clientHeight <= UI.NEAR_BOTTOM_PX;
}

function scrollToBottom(smooth = true) {
  const room = ST.room;
  if (!room) return;
  const s = room.scroller;
  s.scrollTo({ top: s.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  room.newBelow = 0;
  room.jump.hidden = true;
  room.jumpBadge.hidden = true;
}

function syncJump() {
  const room = ST.room;
  if (!room) return;
  const near = isNearBottom();
  room.atBottom = near;
  if (near) room.newBelow = 0;
  room.jump.hidden = near;
  room.jumpBadge.hidden = room.newBelow <= 0;
  room.jumpBadge.textContent = room.newBelow > 99 ? '99+' : String(room.newBelow);
}

function onRoomScroll() {
  const room = ST.room;
  if (!room || room.raf) return;
  room.raf = requestAnimationFrame(() => {
    room.raf = 0;
    syncJump();
    if (room.scroller.scrollTop < UI.LOAD_OLDER_PX) ChatCore.loadOlder();
  });
}

/* ---------- الشريط المثبَّت ---------- */
function renderPinned(list) {
  const room = ST.room;
  room.pinnedList = Array.isArray(list) ? list : [];
  if (room.pinIdx >= room.pinnedList.length) room.pinIdx = 0;
  const n = room.pinnedList.length;
  room.pinBar.hidden = n === 0;
  if (!n) return;
  const m = room.pinnedList[room.pinIdx];
  room.pinBar.querySelector('.cs-pinned-text').textContent = messagePreview(m) || 'رسالة';
  room.pinBar.querySelector('.cs-pinned-count').textContent = n > 1 ? `${room.pinIdx + 1}/${n}` : '';
}

function cyclePinned() {
  const room = ST.room;
  const list = room && room.pinnedList;
  if (!list || !list.length) return;
  const m = list[room.pinIdx % list.length];
  room.pinIdx = (room.pinIdx + 1) % list.length;
  renderPinned(list);
  scrollToMessage(m.id);
}

/* ---------- الفواصل والتحديث الانتقائي للعناصر ---------- */
function sepNode(key, text, cls) {
  const room = ST.room;
  let el = room.seps.get(key);
  if (!el) {
    el = h('div', { class: cls, 'data-k': key }, h('span', { class: 'cs-sep-label' }));
    room.seps.set(key, el);
  }
  el.firstElementChild.textContent = text;
  return el;
}

function emptyRoomNode() {
  const room = ST.room;
  let el = room.seps.get('e');
  if (!el) {
    el = h('div', { class: 'cs-room-empty', 'data-k': 'e' },
      icon('chat', 'cs-ico cs-ico-lg'),
      h('strong', { text: 'لا توجد رسائل بعد' }),
      h('span', { text: 'اكتب أول رسالة لتبدأ المحادثة.' }));
    room.seps.set('e', el);
  }
  return el;
}

/* يرتّب العناصر ذات data-k دون إعادة إدراج ما هو في مكانه (حتى لا تتكرر الأنيميشن) */
function syncChildren(container, ordered) {
  const want = new Set(ordered);
  [...container.children].forEach((n) => {
    if (n.hasAttribute('data-k') && !want.has(n) && !n.classList.contains('is-leaving')) n.remove();
  });
  const skip = (n) => n.classList.contains('is-leaving') || !n.hasAttribute('data-k');
  let cursor = container.firstElementChild;
  ordered.forEach((node) => {
    while (cursor && skip(cursor)) cursor = cursor.nextElementSibling;
    if (cursor === node) {
      cursor = cursor.nextElementSibling;
      return;
    }
    container.insertBefore(node, cursor);
  });
}

function msgSig(m, c) {
  return [
    m.text, m.isEdited ? 1 : 0, m.editedAt, m.state, m.pinned ? 1 : 0, m.createdAt,
    JSON.stringify(m.reactionList || []),
    JSON.stringify(m.attachment || null),
    m.replyTo ? `${m.replyTo.id}|${m.replyTo.text}` : '',
    m.forwardedFrom ? m.forwardedFrom.name : '',
    m.mine ? 1 : 0, c.joinPrev ? 1 : 0, c.joinNext ? 1 : 0, c.isRead ? 1 : 0,
  ].join('\u001f');
}

/* ---------- بناء صف الرسالة ---------- */
function toolBtn(name, label, fn) {
  const b = h('button', { type: 'button', class: 'cs-msg-tool', 'aria-label': label, title: label });
  b.append(icon(name, 'cs-ico cs-ico-sm'));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    fn(b);
  });
  return b;
}

function buildMessageRow(id) {
  const row = h('div', { class: 'cs-msg-row', 'data-k': `m:${id}`, dataset: { id } });
  const bubble = h('div', { class: 'cs-bubble', tabindex: '0' });
  const tools = h('div', { class: 'cs-msg-tools', role: 'toolbar', 'aria-label': 'إجراءات الرسالة' },
    toolBtn('reply', 'رد', () => setReply(row._m)),
    toolBtn('smile', 'تفاعل', (btn) => {
      const r = btn.getBoundingClientRect();
      if (row._m) openReactBar(row._m, { x: r.left + r.width / 2, y: r.top });
    }),
    toolBtn('more', 'المزيد', (btn) => {
      const r = btn.getBoundingClientRect();
      if (row._m) openMessageMenu(row._m, { x: r.left, y: r.bottom + 4 });
    }));

  row.append(icon('reply', 'cs-ico cs-swipe-ico'), bubble, tools);
  row._bubble = bubble;

  bindLongPress(bubble, (pt) => {
    if (row._m) openMessageMenu(row._m, pt);
  });
  bindBubbleGestures(row, bubble);

  bubble.addEventListener('keydown', (e) => {
    const m = row._m;
    if (!m || e.target !== bubble) return;
    if (e.key === 'Enter' || e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const r = bubble.getBoundingClientRect();
      openMessageMenu(m, { x: r.left + 12, y: r.bottom });
    }
  });

  row.addEventListener('animationend', (e) => {
    if (e.target === row) row.classList.remove('is-enter', 'is-pop', 'is-heart');
  });
  return row;
}

/* اتجاه الرد: الرسالة تُحاذى إلى حافة، والسحب نحو المنتصف يكون للرد */
function replySign(m) {
  return (m && m.mine) === ST.isRtl ? 1 : -1;
}

function heartReact(row) {
  const m = row._m;
  if (!m || m.state !== MESSAGE_STATE.SENT) return;
  row.classList.remove('is-heart');
  void row.offsetWidth;
  row.classList.add('is-heart');
  ChatCore.toggleReaction(m.chatId, m.id, ROOM.HEART);
}

function bindBubbleGestures(row, bubble) {
  const G = { id: null, sx: 0, sy: 0, swiping: false, shift: 0, lastTap: 0, tx: 0, ty: 0 };

  bubble.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest && e.target.closest('button, a, input, textarea')) return;
    G.id = e.pointerId;
    G.sx = e.clientX;
    G.sy = e.clientY;
    G.swiping = false;
    G.shift = 0;
  });

  bubble.addEventListener('pointermove', (e) => {
    if (G.id !== e.pointerId || e.pointerType === 'mouse' || !row._m) return;
    const dx = e.clientX - G.sx;
    const dy = e.clientY - G.sy;
    if (!G.swiping) {
      if (Math.abs(dx) < ROOM.SWIPE_LOCK_PX) return;
      if (Math.abs(dx) < Math.abs(dy) * ROOM.SWIPE_MIN_RATIO) return;
      G.swiping = true;
      row.classList.add('is-swiping');
      try {
        bubble.setPointerCapture(e.pointerId);
      } catch (_) { /* تجاهل */ }
    }
    const s = replySign(row._m);
    const raw = dx * s;
    const d = raw >= 0
      ? Math.min(UI.SWIPE_MAX_PX, raw > UI.SWIPE_TRIGGER_PX ? UI.SWIPE_TRIGGER_PX + (raw - UI.SWIPE_TRIGGER_PX) * 0.35 : raw)
      : Math.max(-14, raw * 0.2);
    G.shift = d;
    bubble.style.transform = `translateX(${d * s}px)`;
    row.style.setProperty('--p', (Math.max(0, d) / UI.SWIPE_TRIGGER_PX).toFixed(3));
  });

  const end = (e, cancelled) => {
    if (G.id !== e.pointerId) return;
    G.id = null;

    if (G.swiping) {
      const committed = !cancelled && G.shift >= UI.SWIPE_TRIGGER_PX && !!row._m;
      G.swiping = false;
      row.classList.remove('is-swiping');
      bubble.classList.add('is-snap');
      bubble.style.transform = '';
      row.style.setProperty('--p', '0');
      setTimeout(() => bubble.classList.remove('is-snap'), 260);
      if (committed) {
        vibrate();
        setReply(row._m);
      }
      return;
    }

    if (cancelled || !isCoarse()) return;
    const now = Date.now();
    if (G.lastTap && now - G.lastTap < UI.DOUBLE_TAP_MS && Math.hypot(e.clientX - G.tx, e.clientY - G.ty) < 32) {
      G.lastTap = 0;
      heartReact(row);
    } else {
      G.lastTap = now;
      G.tx = e.clientX;
      G.ty = e.clientY;
    }
  };

  bubble.addEventListener('pointerup', (e) => end(e, false));
  bubble.addEventListener('pointercancel', (e) => end(e, true));
  bubble.addEventListener('dblclick', (e) => {
    if (isCoarse() || (e.target.closest && e.target.closest('button, a'))) return;
    heartReact(row);
  });
}

function linkify(el, text) {
  const re = /https:\/\/[^\s<>"']{3,400}/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const idx = match.index;
    if (idx > last) el.append(document.createTextNode(text.slice(last, idx)));
    el.append(h('a', {
      class: 'cs-link',
      href: match[0],
      target: '_blank',
      rel: 'noopener noreferrer',
      text: match[0],
    }));
    last = idx + match[0].length;
  }
  if (last < text.length) el.append(document.createTextNode(text.slice(last)));
}

function textNode(text) {
  const el = h('div', { class: 'cs-text' });
  linkify(el, text);
  return el;
}

function quoteNode(r) {
  return h('button', {
    type: 'button',
    class: 'cs-quote',
    'aria-label': `الرد على ${r.name || 'رسالة'}`,
    onclick: (e) => {
      e.stopPropagation();
      scrollToMessage(r.id);
    },
  },
  h('span', { class: 'cs-quote-name', text: r.name || 'مستخدم' }),
  h('span', { class: 'cs-quote-text', text: r.text || '' }));
}

function attachmentNode(m) {
  const a = m.attachment;
  const media = ST.hooks.media;
  if (media && typeof media.renderAttachment === 'function') {
    try {
      const node = media.renderAttachment(a, m);
      if (node instanceof Node) return node;
    } catch (_) { /* نعود للعرض الاحتياطي */ }
  }
  const url = isSafeHttps(a.url) ? a.url : null;
  if (a.kind === 'image' && url) {
    return h('a', { class: 'cs-img-link', href: url, target: '_blank', rel: 'noopener noreferrer' },
      h('img', {
        class: 'cs-img',
        src: url,
        alt: a.name || 'صورة',
        loading: 'lazy',
        decoding: 'async',
        referrerpolicy: 'no-referrer',
      }));
  }
  const fallback = h('a', {
    class: 'cs-file',
    href: url || '#',
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-label': `تحميل ${a.name || 'ملف'}`,
  },
  icon('attach', 'cs-ico cs-file-ico'),
  h('span', { class: 'cs-file-body' },
    h('strong', { text: a.name || 'ملف' }),
    h('small', { text: fmtSize(a.size) })));
  if (!url) fallback.addEventListener('click', (e) => e.preventDefault());
  return fallback;
}

function statusNode(m, c) {
  if (m.state === MESSAGE_STATE.SENDING) return icon('clock', 'cs-ico cs-ico-xs cs-status is-sending');
  if (m.state === MESSAGE_STATE.FAILED) return icon('alert', 'cs-ico cs-ico-xs cs-status is-failed');
  return icon(c.isRead ? 'checks' : 'check', `cs-ico cs-ico-xs cs-status${c.isRead ? ' is-read' : ''}`);
}

function metaNode(m, c) {
  const kids = [];
  if (m.pinned) kids.push(icon('pin', 'cs-ico cs-ico-xs cs-pin-mark'));
  if (m.isEdited) kids.push(h('span', { class: 'cs-edited', text: 'معدّلة' }));
  kids.push(h('time', {
    class: 'cs-time',
    datetime: new Date(m.createdAt).toISOString(),
    text: fmtClock(m.createdAt),
  }));
  if (m.mine) kids.push(statusNode(m, c));
  return h('span', { class: 'cs-meta' }, kids);
}

function failNode(m) {
  return h('div', { class: 'cs-fail', role: 'alert' },
    icon('alert', 'cs-ico cs-ico-xs'),
    h('span', { text: 'تعذر الإرسال' }),
    h('button', {
      type: 'button',
      class: 'cs-fail-btn',
      onclick: (e) => {
        e.stopPropagation();
        ChatCore.retrySend(m.chatId, m.id);
      },
    }, icon('retry', 'cs-ico cs-ico-xs'), 'إعادة'),
    h('button', {
      type: 'button',
      class: 'cs-fail-btn is-danger',
      onclick: (e) => {
        e.stopPropagation();
        ChatCore.discardFailed(m.chatId, m.id);
      },
    }, 'حذف'));
}

function reactionsNode(m) {
  if (!m.reactionList || !m.reactionList.length) return null;
  return h('div', { class: 'cs-reactions', role: 'group', 'aria-label': 'التفاعلات' },
    m.reactionList.map((r) => h('button', {
      type: 'button',
      class: `cs-chip${r.mine ? ' is-mine' : ''}`,
      'aria-label': `${r.emoji} ${r.count}${r.mine ? '، تفاعلك' : ''}`,
      onclick: (e) => {
        e.stopPropagation();
        ChatCore.toggleReaction(m.chatId, m.id, r.emoji);
      },
    },
    h('span', { class: 'cs-chip-emoji', text: r.emoji }),
    r.count > 1 ? h('span', { class: 'cs-chip-n', text: String(r.count) }) : null)));
}

function fillBubble(row, m, c) {
  const bubble = row._bubble;
  const parts = [];
  if (m.forwardedFrom) {
    parts.push(h('div', { class: 'cs-fwd-label' },
      icon('forward', 'cs-ico cs-ico-xs'),
      h('span', { text: `أُعيد توجيهها من ${m.forwardedFrom.name || 'مستخدم'}` })));
  }
  if (m.replyTo) parts.push(quoteNode(m.replyTo));
  if (m.attachment) parts.push(attachmentNode(m));
  if (m.text) parts.push(textNode(m.text));
  if (m.state === MESSAGE_STATE.FAILED) parts.push(failNode(m));
  const reactions = reactionsNode(m);
  if (reactions) parts.push(reactions);
  parts.push(metaNode(m, c));
  bubble.replaceChildren(...parts);
}

function getMessageRow(m, c, reason) {
  const room = ST.room;
  let row = room.rows.get(m.id);
  if (!row) {
    row = buildMessageRow(m.id);
    room.rows.set(m.id, row);
    if (reason !== 'init' && reason !== 'older') row.classList.add('is-enter');
  }
  row._m = m;
  row.classList.toggle('is-mine', !!m.mine);
  row.classList.toggle('is-theirs', !m.mine);
  row.classList.toggle('is-join-prev', !!c.joinPrev);
  row.classList.toggle('is-join-next', !!c.joinNext);
  row.classList.toggle('is-pinned', !!m.pinned);
  row.classList.toggle('is-failed', m.state === MESSAGE_STATE.FAILED);
  row.classList.toggle('is-sending', m.state === MESSAGE_STATE.SENDING);

  if (row._state === MESSAGE_STATE.SENDING && m.state === MESSAGE_STATE.SENT) {
    row.classList.remove('is-pop');
    void row.offsetWidth;
    row.classList.add('is-pop');
  }
  row._state = m.state;

  const sig = msgSig(m, c);
  if (row._sig !== sig) {
    row._sig = sig;
    fillBubble(row, m, c);
  }
  return row;
}

/* ---------- عرض الرسائل ---------- */
function renderThread(payload) {
  const room = ST.room;
  const s = room.scroller;
  const reason = payload.reason || 'live';
  const list = Array.isArray(payload.messages) ? payload.messages : [];
  const v = ST.active && ST.active.chat;
  const wasNear = isNearBottom();
  const prevHeight = s.scrollHeight;
  const prevTop = s.scrollTop;

  renderPinned(payload.pinned);
  room.loader.hidden = !payload.loadingOlder;

  const myRead = toMsValue(v && v.readAt);
  const otherRead = toMsValue(v && v.otherReadAt);
  const ordered = [];
  let lastDay = 0;
  let unreadDone = false;

  if (!list.length && !payload.loadingOlder) ordered.push(emptyRoomNode());

  list.forEach((m, i) => {
    const prev = list[i - 1];
    const next = list[i + 1];
    const day = dayStart(m.createdAt);

    if (day !== lastDay) {
      ordered.push(sepNode(`d:${day}`, dayLabel(m.createdAt), 'cs-day'));
      lastDay = day;
    }
    if (!unreadDone && myRead && !m.mine && m.createdAt > myRead) {
      ordered.push(sepNode('u', 'رسائل غير مقروءة', 'cs-unread'));
      unreadDone = true;
    }

    const joinPrev = !!prev
      && prev.senderUid === m.senderUid
      && dayStart(prev.createdAt) === day
      && m.createdAt - prev.createdAt < UI.GROUP_GAP_MS;
    const joinNext = !!next
      && next.senderUid === m.senderUid
      && dayStart(next.createdAt) === day
      && next.createdAt - m.createdAt < UI.GROUP_GAP_MS;

    const c = { joinPrev, joinNext, isRead: !!m.mine && otherRead >= m.createdAt };
    ordered.push(getMessageRow(m, c, reason));
  });

  const alive = new Set(list.map((m) => m.id));
  room.rows.forEach((row, id) => {
    if (alive.has(id)) return;
    room.rows.delete(id);
    row.classList.add('is-leaving');
    setTimeout(() => row.remove(), 220);
  });

  syncChildren(room.thread, ordered);

  const newest = list[list.length - 1];
  const newestTs = newest ? newest.createdAt : 0;
  const isNew = reason === 'live' && newestTs > room.newestTs;
  room.newestTs = newestTs;

  if (reason === 'init') {
    scrollToBottom(false);
  } else if (reason === 'older') {
    s.scrollTop = s.scrollHeight - prevHeight + prevTop;
  } else if (isNew && newest.mine) {
    scrollToBottom(true);
  } else if (isNew && wasNear) {
    scrollToBottom(true);
  } else if (isNew) {
    room.newBelow += 1;
  }
  syncJump();
}

function scrollToMessage(id) {
  const room = ST.room;
  if (!room) return false;
  const row = room.rows.get(id);
  if (!row || !row.isConnected) {
    showToast('info', 'الرسالة غير محمّلة. مرّر للأعلى لتحميل المزيد.');
    return false;
  }
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row.classList.remove('is-flash');
  void row.offsetWidth;
  row.classList.add('is-flash');
  clearTimeout(row._flashT);
  row._flashT = setTimeout(() => row.classList.remove('is-flash'), ROOM.FLASH_MS);
  return true;
}

/* ---------- قائمة الرسالة والحذف والتوجيه ---------- */
function openMessageMenu(m, point) {
  const room = ST.room;
  if (!m || !room || !room.chatId) return;
  const chatId = room.chatId;
  const v = ST.active && ST.active.chat;

  if (m.state === MESSAGE_STATE.SENDING) {
    showToast('info', 'الرسالة قيد الإرسال.');
    return;
  }

  if (m.state === MESSAGE_STATE.FAILED) {
    openMenu(point, [
      { label: 'إعادة الإرسال', icon: 'retry', onSelect: () => ChatCore.retrySend(chatId, m.id) },
      { label: 'حذف من الجهاز', icon: 'trash', danger: true, onSelect: () => ChatCore.discardFailed(chatId, m.id) },
    ], { title: 'فشل الإرسال' });
    return;
  }

  const items = [
    { label: 'رد', icon: 'reply', onSelect: () => setReply(m) },
    { label: 'تفاعل', icon: 'smile', onSelect: () => openReactBar(m, point) },
  ];
  if (m.text) items.push({ label: 'نسخ النص', icon: 'copy', onSelect: () => copyText(m.text) });
  items.push({ label: 'إعادة توجيه', icon: 'forward', onSelect: () => openForwardDialog(m) });
  if (m.mine && m.text) items.push({ label: 'تعديل', icon: 'edit', onSelect: () => setEdit(m) });
  if (v && v.status === CHAT_STATUS.ACTIVE) {
    items.push({
      label: m.pinned ? 'إلغاء تثبيت الرسالة' : 'تثبيت الرسالة',
      icon: m.pinned ? 'unpin' : 'pin',
      onSelect: () => (m.pinned
        ? ChatCore.unpinMessage(chatId, m.id)
        : ChatCore.pinMessage(chatId, m.id)),
    });
  }
  items.push({ separator: true });
  items.push({ label: 'حذف', icon: 'trash', danger: true, onSelect: () => confirmDeleteMessage(m) });

  openMenu(point, items, { title: senderLabel(m) });
}

function confirmDeleteMessage(m) {
  const room = ST.room;
  const chatId = room && room.chatId;
  if (!chatId) return;
  const canAll = !!m.mine && m.state === MESSAGE_STATE.SENT;
  const actions = [
    { label: 'إلغاء', value: null, tone: 'ghost' },
    { label: 'حذف عندي', value: 'me', tone: 'ghost' },
  ];
  if (canAll) actions.push({ label: 'حذف للجميع', value: 'all', tone: 'danger' });

  openDialog({
    title: 'حذف الرسالة؟',
    body: h('p', {
      class: 'cs-dialog-text',
      text: canAll
        ? 'احذفها من عندك فقط، أو للجميع فتختفي من عند الطرف الآخر أيضاً.'
        : 'ستختفي الرسالة من حسابك فقط.',
    }),
    tone: 'danger',
    actions,
  }).result.then((choice) => {
    if (choice === 'all') runAction(() => ChatCore.deleteForEveryone(chatId, m.id));
    else if (choice === 'me') runAction(() => ChatCore.deleteForMe(chatId, m.id));
  });
}

function openForwardDialog(m) {
  const room = ST.room;
  const srcChatId = room && room.chatId;
  if (!srcChatId || !m) return;

  const max = CHAT_LIMITS.MAX_FORWARD_TARGETS;
  const selected = new Map();
  const counter = h('span', {
    class: 'cs-fwd-count',
    'aria-live': 'polite',
    text: `اختر حتى ${max} محادثات`,
  });
  const search = h('input', {
    type: 'search',
    class: 'cs-search-input cs-fwd-search',
    placeholder: 'ابحث عن محادثة',
    'aria-label': 'بحث في المحادثات',
    autocomplete: 'off',
  });
  const list = h('div', { class: 'cs-fwd-list', role: 'listbox', 'aria-multiselectable': 'true' });
  const eligible = ST.chats.filter((v) => v.id !== srcChatId
    && v.status !== CHAT_STATUS.BLOCKED
    && !v.blocked
    && !v.isRequestIncoming);

  let dialog = null;
  const items = eligible.map((v) => {
    const title = v.title || v.username || 'مستخدم';
    const el = h('button', { type: 'button', class: 'cs-fwd-row', role: 'option', 'aria-selected': 'false' },
      avatarEl(title, v.photo, 'cs-avatar cs-avatar-sm'),
      h('span', { class: 'cs-fwd-name', text: title }),
      h('span', { class: 'cs-fwd-check', 'aria-hidden': 'true' }, icon('check', 'cs-ico cs-ico-sm')));
    el.addEventListener('click', () => {
      if (selected.has(v.id)) {
        selected.delete(v.id);
      } else if (selected.size >= max) {
        showToast('info', `الحد الأقصى ${max} محادثات.`);
        return;
      } else {
        selected.set(v.id, v);
      }
      const on = selected.has(v.id);
      el.classList.toggle('is-selected', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      counter.textContent = selected.size
        ? `تم اختيار ${selected.size} من ${max}`
        : `اختر حتى ${max} محادثات`;
      if (dialog) dialog.setDisabled(1, selected.size === 0);
    });
    list.append(el);
    return { v, el };
  });

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    items.forEach(({ v, el }) => {
      const hay = `${v.title || ''} ${v.username || ''}`.toLowerCase();
      el.hidden = !!q && !hay.includes(q);
    });
  });

  const body = h('div', { class: 'cs-fwd-wrap' },
    search,
    counter,
    eligible.length ? list : h('p', { class: 'cs-fwd-empty', text: 'لا توجد محادثات متاحة للتوجيه.' }));

  dialog = openDialog({
    title: 'إعادة توجيه الرسالة',
    body,
    actions: [
      { label: 'إلغاء', value: null, tone: 'ghost' },
      { label: 'إرسال', value: 'send', tone: 'primary' },
    ],
  });
  dialog.setDisabled(1, true);

  dialog.result.then((choice) => {
    if (choice !== 'send' || !selected.size) return;
    runAction(() => ChatCore.forwardMessage(srcChatId, m.id, [...selected.keys()]));
  });
}

/* ---------- أحداث ChatCore (تُربط في الجزء 3/3) ---------- */
function resetThread() {
  const room = ST.room;
  if (!room) return;
  [...room.thread.children].forEach((n) => {
    if (n !== room.loader) n.remove();
  });
  room.rows.clear();
  room.seps.clear();
  room.loader.hidden = true;
  room.pinnedList = [];
  room.pinIdx = 0;
  room.pinBar.hidden = true;
  room.newestTs = 0;
  room.newBelow = 0;
  syncJump();
}

/* payload = { chat, blockedByMe, otherUid } | null */
function onRoomActive(payload) {
  const room = buildRoom();

  if (!payload || !payload.chat) {
    saveDraft();
    clearContext({ restore: false });
    room.chatId = null;
    room.typing = [];
    resetThread();
    room.gateKey = '';
    room.banner.hidden = true;
    room.el.hidden = true;
    ST.active = null;
    ST.activeId = null;
    ST.els.empty.hidden = false;
    setRoomOpen(false);
    renderList();
    return;
  }

  const chat = payload.chat;
  const switched = room.chatId !== chat.id;
  ST.active = payload;
  ST.activeId = chat.id;

  if (switched) {
    saveDraft();
    clearContext({ restore: false });
    resetThread();
    room.chatId = chat.id;
    room.typing = [];
    room.gateKey = '';
    room.input.value = room.drafts.get(chat.id) || '';
    room.el.hidden = false;
    ST.els.empty.hidden = true;
    setRoomOpen(true);
    autoGrow();
  }

  updateRoomHeader();
  updateGate(chat);
  refreshSendMode();
  renderList();
}

/* payload = { chatId, reason, messages[], hasOlder, loadingOlder, pinned[] } */
function onRoomMessages(payload) {
  const room = ST.room;
  if (!room || !payload || payload.chatId !== room.chatId) return;
  renderThread(payload);
}

/* payload = { chatId, uids[], isTyping } */
function onRoomTyping(payload) {
  const room = ST.room;
  if (!room || !payload || payload.chatId !== room.chatId) return;
  room.typing = Array.isArray(payload.uids) ? payload.uids : [];
  updateRoomHeader();
}
/* ============================================================
   js/chat-ui.js — الجزء 3/3
   يحتوي: البحث داخل المحادثة (toggleRoomSearch)، الاختصارات،
   ربط أحداث ChatCore بالواجهة، حقن الاعتماديات (use)،
   التركيب (mount/init)، والتصدير (ChatUI)
   ============================================================ */

const ROOM_SEARCH_CFG = Object.freeze({
  DEBOUNCE_MS: 120,
});

// ---------- حالة البحث داخل المحادثة ----------
const roomSearch = {
  open: false,
  chatId: null,
  bar: null,
  input: null,
  count: null,
  btns: null,
  q: '',        // الاستعلام بعد التطبيع
  hits: [],     // معرّفات الرسائل المطابقة، من الأحدث إلى الأقدم
  idx: -1,      // موضع النتيجة الحالية داخل hits
  timer: 0,
};

let roomCache = { chatId: null, list: [] }; // آخر قائمة رسائل وصلت من ChatCore
let coreBound = false;
let keysBound = false;

// ---------- أدوات صغيرة ----------

/**
 * إنشاء عنصر DOM بخصائص وأبناء.
 * - class: اسم الصنف
 * - text: نص العنصر
 * - on<event>: مستمع حدث
 * - dataset: كائن بيانات
 */
function makeEl(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (val == null || val === false) continue;
    if (key === 'class') node.className = val;
    else if (key === 'text') node.textContent = val;
    else if (key.startsWith('on') && typeof val === 'function') node.addEventListener(key.slice(2), val);
    else if (key === 'dataset') Object.assign(node.dataset, val);
    else node.setAttribute(key, val === true ? '' : String(val));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

/** تطبيع عربي للبحث: إزالة التشكيل وتوحيد الألف والتاء المربوطة والياء. */
function normalizeAr(str) {
  return String(str || '')
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[\u0622\u0623\u0625]/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0649/g, '\u064A')
    .toLowerCase()
    .trim();
}

function messageSearchText(m) {
  return [m?.text, m?.attachment?.name].filter(Boolean).join(' ');
}

function currentChatId() {
  return ST.activeId || null;
}

function roomHost() {
  return ST.room?.root || ST.root?.querySelector('.cs-room') || ST.root || null;
}

function notAvailable(text) {
  showToast('info', text);
}

// ---------- البحث داخل المحادثة ----------

function buildRoomSearchBar() {
  const input = makeEl('input', {
    class: 'cs-findbar-input',
    type: 'search',
    placeholder: 'ابحث في هذه المحادثة',
    'aria-label': 'ابحث في هذه المحادثة',
    autocomplete: 'off',
    enterkeyhint: 'search',
  });
  const count = makeEl('span', { class: 'cs-findbar-count', 'aria-live': 'polite' });
  const up = makeEl('button', {
    type: 'button',
    class: 'cs-findbar-btn',
    title: 'الأحدث (Shift+Enter)',
    'aria-label': 'النتيجة الأحدث',
    onclick: () => stepRoomSearch(-1),
    text: '▲',
  });
  const down = makeEl('button', {
    type: 'button',
    class: 'cs-findbar-btn',
    title: 'الأقدم (Enter)',
    'aria-label': 'النتيجة الأقدم',
    onclick: () => stepRoomSearch(1),
    text: '▼',
  });
  const close = makeEl('button', {
    type: 'button',
    class: 'cs-findbar-btn',
    title: 'إغلاق (Esc)',
    'aria-label': 'إغلاق البحث',
    onclick: () => closeRoomSearch(),
    text: '✕',
  });
  const bar = makeEl('div', { class: 'cs-findbar', role: 'search' }, input, count, up, down, close);

  input.addEventListener('input', () => {
    clearTimeout(roomSearch.timer);
    roomSearch.timer = setTimeout(() => runRoomSearch(input.value, 'query'), ROOM_SEARCH_CFG.DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      stepRoomSearch(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeRoomSearch();
    }
  });

  return { bar, input, count, btns: [up, down] };
}

/**
 * تشغيل البحث على قائمة الرسائل المخزّنة.
 * mode = 'query'   : استعلام جديد، ينتقل إلى الأحدث.
 * mode = 'refresh' : تحديث بعد وصول رسائل، يحافظ على النتيجة الحالية.
 */
function runRoomSearch(rawQuery, mode) {
  const q = normalizeAr(rawQuery);
  roomSearch.q = q;

  const prevId = mode === 'refresh' ? roomSearch.hits[roomSearch.idx] : undefined;
  const list = roomCache.chatId === roomSearch.chatId ? roomCache.list : [];

  roomSearch.hits = q
    ? list.filter((m) => normalizeAr(messageSearchText(m)).includes(q)).map((m) => m.id).reverse()
    : [];

  let idx = prevId !== undefined ? roomSearch.hits.indexOf(prevId) : -1;
  if (idx < 0) idx = roomSearch.hits.length ? 0 : -1;
  roomSearch.idx = idx;

  syncRoomSearchUi();
  if (mode === 'query' && idx === 0) scrollToMessage(roomSearch.hits[0]);
}

function stepRoomSearch(dir) {
  const n = roomSearch.hits.length;
  if (!roomSearch.open || !n) return;
  const idx = roomSearch.idx < 0
    ? (dir > 0 ? 0 : n - 1)
    : (roomSearch.idx + dir + n) % n;
  roomSearch.idx = idx;
  syncRoomSearchUi();
  scrollToMessage(roomSearch.hits[idx]);
}

function syncRoomSearchUi() {
  if (!roomSearch.open) return;
  const { hits, idx, q, count, btns } = roomSearch;
  if (count) {
    count.textContent = !q ? '' : hits.length ? `${idx + 1} من ${hits.length}` : 'لا توجد نتائج';
  }
  btns?.forEach((b) => { b.disabled = hits.length === 0; });
}

function openRoomSearch() {
  const chatId = currentChatId();
  if (!chatId) {
    notAvailable('افتح محادثة أولاً لتبحث فيها');
    return;
  }
  if (roomSearch.open && roomSearch.chatId === chatId) {
    roomSearch.input.focus();
    return;
  }
  if (roomSearch.open) closeRoomSearch();

  const host = roomHost();
  if (!host) return;

  const built = buildRoomSearchBar();
  // يُدرج الشريط تحت ترويسة المحادثة إن وُجدت، وإلا في أعلى المنطقة.
  const head = host.querySelector('.cs-room-head, .cs-room-header');
  if (head) head.after(built.bar);
  else host.prepend(built.bar);

  Object.assign(roomSearch, {
    open: true,
    chatId,
    bar: built.bar,
    input: built.input,
    count: built.count,
    btns: built.btns,
    q: '',
    hits: [],
    idx: -1,
  });

  requestAnimationFrame(() => built.bar.classList.add('is-open'));
  built.input.focus();
  syncRoomSearchUi();
}

function closeRoomSearch() {
  if (!roomSearch.open) return;
  clearTimeout(roomSearch.timer);
  roomSearch.bar?.remove();
  Object.assign(roomSearch, {
    open: false,
    chatId: null,
    bar: null,
    input: null,
    count: null,
    btns: null,
    q: '',
    hits: [],
    idx: -1,
    timer: 0,
  });
}

/** تبديل شريط البحث داخل المحادثة. يُستدعى من زر البحث في الترويسة. */
function toggleRoomSearch(force) {
  const want = typeof force === 'boolean' ? force : !roomSearch.open;
  if (want) openRoomSearch();
  else closeRoomSearch();
}

/** تركيز شريط بحث القائمة (Ctrl+K). */
function focusListSearch() {
  toggleSearch(true);
  const input = ST.root?.querySelector('.cs-sidebar input[type="search"]');
  input?.focus();
}

// ---------- الاختصارات ----------

function onGlobalKeyDown(e) {
  // إن عالج عنصر آخر الحدث (مثلاً حقل البحث على Escape) نتوقف هنا.
  if (e.defaultPrevented) return;

  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && !e.shiftKey) {
    const key = e.key.toLowerCase();
    if (key === 'k') {
      e.preventDefault();
      focusListSearch();
      return;
    }
    if (key === 'f' && currentChatId()) {
      e.preventDefault();
      toggleRoomSearch(true);
      return;
    }
  }

  if (e.key === 'Escape' && roomSearch.open) {
    e.preventDefault();
    closeRoomSearch();
  }
}

// ---------- ربط أحداث ChatCore ----------

function onAuthChange(user) {
  ST.uid = user ? user.uid : null;
  if (user) return;

  // تسجيل خروج: تنظيف الحالة الكاملة للواجهة.
  closeRoomSearch();
  resetThread();
  ST.chats = [];
  ST.chatsReady = false;
  setRoomOpen(false);
  renderList();
}

function onCoreReady() {
  ST.chatsReady = true;
  renderList();
}

function onChatsChanged(list) {
  ST.chats = Array.isArray(list) ? list : [];
  ST.chatsReady = true;
  renderList();
}

function onActiveChanged(payload) {
  const nextId = payload?.chat?.id ?? null;
  if (roomSearch.open && roomSearch.chatId !== nextId) closeRoomSearch();
  if (nextId !== roomCache.chatId) roomCache = { chatId: nextId, list: [] };
  onRoomActive(payload);
}

function onMessagesChanged(payload) {
  roomCache = {
    chatId: payload?.chatId ?? null,
    list: Array.isArray(payload?.messages) ? payload.messages : [],
  };
  onRoomMessages(payload);
  if (roomSearch.open && roomSearch.chatId === payload?.chatId && roomSearch.input?.value) {
    runRoomSearch(roomSearch.input.value, 'refresh');
  }
}

function onTypingChanged(payload) {
  onRoomTyping(payload);
  if (payload?.chatId) setTypingIn(payload.chatId, payload.uids || []);
}

function onIncoming(p) {
  // الصوت والإشعارات الخارجية يتولاها chat-sound.js، وهنا تنبيه داخل الصفحة فقط.
  if (!p || p.isActive || p.senderUid === ST.uid || document.hidden) return;
  const text = [p.title, p.preview].filter(Boolean).join(': ');
  showToast('info', text || 'رسالة جديدة');
}

function onSendFailed(p) {
  showToast('danger', p?.message || 'تعذّر إرسال الرسالة');
}

function onCoreToast(p) {
  showToast(p?.type || 'info', p?.text || '');
}

function onCoreError(err) {
  console.error('[ChatUI]', err);
  showToast('danger', err?.message || 'حدث خطأ غير متوقع');
}

function bindCoreEvents() {
  if (coreBound) return;
  coreBound = true;
  ChatCore.on('auth', onAuthChange);
  ChatCore.on('ready', onCoreReady);
  ChatCore.on('chats', onChatsChanged);
  ChatCore.on('chat:active', onActiveChanged);
  ChatCore.on('messages', onMessagesChanged);
  ChatCore.on('typing', onTypingChanged);
  ChatCore.on('incoming', onIncoming);
  ChatCore.on('send-failed', onSendFailed);
  ChatCore.on('toast', onCoreToast);
  ChatCore.on('error', onCoreError);
}

// ---------- حقن الاعتماديات ----------

const HOOK_GROUPS = Object.freeze({
  media: ['pick', 'recordVoice', 'renderAttachment'],
  settings: ['open'],
  profile: ['open'],
});

function defaultHooks() {
  return {
    media: {
      pick: async () => { notAvailable('إرسال المرفقات غير متاح حالياً'); return false; },
      recordVoice: async () => { notAvailable('التسجيل الصوتي غير متاح حالياً'); return false; },
      renderAttachment: (att) => makeEl('a', {
        class: 'cs-attach-fallback',
        href: isSafeHttps(att?.url) ? att.url : '#',
        target: '_blank',
        rel: 'noopener noreferrer',
        text: att?.name || 'ملف مرفق',
      }),
    },
    settings: { open: () => notAvailable('الإعدادات غير متاحة حالياً') },
    profile: { open: () => notAvailable('الملف الشخصي غير متاح حالياً') },
    startChat: () => notAvailable('بدء محادثة جديدة غير متاح حالياً'),
  };
}

/** يدمج أي اعتمادات موجودة مع الافتراضيات، بحيث لا تبقى أي دالة ناقصة. */
function hooksWithDefaults(base) {
  const d = defaultHooks();
  return {
    media: { ...d.media, ...(base?.media || {}) },
    settings: { ...d.settings, ...(base?.settings || {}) },
    profile: { ...d.profile, ...(base?.profile || {}) },
    startChat: base?.startChat || d.startChat,
  };
}

/**
 * حقن الاعتماديات من خارج الواجهة (chat-media.js و chat-settings.js وغيرهما).
 * يقبل الاستدعاء أكثر من مرة، وكل استدعاء يحدّث ما يمرَّر فقط.
 */
function use(hooks = {}) {
  if (!hooks || typeof hooks !== 'object') {
    throw new TypeError('ChatUI.use: expects an object');
  }
  const next = hooksWithDefaults(ST.hooks);

  for (const [group, names] of Object.entries(HOOK_GROUPS)) {
    const incoming = hooks[group];
    if (incoming == null) continue;
    if (typeof incoming !== 'object') {
      throw new TypeError(`ChatUI.use: "${group}" must be an object`);
    }
    for (const name of names) {
      if (incoming[name] == null) continue;
      if (typeof incoming[name] !== 'function') {
        throw new TypeError(`ChatUI.use: "${group}.${name}" must be a function`);
      }
      next[group][name] = incoming[name];
    }
  }

  if (hooks.startChat != null) {
    if (typeof hooks.startChat !== 'function') {
      throw new TypeError('ChatUI.use: "startChat" must be a function');
    }
    next.startChat = hooks.startChat;
  }

  ST.hooks = next;
  return ChatUI;
}

// ---------- التركيب ----------

/** تركيب الواجهة داخل الجذر. آمن للاستدعاء المتكرر. */
function mount(root) {
  if (ST.mounted) return ChatUI;
  if (!(root instanceof HTMLElement)) {
    throw new TypeError('ChatUI.mount: root must be an HTMLElement');
  }

  ST.root = root;
  ST.hooks = hooksWithDefaults(ST.hooks);
  buildShell(root);
  if (!ST.room) buildRoom();
  bindCoreEvents();

  if (!keysBound) {
    document.addEventListener('keydown', onGlobalKeyDown);
    keysBound = true;
  }

  if (!ST.chatsReady) renderSkeleton();
  ST.mounted = true;
  return ChatUI;
}

/**
 * اختصار: حقن الاعتماديات ثم التركيب.
 * يُستدعى في chat.html قبل ChatCore.init حتى لا تفوت الواجهة أي حدث.
 */
function init(root, hooks) {
  if (hooks) use(hooks);
  return mount(root);
}

// ---------- التصدير ----------

export const ChatUI = Object.freeze({
  init,
  mount,
  use,
  toggleSearch,
  toggleRoomSearch,
  focusListSearch,
});
