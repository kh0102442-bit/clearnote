/* ============================================================
   js/chat-select.js — تحديد الرسائل المتعددة
   الإجراءات: حذف (لي فقط / للجميع)، إعادة توجيه، نسخ، حفظ كملف .txt
   التكامل: يستدعي chat-ui.js الدالة ChatSelect.attach(صف, رسالة) لكل صف رسالة.
   الأنماط تُحقن تلقائياً، فلا يلزم تعديل أي ملف CSS.
   طرق التحديد: Ctrl/⌘ + نقرة، أو ضغط مطوّل، أو نقرة على المربع.
   ============================================================ */
import { ChatCore } from './chat-core.js';

const { CHAT_LIMITS, MESSAGE_STATE } = ChatCore.constants;

const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 8;
const ROW_SEL = '[data-sel-id]';
const STYLE_ID = 'cs-select-style';
const ATTACH_LABEL = Object.freeze({
  image: 'صورة',
  video: 'فيديو',
  audio: 'مقطع صوتي',
  pdf: 'ملف PDF',
  file: 'ملف',
});
const DATE_FMT = new Intl.DateTimeFormat('ar', { dateStyle: 'short', timeStyle: 'short' });

const ICONS = Object.freeze({
  forward: '<path d="M9 17l-5-5 5-5"/><path d="M4 12h11a5 5 0 0 1 5 5v2"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  save: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
});

const st = {
  active: false,          // وضع التحديد مفعّل
  chatId: null,           // المحادثة النشطة التي تجري فيها التحديد
  chatTitle: '',
  messages: new Map(),    // id -> رسالة (من آخر تحديث للواجهة)
  selected: new Set(),    // معرّفات الرسائل المحددة
  anchor: null,           // آخر رسالة حُددت يدوياً (لتحديد المدى بـ Shift)
  views: [],              // قائمة المحادثات (لنافذة إعادة التوجيه)
  busy: false,            // عملية جارية (توجيه أو حذف)
  ignoreClick: false,     // يمنع النقرة التي تلي الضغط المطوّل من التبديل مرتين
  ignoreTimer: null,
  pressTimer: null,
  pressStart: null,
  bar: null,
  barCount: null,
  barButtons: {},
};

let toastEl = null;
let toastTimer = 0;

/* ------------------------------------------------------------
   أدوات مساعدة
   ------------------------------------------------------------ */
/** إنشاء عنصر DOM بخصائص وأبناء دون innerHTML. */
function h(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(props)) {
    if (val == null || val === false) continue;
    if (key === 'class') node.className = String(val);
    else if (key === 'text') node.textContent = String(val);
    else if (key === 'on') {
      for (const [evt, fn] of Object.entries(val)) node.addEventListener(evt, fn);
    } else node.setAttribute(key, val === true ? '' : String(val));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function icon(name) {
  const holder = document.createElement('span');
  holder.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return holder.firstElementChild;
}

/** صيغة عربية صحيحة للعدد: رسالة واحدة، رسالتان، 3 رسائل، ... */
function countLabel(n) {
  if (n === 1) return 'رسالة واحدة محددة';
  if (n === 2) return 'رسالتان محددتان';
  if (n >= 3 && n <= 10) return `${n} رسائل محددة`;
  return `${n} رسالة محددة`;
}

function setAvatar(node, title, photo) {
  node.replaceChildren();
  const initial = (String(title || '').trim().charAt(0) || '؟').toUpperCase();
  if (photo && /^https:\/\//.test(photo)) {
    const img = h('img', { src: photo, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => node.replaceChildren(document.createTextNode(initial)));
    node.append(img);
  } else {
    node.textContent = initial;
  }
}

function isTyping(target) {
  return target instanceof HTMLElement
    && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/* ------------------------------------------------------------
   التنبيهات الخفيفة
   ------------------------------------------------------------ */
function notify(text, tone = 'info') {
  ensureStyles();
  if (!toastEl) {
    toastEl = h('div', { class: 'cs-sel-toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastEl);
  }
  toastEl.textContent = String(text || '');
  toastEl.dataset.tone = tone;
  toastEl.classList.add('is-in');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-in'), 2400);
}

/* ------------------------------------------------------------
   النسخ إلى الحافظة (مع احتياط للمتصفحات القديمة)
   ------------------------------------------------------------ */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const ta = h('textarea', { readonly: true });
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;inset-inline-start:0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (_) {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/* ------------------------------------------------------------
   الأنماط (تُحقن مرة واحدة)
   ------------------------------------------------------------ */
const CSS = `
[data-sel-id]{position:relative}
.cs-sel-check{position:absolute;top:50%;inset-inline-start:6px;width:22px;height:22px;margin-top:-11px;display:grid;place-items:center;padding:0;border-radius:50%;border:2px solid rgba(127,127,127,.55);background:var(--cs-surface,#ffffff);opacity:0;pointer-events:none;cursor:pointer;transition:opacity .18s ease,background-color .18s ease,border-color .18s ease}
.cs-sel-check::after{content:"";width:5px;height:9px;border:solid #ffffff;border-width:0 2px 2px 0;transform:translateY(-1px) rotate(45deg) scale(0);transition:transform .18s ease}
.cs-sel-check[aria-checked="true"]{background:var(--cs-accent,#3b82f6);border-color:var(--cs-accent,#3b82f6)}
.cs-sel-check[aria-checked="true"]::after{transform:translateY(-1px) rotate(45deg) scale(1)}
.cs-sel-on [data-sel-id]{padding-inline-start:40px;cursor:pointer;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;transition:background-color .15s ease}
.cs-sel-on .cs-sel-check{opacity:1;pointer-events:auto}
.cs-sel-on [data-sel-id]>*:not(.cs-sel-check){pointer-events:none}
.cs-sel-on [data-sel-id].is-selected{background:color-mix(in srgb,var(--cs-accent,#3b82f6) 14%,transparent);border-radius:14px}

.cs-sel-bar{position:fixed;inset-inline:0;bottom:0;z-index:60;display:flex;justify-content:center;padding:0 10px calc(10px + env(safe-area-inset-bottom,0px));pointer-events:none;transform:translateY(120%);transition:transform .24s ease}
.cs-sel-bar.is-open{transform:none;pointer-events:auto}
.cs-sel-bar-inner{width:min(680px,100%);display:flex;align-items:center;gap:4px;padding:8px;border-radius:18px;background:var(--cs-surface,#ffffff);color:var(--cs-text,#111827);border:1px solid rgba(127,127,127,.2);box-shadow:0 12px 32px rgba(0,0,0,.18)}
.cs-sel-count{flex:1;min-width:0;padding-inline:6px;font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cs-sel-btn{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-width:52px;padding:6px;border:0;border-radius:12px;background:transparent;color:inherit;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;transition:background-color .15s ease,opacity .15s ease}
.cs-sel-btn svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.cs-sel-btn:hover:not(:disabled){background:rgba(127,127,127,.14)}
.cs-sel-btn:disabled{opacity:.35;cursor:not-allowed}
.cs-sel-btn.is-danger{color:#e5484d}

.cs-sel-overlay{position:fixed;inset:0;z-index:80;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.45);opacity:0;transition:opacity .18s ease}
.cs-sel-overlay.is-open{opacity:1}
.cs-sel-dialog{width:min(440px,100%);max-height:min(640px,86vh);display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:18px;background:var(--cs-surface,#ffffff);color:var(--cs-text,#111827);box-shadow:0 20px 50px rgba(0,0,0,.3);transform:translateY(8px) scale(.98);transition:transform .2s ease}
.cs-sel-overlay.is-open .cs-sel-dialog{transform:none}
.cs-sel-dialog h3{margin:0;font-size:16px}
.cs-sel-dialog p{margin:0;font-size:14px;line-height:1.6;opacity:.8}
.cs-sel-hint{font-size:13px!important;opacity:.7!important}
.cs-sel-input{width:100%;padding:10px 12px;border-radius:12px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font-family:inherit;font-size:14px;outline:none}
.cs-sel-input:focus{border-color:var(--cs-accent,#3b82f6)}
.cs-sel-list{flex:1;min-height:140px;overflow:auto;display:flex;flex-direction:column;gap:4px;padding:2px}
.cs-sel-item{width:100%;display:flex;align-items:center;gap:10px;padding:8px;border:0;border-radius:12px;background:transparent;color:inherit;font-family:inherit;text-align:start;cursor:pointer}
.cs-sel-item:hover{background:rgba(127,127,127,.1)}
.cs-sel-item[aria-checked="true"]{background:color-mix(in srgb,var(--cs-accent,#3b82f6) 14%,transparent)}
.cs-sel-avatar{width:40px;height:40px;border-radius:50%;overflow:hidden;flex:0 0 auto;display:grid;place-items:center;background:rgba(127,127,127,.2);font-weight:700}
.cs-sel-avatar img{width:100%;height:100%;object-fit:cover;display:block}
.cs-sel-item-main{flex:1;min-width:0;display:flex;flex-direction:column}
.cs-sel-item-main strong{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cs-sel-item-main small{font-size:12px;opacity:.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cs-sel-tick{width:22px;height:22px;border-radius:50%;border:2px solid rgba(127,127,127,.5);flex:0 0 auto;display:grid;place-items:center}
.cs-sel-item[aria-checked="true"] .cs-sel-tick{background:var(--cs-accent,#3b82f6);border-color:var(--cs-accent,#3b82f6)}
.cs-sel-item[aria-checked="true"] .cs-sel-tick::after{content:"";width:5px;height:9px;border:solid #ffffff;border-width:0 2px 2px 0;transform:translateY(-1px) rotate(45deg)}
.cs-sel-foot{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px}
.cs-sel-dbtn{padding:9px 14px;border-radius:12px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer}
.cs-sel-dbtn.primary{background:var(--cs-accent,#3b82f6);border-color:transparent;color:#ffffff}
.cs-sel-dbtn.danger{background:#e5484d;border-color:transparent;color:#ffffff}
.cs-sel-dbtn:disabled{opacity:.45;cursor:not-allowed}
.cs-sel-empty{font-size:13px!important;opacity:.6!important;text-align:center;padding:20px 0}

.cs-sel-toast{position:fixed;top:14px;inset-inline:0;margin-inline:auto;width:max-content;max-width:90vw;z-index:90;padding:9px 16px;border-radius:12px;background:#1f2430;color:#ffffff;font-size:14px;opacity:0;transform:translateY(-6px);transition:opacity .2s ease,transform .2s ease;pointer-events:none}
.cs-sel-toast.is-in{opacity:1;transform:none}
.cs-sel-toast[data-tone="danger"]{background:#b42318}
.cs-sel-toast[data-tone="success"]{background:#1f7a4d}

@media (prefers-reduced-motion: reduce){
  .cs-sel-bar,.cs-sel-overlay,.cs-sel-dialog,.cs-sel-check,.cs-sel-check::after,.cs-sel-toast{transition:none}
}
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

/* ------------------------------------------------------------
   شريط الإجراءات السفلي
   ------------------------------------------------------------ */
function buildBar() {
  ensureStyles();
  const count = h('span', { class: 'cs-sel-count', 'aria-live': 'polite' });
  const actionBtn = (key, label, iconName, extra = '') => {
    const btn = h(
      'button',
      {
        type: 'button',
        class: `cs-sel-btn ${extra}`.trim(),
        title: label,
        'aria-label': label,
        on: { click: () => onAction(key) },
      },
      icon(iconName),
      h('span', { text: label }),
    );
    st.barButtons[key] = btn;
    return btn;
  };
  const closeBtn = h(
    'button',
    {
      type: 'button',
      class: 'cs-sel-btn',
      title: 'إلغاء التحديد',
      'aria-label': 'إلغاء التحديد',
      on: { click: () => exitMode() },
    },
    icon('close'),
  );
  st.barCount = count;
  st.bar = h(
    'div',
    { class: 'cs-sel-bar' },
    h(
      'div',
      { class: 'cs-sel-bar-inner', role: 'toolbar', 'aria-label': 'إجراءات الرسائل المحددة' },
      closeBtn,
      count,
      actionBtn('forward', 'توجيه', 'forward'),
      actionBtn('copy', 'نسخ', 'copy'),
      actionBtn('save', 'حفظ txt', 'save'),
      actionBtn('delete', 'حذف', 'trash', 'is-danger'),
    ),
  );
  document.body.append(st.bar);
}

function ensureBar() {
  if (!st.bar) buildBar();
}

function renderBar() {
  if (!st.bar) return;
  const hasSel = selectedMessages().length > 0;
  st.bar.classList.toggle('is-open', st.active);
  st.barCount.textContent = countLabel(st.selected.size);
  const off = st.busy || !hasSel;
  st.barButtons.forward.disabled = off;
  st.barButtons.copy.disabled = off;
  st.barButtons.save.disabled = off;
  st.barButtons.delete.disabled = off;
}

/* ------------------------------------------------------------
   وضع التحديد
   ------------------------------------------------------------ */
function paintRow(row) {
  const id = row.dataset.selId;
  if (!id) return;
  const on = st.selected.has(id);
  row.classList.toggle('is-selected', on);
  row.querySelector(':scope > .cs-sel-check')?.setAttribute('aria-checked', String(on));
}

function paintAll() {
  document.documentElement.classList.toggle('cs-sel-on', st.active);
  document.querySelectorAll(ROW_SEL).forEach(paintRow);
}

function enterMode() {
  if (st.active) return;
  ensureBar();
  st.active = true;
  paintAll();
  renderBar();
}

function exitMode() {
  clearTimeout(st.pressTimer);
  st.pressTimer = null;
  st.pressStart = null;
  st.active = false;
  st.selected.clear();
  st.anchor = null;
  paintAll();
  renderBar();
}

function selectedMessages() {
  return [...st.selected]
    .map((id) => st.messages.get(id))
    .filter(Boolean)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** تبديل تحديد صف. range = true يحدد كل ما بين آخر رسالة حُددت وهذه الرسالة. */
function applyToggle(row, range = false) {
  const id = row.dataset.selId;
  if (!id) return;
  if (range && st.anchor && st.anchor !== id) {
    const ids = [...document.querySelectorAll(ROW_SEL)]
      .map((r) => r.dataset.selId)
      .filter(Boolean);
    const a = ids.indexOf(st.anchor);
    const b = ids.indexOf(id);
    if (a !== -1 && b !== -1) {
      const [from, to] = a < b ? [a, b] : [b, a];
      for (let i = from; i <= to; i += 1) st.selected.add(ids[i]);
      st.anchor = id;
      paintAll();
      renderBar();
      return;
    }
  }
  if (st.selected.has(id)) st.selected.delete(id);
  else st.selected.add(id);
  st.anchor = id;
  if (st.selected.size === 0) {
    exitMode();
    return;
  }
  paintAll();
  renderBar();
}

/* ------------------------------------------------------------
   الربط مع chat-ui.js
   يُستدعى لكل صف رسالة: ChatSelect.attach(rowEl, message)
   ------------------------------------------------------------ */
function makeCheck() {
  return h('span', {
    class: 'cs-sel-check',
    role: 'checkbox',
    'aria-checked': 'false',
    'aria-label': 'تحديد الرسالة',
  });
}

/** يجعل الصف قابلاً للتحديد. الرسائل غير المرسلة بعد (قيد الإرسال أو الفاشلة) لا تُحدَّد. */
function attach(row, message) {
  if (!row || !message?.id) return;
  if (message.state !== MESSAGE_STATE.SENT) {
    delete row.dataset.selId;
    row.querySelector(':scope > .cs-sel-check')?.remove();
    return;
  }
  row.dataset.selId = message.id;
  st.messages.set(message.id, message);
  if (!row.querySelector(':scope > .cs-sel-check')) row.prepend(makeCheck());
  paintRow(row);
}

/* ------------------------------------------------------------
   تنسيق النص للنسخ والحفظ
   ------------------------------------------------------------ */
function lineFor(m) {
  const who = m.mine ? 'أنا' : (st.chatTitle || 'الطرف الآخر');
  const when = m.createdAt ? DATE_FMT.format(new Date(m.createdAt)) : '';
  const parts = [];
  if (m.forwardedFrom?.name) parts.push(`(مُعاد توجيهها من ${m.forwardedFrom.name})`);
  const text = String(m.text || '').trim();
  if (text) parts.push(text);
  if (m.attachment) {
    const label = ATTACH_LABEL[m.attachment.kind] || ATTACH_LABEL.file;
    parts.push(`[${label}: ${m.attachment.name || 'ملف'}] ${m.attachment.url || ''}`.trim());
  }
  if (!parts.length) parts.push('(رسالة فارغة)');
  return `[${when}] ${who}\n${parts.join('\n')}`;
}

function exportFileName() {
  const title = String(st.chatTitle || 'محادثة')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .slice(0, 40) || 'محادثة';
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `ClearNote-${title}-${stamp}.txt`;
}

/* ------------------------------------------------------------
   نافذة عامة
   ------------------------------------------------------------ */
function openOverlay(label, children) {
  ensureStyles();
  const overlay = h(
    'div',
    { class: 'cs-sel-overlay', role: 'presentation' },
    h(
      'div',
      { class: 'cs-sel-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': label },
      children,
    ),
  );
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 180);
  };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  return { overlay, close };
}

/* ------------------------------------------------------------
   الإجراءات
   ------------------------------------------------------------ */
async function copySelected() {
  const msgs = selectedMessages();
  if (!msgs.length || st.busy) return;
  const ok = await copyText(msgs.map(lineFor).join('\n\n'));
  if (ok) {
    notify('تم نسخ الرسائل', 'success');
    exitMode();
  } else {
    notify('تعذّر النسخ، حاول مرة أخرى', 'danger');
  }
}

function saveSelected() {
  const msgs = selectedMessages();
  if (!msgs.length || st.busy) return;
  const header = [
    `ClearNote — محادثة مع ${st.chatTitle || 'مستخدم'}`,
    `تاريخ التصدير: ${DATE_FMT.format(new Date())}`,
    `عدد الرسائل: ${msgs.length}`,
    '─'.repeat(30),
    '',
    '',
  ].join('\n');
  const body = msgs.map(lineFor).join('\n\n');
  // BOM في البداية يجعل برامج Windows (مثل المفكرة) تعرض العربية بشكل صحيح
  const blob = new Blob(['\ufeff', header, body, '\n'], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: exportFileName() });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  notify('تم تنزيل ملف النص', 'success');
  exitMode();
}

function openForward() {
  const msgs = selectedMessages();
  const srcId = st.chatId;
  if (!msgs.length || !srcId || st.busy) return;
  const max = CHAT_LIMITS.MAX_FORWARD_TARGETS;
  const chosen = new Set();
  const candidates = st.views.filter(
    (v) => v && v.id && !v.blocked && !v.isRequestIncoming && !(v.isRequestOutgoing && v.requestSent),
  );

  const search = h('input', {
    class: 'cs-sel-input',
    type: 'search',
    placeholder: 'ابحث عن محادثة',
    autocomplete: 'off',
    'aria-label': 'بحث عن محادثة',
  });
  const list = h('div', { class: 'cs-sel-list', role: 'listbox', 'aria-multiselectable': 'true' });
  const hint = h('p', { class: 'cs-sel-hint' });
  const sendBtn = h('button', { type: 'button', class: 'cs-sel-dbtn primary', text: 'توجيه', disabled: true });
  const cancelBtn = h('button', { type: 'button', class: 'cs-sel-dbtn', text: 'إلغاء' });
  let close = () => {};

  const updateFoot = () => {
    const n = chosen.size;
    hint.textContent = n ? `محدد: ${n} من ${max}` : `اختر محادثة أو أكثر (حتى ${max})`;
    sendBtn.disabled = n === 0 || st.busy;
  };

  const makeItem = (v) => {
    const avatar = h('span', { class: 'cs-sel-avatar', 'aria-hidden': 'true' });
    setAvatar(avatar, v.title, v.photo);
    const item = h(
      'button',
      {
        type: 'button',
        class: 'cs-sel-item',
        role: 'option',
        'aria-checked': String(chosen.has(v.id)),
        on: {
          click: () => {
            if (chosen.has(v.id)) {
              chosen.delete(v.id);
            } else if (chosen.size >= max) {
              notify(`لا يمكن التوجيه إلى أكثر من ${max} محادثات`, 'info');
              return;
            } else {
              chosen.add(v.id);
            }
            item.setAttribute('aria-checked', String(chosen.has(v.id)));
            updateFoot();
          },
        },
      },
      avatar,
      h(
        'span',
        { class: 'cs-sel-item-main' },
        h('strong', { text: v.title || 'مستخدم' }),
        h('small', { text: v.username || '' }),
      ),
      h('span', { class: 'cs-sel-tick', 'aria-hidden': 'true' }),
    );
    return item;
  };

  const renderList = () => {
    const q = search.value.trim().toLowerCase();
    const shown = candidates.filter(
      (v) => !q
        || String(v.title || '').toLowerCase().includes(q)
        || String(v.username || '').toLowerCase().includes(q),
    );
    list.replaceChildren(
      ...(shown.length
        ? shown.map(makeItem)
        : [h('p', {
          class: 'cs-sel-empty',
          text: candidates.length ? 'لا توجد نتائج' : 'لا توجد محادثات متاحة للتوجيه',
        })]),
    );
  };

  search.addEventListener('input', renderList);
  cancelBtn.addEventListener('click', () => close());
  sendBtn.addEventListener('click', async () => {
    const targets = [...chosen];
    if (!targets.length || st.busy) return;
    close();
    st.busy = true;
    renderBar();
    try {
      // كل رسالة تُوجَّه بالترتيب الزمني إلى كل المحادثات المختارة
      for (const m of msgs) {
        await ChatCore.forwardMessage(srcId, m.id, targets);
      }
    } catch (_) {
      notify('تعذّر إكمال إعادة التوجيه', 'danger');
    } finally {
      st.busy = false;
      if (st.chatId === srcId) exitMode();
      else renderBar();
    }
  });

  const dlg = openOverlay('توجيه الرسائل', [
    h('h3', { text: `توجيه ${countLabel(msgs.length)}` }),
    search,
    list,
    hint,
    h('div', { class: 'cs-sel-foot' }, cancelBtn, sendBtn),
  ]);
  close = dlg.close;
  renderList();
  updateFoot();
  if (!(typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches)) {
    search.focus();
  }
}

function openDelete() {
  const msgs = selectedMessages();
  const chatId = st.chatId;
  if (!msgs.length || !chatId || st.busy) return;
  const allMine = msgs.every((m) => m.mine);
  let close = () => {};

  const run = async (forEveryone) => {
    close();
    st.busy = true;
    renderBar();
    try {
      const results = await Promise.all(
        msgs.map((m) => (forEveryone
          ? ChatCore.deleteForEveryone(chatId, m.id)
          : ChatCore.deleteForMe(chatId, m.id))),
      );
      const ok = results.filter(Boolean).length;
      notify(
        ok === msgs.length ? 'تم حذف الرسائل' : `تم حذف ${ok} من ${msgs.length} رسالة`,
        ok ? 'success' : 'danger',
      );
    } catch (_) {
      notify('تعذّر الحذف، حاول مرة أخرى', 'danger');
    } finally {
      st.busy = false;
      if (st.chatId === chatId) exitMode();
      else renderBar();
    }
  };

  const note = allMine
    ? 'الحذف للجميع يزيل الرسائل من عند الطرف الآخر أيضاً، ولا يمكن التراجع عنه.'
    : 'بعض الرسائل ليست لك، لذلك لا يمكن حذفها للجميع. الحذف "لي فقط" يخفيها عندك أنت فقط.';

  const cancelBtn = h('button', { type: 'button', class: 'cs-sel-dbtn', text: 'إلغاء', on: { click: () => close() } });
  const forMeBtn = h('button', { type: 'button', class: 'cs-sel-dbtn danger', text: 'حذف لي فقط', on: { click: () => run(false) } });
  const forAllBtn = h('button', {
    type: 'button',
    class: 'cs-sel-dbtn danger',
    text: 'حذف للجميع',
    disabled: !allMine,
    on: { click: () => run(true) },
  });

  const dlg = openOverlay('حذف الرسائل', [
    h('h3', { text: 'حذف الرسائل المحددة' }),
    h('p', { text: `${countLabel(msgs.length)}.` }),
    h('p', { text: note }),
    h('div', { class: 'cs-sel-foot' }, cancelBtn, forMeBtn, forAllBtn),
  ]);
  close = dlg.close;
}

function onAction(key) {
  if (st.busy) return;
  if (key === 'forward') openForward();
  else if (key === 'copy') copySelected();
  else if (key === 'save') saveSelected();
  else if (key === 'delete') openDelete();
}

/* ------------------------------------------------------------
   معالجة الأحداث (التقاط في مرحلة الالتقاط لتسبق واجهة الصفحة)
   ------------------------------------------------------------ */
function rowOf(target) {
  return target instanceof Element ? target.closest(ROW_SEL) : null;
}

function onClick(e) {
  const row = rowOf(e.target);
  if (!row) return;
  if (st.ignoreClick) {
    st.ignoreClick = false;
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const onCheck = !!e.target.closest?.('.cs-sel-check');
  const startsMode = onCheck || e.ctrlKey || e.metaKey;
  if (!st.active && !startsMode) return;
  e.preventDefault();
  e.stopPropagation();
  if (!row.dataset.selId) return;
  if (!st.active) enterMode();
  applyToggle(row, e.shiftKey);
}

function cancelPress() {
  clearTimeout(st.pressTimer);
  st.pressTimer = null;
  st.pressStart = null;
}

function onPointerDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const row = rowOf(e.target);
  if (!row || !row.dataset.selId || e.target.closest?.('.cs-sel-check')) return;
  cancelPress();
  st.pressStart = { x: e.clientX, y: e.clientY };
  st.pressTimer = setTimeout(() => {
    st.pressTimer = null;
    if (!row.isConnected || !row.dataset.selId) return;
    if (!st.active) enterMode();
    st.ignoreClick = true;
    clearTimeout(st.ignoreTimer);
    st.ignoreTimer = setTimeout(() => { st.ignoreClick = false; }, 600);
    applyToggle(row);
    navigator.vibrate?.(12);
  }, LONG_PRESS_MS);
}

function onPointerMove(e) {
  if (!st.pressTimer || !st.pressStart) return;
  const dx = e.clientX - st.pressStart.x;
  const dy = e.clientY - st.pressStart.y;
  if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) cancelPress();
}

function onKey(e) {
  if (!st.active) return;
  if (document.querySelector('.cs-sel-overlay, .cs-media-overlay, .cs-lightbox')) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    exitMode();
    return;
  }
  if (isTyping(e.target)) return;
  if (e.key === 'Delete') {
    e.preventDefault();
    openDelete();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'c') {
    e.preventDefault();
    copySelected();
  }
}

/* ------------------------------------------------------------
   الاشتراك في أحداث المحادثة
   ------------------------------------------------------------ */
ChatCore.on('chat:active', (p) => {
  const id = p?.chat?.id || null;
  st.chatTitle = p?.chat?.title || '';
  if (id === st.chatId) return;
  st.chatId = id;
  st.messages = new Map();
  st.anchor = null;
  if (st.active) exitMode();
  else st.selected.clear();
});

ChatCore.on('messages', (p) => {
  if (!p || !st.chatId || p.chatId !== st.chatId) return;
  st.messages = new Map((p.messages || []).map((m) => [m.id, m]));
  // إسقاط الرسائل التي حُذفت أو أُخفيت أو لم تعد قابلة للتحديد
  for (const id of [...st.selected]) {
    const m = st.messages.get(id);
    if (!m || m.state !== MESSAGE_STATE.SENT) st.selected.delete(id);
  }
  if (st.active && st.selected.size === 0) {
    exitMode();
    return;
  }
  paintAll();
  renderBar();
});

ChatCore.on('chats', (views) => {
  st.views = Array.isArray(views) ? views : [];
});

/* ------------------------------------------------------------
   التشغيل
   ------------------------------------------------------------ */
function init() {
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  document.addEventListener('pointerup', cancelPress, true);
  document.addEventListener('pointercancel', cancelPress, true);
  document.addEventListener('scroll', cancelPress, { capture: true, passive: true });
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
}

init();

export const ChatSelect = Object.freeze({
  attach,
  isActive: () => st.active,
  exit: exitMode,
  selectedCount: () => st.selected.size,
});
