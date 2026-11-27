/* ============================================================
   js/chat-settings.js — الجزء 1/3
   يحتوي: الاستيرادات، الثوابت، الحالة، أدوات DOM، التنسيق،
   حالة المحادثة، المظهر (فاتح/داكن/تلقائي) مع المزامنة بين
   التبويبات، التنبيهات الداخلية بلا تكرار، نافذة التأكيد،
   وغلاف موحّد لاستدعاء إجراءات ChatCore.
   الجزء 2/3: أدوات التحكم، بناء اللوحة، والتحديث الفوري.
   الجزء 3/3: الإجراءات، نافذة الإبلاغ، الفتح والإغلاق،
   الربط بـ ChatCore، والتصدير (ChatSettings).
   ============================================================ */

import { ChatCore } from './chat-core.js';
import { ChatSound } from './chat-sound.js';
import {
  addDoc,
  collection,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ---------- الثوابت ----------

const THEME_KEY = 'clearnote.chat.theme.v1';
const THEMES = Object.freeze(['system', 'light', 'dark']);
const THEME_LABELS = Object.freeze({
  system: 'تلقائي (حسب الجهاز)',
  light: 'فاتح',
  dark: 'داكن',
});

/** خيارات الكتم لهذه المحادثة. ms مدة الكتم بالمللي ثانية، وتُحسب عند التطبيق. */
const MUTE_OPTIONS = Object.freeze([
  Object.freeze({ id: 'off', label: 'مفعّلة' }),
  Object.freeze({ id: '1h', label: 'ساعة', ms: 60 * 60 * 1000 }),
  Object.freeze({ id: '8h', label: '8 ساعات', ms: 8 * 60 * 60 * 1000 }),
  Object.freeze({ id: '1w', label: 'أسبوع', ms: 7 * 24 * 60 * 60 * 1000 }),
  Object.freeze({ id: 'forever', label: 'دائماً' }),
]);

const REPORT_REASONS = Object.freeze([
  Object.freeze({ id: 'spam', label: 'رسائل مزعجة أو احتيال' }),
  Object.freeze({ id: 'harassment', label: 'تحرش أو إساءة' }),
  Object.freeze({ id: 'fake', label: 'حساب مزيف أو منتحل' }),
  Object.freeze({ id: 'other', label: 'سبب آخر' }),
]);

/** أسماء مجموعات المؤثرات بالعربية، ومؤثر المعاينة المقابل لكل مجموعة. */
const GROUP_LABELS = Object.freeze({
  send: 'إرسال الرسائل',
  receive: 'استقبال الرسائل',
  notify: 'تنبيهات الإشعارات',
  reaction: 'التفاعلات',
  record: 'التسجيل الصوتي',
  delete: 'الحذف',
  error: 'الأخطاء',
});

const GROUP_PREVIEW = Object.freeze({
  send: 'send',
  receive: 'receive',
  notify: 'notify',
  reaction: 'reaction',
  record: 'recordStart',
  delete: 'delete',
  error: 'error',
});

const DETAILS_MAX = 500;
const TITLE_MAX = 80;
const TOAST_MS = 2600;

const DATE_FMT = new Intl.DateTimeFormat('ar', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

// ---------- الحالة ----------

const S = {
  db: null,              // قاعدة البيانات، تُمرَّر من init لكتابة البلاغات
  auth: null,
  uid: null,             // معرّف المستخدم الحالي
  open: false,           // هل اللوحة مفتوحة
  chatId: null,          // المحادثة المعروضة
  view: null,            // أحدث لقطة من ChatView للمحادثة المعروضة
  refs: null,            // مراجع عناصر تُحدَّث دون إعادة بناء اللوحة
  root: null,            // عنصر الغلاف الخارجي للوحة
  lastFocus: null,       // العنصر الذي كان مركّزاً قبل فتح اللوحة
  dialogOpen: false,     // هل توجد نافذة تأكيد أو إبلاغ مفتوحة
  busy: false,           // يمنع تنفيذ إجراءين معاً
  bound: false,          // هل رُبطت أحداث ChatCore
  coreOffs: [],          // دوال إلغاء الاشتراك في أحداث ChatCore
  themeMql: null,        // مراقب وضع الجهاز (فاتح/داكن)
  onThemeChange: null,   // مستمع تغيّر وضع الجهاز
  toastTimer: 0,
  onOpenProfile: null,
  onAfterRemove: null,
  unsubSound: null,
};

let uidSeq = 0;

// ---------- أدوات DOM ----------

/** إنشاء عنصر DOM بخصائص وأبناء، دون innerHTML. */
function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (val == null || val === false) continue;
    if (key === 'class') node.className = String(val);
    else if (key === 'text') node.textContent = String(val);
    else if (key === 'value') node.value = String(val);
    else if (key === 'checked') node.checked = true;
    else if (key.startsWith('on') && typeof val === 'function') {
      node.addEventListener(key.slice(2), val);
    } else node.setAttribute(key, val === true ? '' : String(val));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

// ---------- التنسيق والتحويل ----------

function toMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return 0;
}

function fmtDateTime(ms) {
  return ms > 0 ? DATE_FMT.format(new Date(ms)) : '';
}

function hourLabel(h) {
  return `${String(h).padStart(2, '0')}:00`;
}

function initialOf(name) {
  const s = String(name || '').trim();
  return s ? [...s][0].toUpperCase() : '?';
}

function hueOf(str) {
  let h = 0;
  for (const ch of String(str || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

/** لا تُعرض إلا الصور من HTTPS، وبحد معقول للطول. */
function safePhoto(url) {
  return typeof url === 'string' && url.length <= 500 && /^https:\/\//.test(url) ? url : null;
}

function avatarNode(name, photo, cls = 'cs-set-avatar') {
  const url = safePhoto(photo);
  if (url) {
    return el('img', {
      class: cls,
      src: url,
      alt: '',
      decoding: 'async',
      referrerpolicy: 'no-referrer',
    });
  }
  return el('span', {
    class: `${cls} is-initial`,
    'aria-hidden': 'true',
    style: `--cs-hue:${hueOf(name)}`,
    text: initialOf(name),
  });
}

// ---------- حالة المحادثة ----------

function displayName(view) {
  return String(view?.title || view?.username || 'مستخدم').slice(0, TITLE_MAX);
}

function handleOf(view) {
  return view?.username ? `@${view.username}` : '';
}

function isDirectView(view) {
  return !!view?.otherUid;
}

function isMutedView(view, now = Date.now()) {
  if (!view) return false;
  if (view.mutedForever) return true;
  const until = toMs(view.mutedUntil);
  if (until) return until > now;
  return view.muted === true;
}

/** الحالة الحالية للكتم: 'off' (مفعّلة) أو 'forever' (دائماً) أو 'timed' (مؤقتة). */
function currentMuteOption(view, now = Date.now()) {
  if (!isMutedView(view, now)) return 'off';
  if (view.mutedForever) return 'forever';
  return toMs(view.mutedUntil) ? 'timed' : 'forever';
}

function muteStateText(view) {
  if (!isMutedView(view)) return 'الإشعارات مفعّلة';
  const until = toMs(view.mutedUntil);
  if (view.mutedForever || !until) return 'مكتومة دائماً';
  return `مكتومة حتى ${fmtDateTime(until)}`;
}

/**
 * القيمة التي تُمرَّر إلى ChatCore.muteChat:
 * false لإلغاء الكتم، 'forever' للدائم، أو طابع مطلق بالمللي ثانية للمدة المحددة.
 * تُرجع null إذا كان الخيار غير معروف.
 */
function muteValueFor(optionId, now = Date.now()) {
  if (optionId === 'off') return false;
  if (optionId === 'forever') return 'forever';
  const opt = MUTE_OPTIONS.find((o) => o.id === optionId);
  return opt && opt.ms ? now + opt.ms : null;
}

function chatStatusText(view) {
  if (view.blockedByMe) return 'محظور من قبلك';
  if (view.blocked) return 'قام الطرف الآخر بحظرك';
  if (view.isRequestIncoming) return 'طلب محادثة وارد';
  if (view.isRequestOutgoing) return 'بانتظار موافقة الطرف الآخر';
  return isDirectView(view) ? 'محادثة فردية' : 'محادثة';
}

function currentUid() {
  return S.uid || S.auth?.currentUser?.uid || null;
}

// ---------- المظهر ----------

function readTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return THEMES.includes(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

function writeTheme(pref) {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    // التخزين معطّل (وضع خاص مثلاً)، والتفضيل يبقى لهذه الجلسة.
  }
}

function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(pref = readTheme()) {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(pref);
  root.dataset.themePref = pref;
}

function setTheme(pref) {
  if (!THEMES.includes(pref)) return;
  writeTheme(pref);
  applyTheme(pref);
}

/** إذا كان التفضيل "تلقائي" يتبع تغيّر وضع الجهاز أثناء الجلسة. */
function watchSystemTheme() {
  if (S.themeMql || !window.matchMedia) return;
  S.themeMql = window.matchMedia('(prefers-color-scheme: dark)');
  S.onThemeChange = () => {
    if (readTheme() === 'system') applyTheme('system');
  };
  S.themeMql.addEventListener?.('change', S.onThemeChange);
}

function unwatchSystemTheme() {
  if (!S.themeMql) return;
  S.themeMql.removeEventListener?.('change', S.onThemeChange);
  S.themeMql = null;
  S.onThemeChange = null;
}

// ---------- التنبيهات الداخلية ----------

let flashNode = null;

/**
 * تنبيه خفيف داخل الصفحة. نسخة واحدة تُعاد استخدامها.
 * إذا كان النص نفسه معروضاً الآن، يُمدَّد وقته فقط ولا يُعاد عرضه،
 * فلا تتكرر الرسالة عند النقرات المتتالية.
 */
function flash(text, tone = 'info') {
  const msg = String(text || '');
  if (!msg) return;
  if (!flashNode || !flashNode.isConnected) {
    flashNode = el('div', { class: 'cs-set-toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(flashNode);
  }
  const node = flashNode;
  const sameVisible = node.textContent === msg && node.classList.contains('is-in');
  clearTimeout(S.toastTimer);
  S.toastTimer = setTimeout(() => node.classList.remove('is-in'), TOAST_MS);
  if (sameVisible) return;
  node.classList.remove('is-info', 'is-success', 'is-danger', 'is-in');
  node.classList.add(`is-${tone}`);
  node.textContent = msg;
  requestAnimationFrame(() => node.classList.add('is-in'));
}

/** رسالة الخطأ المعروضة للمستخدم. الرسائل الإنجليزية الخام تُستبدل برسالة عربية عامة. */
function errorText(err) {
  const msg = typeof err?.message === 'string' ? err.message.trim() : '';
  if (msg && msg.length <= 160 && /[\u0600-\u06FF]/.test(msg)) return msg;
  return 'تعذّر تنفيذ الإجراء، حاول مرة أخرى';
}

// ---------- نافذة التأكيد ----------

/**
 * نافذة تأكيد داخلية. تُرجع Promise<boolean>.
 * Escape أو النقر خارجها يعني الإلغاء. Tab يتنقل بين الزرين فقط.
 */
function confirmAction({ title, body, confirmText = 'تأكيد', cancelText = 'إلغاء', danger = false }) {
  if (S.dialogOpen) return Promise.resolve(false);
  S.dialogOpen = true;
  const prev = document.activeElement;
  const id = ++uidSeq;
  return new Promise((resolve) => {
    let settled = false;
    const cancelBtn = el('button', { type: 'button', class: 'cs-set-btn ghost', text: cancelText });
    const okBtn = el('button', {
      type: 'button',
      class: danger ? 'cs-set-btn danger' : 'cs-set-btn primary',
      text: confirmText,
    });
    const overlay = el(
      'div',
      { class: 'cs-set-overlay is-top' },
      el(
        'div',
        {
          class: 'cs-set-confirm',
          role: 'alertdialog',
          'aria-modal': 'true',
          'aria-labelledby': `cs-set-ct-${id}`,
          'aria-describedby': `cs-set-cb-${id}`,
        },
        el('h3', { class: 'cs-set-confirm-title', id: `cs-set-ct-${id}`, text: title }),
        el('p', { class: 'cs-set-confirm-body', id: `cs-set-cb-${id}`, text: body }),
        el('div', { class: 'cs-set-confirm-foot' }, cancelBtn, okBtn),
      ),
    );

    const finish = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.classList.remove('is-open');
      setTimeout(() => overlay.remove(), 180);
      S.dialogOpen = false;
      if (prev instanceof HTMLElement && prev.isConnected) prev.focus();
      resolve(value);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        (document.activeElement === okBtn ? cancelBtn : okBtn).focus();
      }
    };

    cancelBtn.addEventListener('click', () => finish(false));
    okBtn.addEventListener('click', () => finish(true));
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) finish(false);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    cancelBtn.focus();
  });
}

// ---------- غلاف استدعاء ChatCore ----------

/** استدعاء إجراء من ChatCore مع التحقق من وجوده، فيُرمى خطأ عربي واضح إن غاب. */
function callCore(method, ...args) {
  if (typeof ChatCore[method] !== 'function') {
    throw new Error('هذا الإجراء غير متاح حالياً');
  }
  return ChatCore[method](...args);
}

/**
 * تنفيذ إجراء غير متزامن مع قفل ضد التكرار وتعطيل الزر أثناء التنفيذ.
 * ينجح الإجراء فتظهر رسالة النجاح مرة واحدة فقط، ويفشل فتظهر رسالة الخطأ.
 * يُرجع true عند النجاح، وfalse عند الفشل أو عند وجود إجراء جارٍ.
 */
async function guarded(btn, label, fn, { success } = {}) {
  if (S.busy) return false;
  S.busy = true;
  if (btn) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
  }
  try {
    await fn();
    if (success) flash(success, 'success');
    return true;
  } catch (err) {
    console.error(`[ChatSettings] ${label}`, err);
    flash(errorText(err), 'danger');
    return false;
  } finally {
    S.busy = false;
    if (btn?.isConnected) {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  }
}
/* ============================================================
   js/chat-settings.js — الجزء 2/3
   يحتوي: ثوابت العرض والحالة المساعدة، أدوات التحكم (مفاتيح،
   خيارات، صفوف، أزرار إجراءات)، معاينة الأصوات، بناء اللوحة
   بأقسامها، والتحديث الفوري syncAll دون إعادة بناء اللوحة.
   الجزء 1/3: الاستيرادات والثوابت والحالة وأدوات الحالة والمظهر.
   الجزء 3/3: الإجراءات، نافذة الإبلاغ، الفتح والإغلاق، الربط
   بـ ChatCore، والتصدير (ChatSettings).
   ============================================================ */

// ---------- ثوابت العرض والحالة المساعدة ----------

const PERM_TEXT = Object.freeze({
  granted: 'ممنوح، ستصلك الإشعارات عندما تكون الصفحة في الخلفية',
  denied: 'مرفوض من المتصفح، فعّله من إعدادات الموقع',
  default: 'لم يُمنح بعد',
  unsupported: 'غير مدعوم في هذا المتصفح',
});

const RADIO_KEYS = Object.freeze(['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']);

const FOCUS_SEL = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

let ready = false;
let storageBound = false;
let lastChats = [];        // آخر قائمة محادثات وصلت من ChatCore
let onSearchHook = null;   // يُستدعى من زر البحث داخل المحادثة

// ---------- أدوات الحالة والعرض ----------

function prefersReducedMotion() {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** مفتاح تشغيل/إيقاف: يحدّث aria-checked وصنف is-on. */
function setSwitch(btn, on) {
  if (!btn) return;
  btn.setAttribute('aria-checked', on ? 'true' : 'false');
  btn.classList.toggle('is-on', !!on);
}

/** زر تبديل (له حالة ضغط): يحدّث aria-pressed وصنف is-on. */
function setPressed(btn, on) {
  if (!btn) return;
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.classList.toggle('is-on', !!on);
}

/** زر إجراء يعرض حالة فعّالة بصنف is-on فقط (بدون aria-pressed). */
function setActive(btn, on) {
  if (!btn) return;
  btn.classList.toggle('is-on', !!on);
}

/**
 * مجموعة أزرار راديو بنمط roving tabindex.
 * items: Array<[id, btn]>. إن لم يوجد المحدد تكون أول خانة قابلة للتركيز.
 */
function syncRadios(items, selected) {
  const hasSelected = items.some(([id]) => id === selected);
  items.forEach(([id, btn], i) => {
    const on = id === selected;
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
    btn.classList.toggle('is-on', on);
    btn.tabIndex = (on || (!hasSelected && i === 0)) ? 0 : -1;
  });
}

/** التنقل بالأسهم داخل مجموعة الراديو. التفعيل يتم عبر click. */
function radioKeys(e) {
  if (!RADIO_KEYS.includes(e.key)) return;
  const items = [...e.currentTarget.querySelectorAll('[role="radio"]:not([disabled])')];
  const i = items.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  const dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
  const next = items[(i + dir + items.length) % items.length];
  next.focus();
  next.click();
}

/** حصر Tab داخل الحاوية. */
function trapTab(e, container) {
  if (!container) return;
  const items = [...container.querySelectorAll(FOCUS_SEL)].filter((n) => !n.closest('[hidden]'));
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const inside = container.contains(document.activeElement);
  if (e.shiftKey && (document.activeElement === first || !inside)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
    e.preventDefault();
    first.focus();
  }
}

/** بطاقة قسم داخل اللوحة بعنوان اختياري. */
function secCard(title, ...kids) {
  return el(
    'section',
    { class: 'cs-set-card' },
    title ? el('h3', { class: 'cs-set-sec-title', text: title }) : null,
    kids,
  );
}

/**
 * صف مفتاح تشغيل/إيقاف. يُرجع { row, set, btn }.
 * set(on) تحدّث الحالة بصرياً، وonChange(nextValue) تُستدعى عند النقر.
 */
function switchRow({ label, hint = '', on = false, extra = null, onChange }) {
  const btn = el(
    'button',
    { type: 'button', class: 'cs-set-switch', role: 'switch', 'aria-label': label },
    el('span', { class: 'cs-set-knob', 'aria-hidden': 'true' }),
  );
  const set = (v) => setSwitch(btn, v);
  set(on);
  btn.addEventListener('click', () => {
    if (!onChange) return;
    onChange(btn.getAttribute('aria-checked') !== 'true');
  });
  const row = el(
    'div',
    { class: 'cs-set-row' },
    el(
      'div',
      { class: 'cs-set-row-text' },
      el('span', { text: label }),
      hint ? el('small', { text: hint }) : null,
    ),
    extra,
    btn,
  );
  return { row, set, btn };
}

/**
 * زر إجراء سريع. toggle: true يضيف aria-pressed لأزرار التبديل فقط.
 */
function actionButton(icon, label, onClick, { toggle = false } = {}) {
  const attrs = { type: 'button', class: 'cs-set-action', onclick: onClick };
  if (toggle) attrs['aria-pressed'] = 'false';
  return el(
    'button',
    attrs,
    el('span', { class: 'cs-set-action-ic', 'aria-hidden': 'true', text: icon }),
    label,
  );
}

function muteOptionLabel(opt) {
  if (opt.id === 'off') return 'تفعيل الإشعارات';
  if (opt.id === 'forever') return 'كتم دائم';
  return `كتم لمدة ${opt.label}`;
}

function hourSelect(label, onPick) {
  const select = el(
    'select',
    { class: 'cs-set-select', 'aria-label': label },
    Array.from({ length: 24 }, (_, h) => el('option', { value: String(h), text: hourLabel(h) })),
  );
  select.addEventListener('change', () => onPick(Number(select.value)));
  return select;
}

function scrollToNotify() {
  S.refs?.notifySec?.scrollIntoView({
    block: 'start',
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
}

/** معاينة صوت من الإعدادات. تُفعّل الصوت أولاً لأن المتصفح يشترط تفاعلاً. */
async function previewSound(name) {
  const ok = await ChatSound.unlock();
  if (!ok) {
    flash('انقر مرة أخرى لتفعيل الصوت في هذا المتصفح', 'info');
    return;
  }
  ChatSound.preview(name);
}

function syncPermission() {
  const r = S.refs;
  if (!r) return;
  const perm = ChatSound.notificationPermission();
  r.permText.textContent = PERM_TEXT[perm] || PERM_TEXT.unsupported;
  r.permBtn.hidden = perm !== 'default';
}

// ---------- بناء اللوحة ----------

function buildPanel() {
  const titleId = `cs-set-title-${++uidSeq}`;
  const refs = {};

  refs.close = el('button', {
    type: 'button',
    class: 'cs-set-icon',
    'aria-label': 'إغلاق',
    onclick: () => closePanel(),
    text: '✕',
  });
  const head = el(
    'header',
    { class: 'cs-set-head' },
    el('h2', { class: 'cs-set-title', id: titleId, text: 'إعدادات المحادثة' }),
    refs.close,
  );

  // ----- الملف المختصر -----
  refs.avatarHost = el('div', { class: 'cs-set-avatar-host' });
  refs.name = el('strong', { class: 'cs-set-name' });
  refs.verified = el('span', {
    class: 'cs-set-verified',
    title: 'حساب موثّق',
    'aria-label': 'حساب موثّق',
    text: '✔',
  });
  refs.handle = el('span', { class: 'cs-set-handle' });
  refs.status = el('span', { class: 'cs-set-status' });
  refs.viewBtn = el('button', {
    type: 'button',
    class: 'cs-set-btn ghost sm',
    text: 'عرض الملف الشخصي',
    onclick: openProfile,
  });
  const profile = el(
    'section',
    { class: 'cs-set-card cs-set-profile', 'aria-label': 'الملف المختصر' },
    refs.avatarHost,
    el(
      'div',
      { class: 'cs-set-profile-text' },
      el('div', { class: 'cs-set-name-row' }, refs.name, refs.verified),
      refs.handle,
      refs.status,
    ),
    refs.viewBtn,
  );

  // ----- طلب المحادثة -----
  refs.acceptBtn = el('button', { type: 'button', class: 'cs-set-btn primary', text: 'قبول', onclick: onAccept });
  refs.declineBtn = el('button', { type: 'button', class: 'cs-set-btn danger', text: 'رفض', onclick: onDecline });
  refs.reqIn = el(
    'section',
    { class: 'cs-set-card cs-set-request', hidden: true },
    el('p', { class: 'cs-set-note', text: 'طلب محادثة وارد. وافق لتبدأ المراسلة، أو ارفض لإخفاء الطلب.' }),
    el('div', { class: 'cs-set-row-btns' }, refs.declineBtn, refs.acceptBtn),
  );
  refs.reqOut = el(
    'section',
    { class: 'cs-set-card', hidden: true },
    el('p', { class: 'cs-set-note', text: 'بانتظار موافقة الطرف الآخر على طلب المحادثة.' }),
  );

  // ----- إجراءات سريعة -----
  refs.pinLabel = el('span', { class: 'cs-set-action-txt', text: 'تثبيت' });
  refs.muteLabel = el('span', { class: 'cs-set-action-txt', text: 'الإشعارات' });
  refs.archLabel = el('span', { class: 'cs-set-action-txt', text: 'أرشفة' });
  refs.searchLabel = el('span', { class: 'cs-set-action-txt', text: 'بحث' });
  refs.pinBtn = actionButton('📌', refs.pinLabel, onTogglePin, { toggle: true });
  refs.muteBtn = actionButton('🔔', refs.muteLabel, scrollToNotify);
  refs.archBtn = actionButton('🗂', refs.archLabel, onToggleArchive, { toggle: true });
  refs.searchBtn = actionButton('🔍', refs.searchLabel, onSearchClick);
  const actions = el(
    'section',
    { class: 'cs-set-actions', role: 'group', 'aria-label': 'إجراءات سريعة' },
    refs.pinBtn,
    refs.muteBtn,
    refs.archBtn,
    refs.searchBtn,
  );

  // ----- إشعارات هذه المحادثة -----
  refs.muteState = el('p', { class: 'cs-set-note', 'aria-live': 'polite' });
  refs.muteRadios = MUTE_OPTIONS.map((opt) => [
    opt.id,
    el('button', {
      type: 'button',
      class: 'cs-set-option',
      role: 'radio',
      'aria-checked': 'false',
      text: muteOptionLabel(opt),
      onclick: () => onMute(opt.id),
    }),
  ]);
  const muteGroup = el(
    'div',
    {
      class: 'cs-set-options',
      role: 'radiogroup',
      'aria-label': 'كتم إشعارات هذه المحادثة',
      onkeydown: radioKeys,
    },
    refs.muteRadios.map(([, b]) => b),
  );
  refs.notifySec = secCard('إشعارات هذه المحادثة', refs.muteState, muteGroup);

  // ----- الصوت والإشعارات العامة -----
  const sw = {};
  refs.sw = sw;

  sw.enabled = switchRow({
    label: 'تشغيل المؤثرات الصوتية',
    hint: 'أصوات الإرسال والاستقبال والتنبيهات',
    onChange: (v) => ChatSound.updateSettings({ enabled: v }),
  });

  refs.volume = el('input', {
    type: 'range',
    class: 'cs-set-range',
    min: '0',
    max: '100',
    step: '1',
    'aria-label': 'مستوى الصوت',
  });
  refs.volumeOut = el('output', { class: 'cs-set-range-out', text: '70%' });
  refs.volume.addEventListener('input', () => {
    ChatSound.updateSettings({ volume: Number(refs.volume.value) });
  });
  refs.volume.addEventListener('change', () => {
    if (Number(refs.volume.value) > 0) previewSound('notify');
  });
  const volumeRow = el(
    'div',
    { class: 'cs-set-row cs-set-row-col' },
    el('div', { class: 'cs-set-row-text' }, el('span', { text: 'مستوى الصوت' })),
    el('div', { class: 'cs-set-range-wrap' }, refs.volume, refs.volumeOut),
  );

  sw.notify = switchRow({
    label: 'إشعارات النظام',
    hint: 'تظهر عند وصول رسالة والصفحة في الخلفية',
    onChange: onToggleNotify,
  });
  refs.permText = el('small', { class: 'cs-set-perm' });
  refs.permBtn = el('button', {
    type: 'button',
    class: 'cs-set-btn ghost sm',
    text: 'طلب الإذن',
    onclick: onRequestPermission,
  });
  const permRow = el('div', { class: 'cs-set-perm-row' }, refs.permText, refs.permBtn);

  sw.preview = switchRow({
    label: 'عرض نص الرسالة في الإشعار',
    hint: 'عند إيقافه يظهر نص عام بدل نص الرسالة',
    onChange: (v) => ChatSound.updateSettings({ showPreview: v }),
  });
  sw.vibrate = switchRow({
    label: 'الاهتزاز',
    hint: 'يعمل على الهواتف التي تدعمه',
    onChange: (v) => ChatSound.updateSettings({ vibrate: v }),
  });
  sw.title = switchRow({
    label: 'عداد غير المقروء في عنوان الصفحة',
    onChange: (v) => ChatSound.updateSettings({ titleBadge: v }),
  });
  sw.quiet = switchRow({
    label: 'ساعات الهدوء',
    hint: 'إيقاف الأصوات والإشعارات خلال وقت محدد',
    onChange: (v) => ChatSound.updateSettings({ quietEnabled: v }),
  });
  refs.quietFrom = hourSelect('بداية ساعات الهدوء', (h) => ChatSound.updateSettings({ quietFrom: h }));
  refs.quietTo = hourSelect('نهاية ساعات الهدوء', (h) => ChatSound.updateSettings({ quietTo: h }));
  refs.quietNow = el('small', { class: 'cs-set-perm' });
  refs.quietFields = el(
    'div',
    { class: 'cs-set-quiet', hidden: true },
    el('label', { class: 'cs-set-field' }, el('span', { text: 'من' }), refs.quietFrom),
    el('label', { class: 'cs-set-field' }, el('span', { text: 'إلى' }), refs.quietTo),
    refs.quietNow,
  );

  refs.soundSec = secCard(
    'الصوت والإشعارات',
    sw.enabled.row,
    volumeRow,
    sw.notify.row,
    permRow,
    sw.preview.row,
    sw.vibrate.row,
    sw.title.row,
    sw.quiet.row,
    refs.quietFields,
  );

  // ----- المؤثرات حسب النوع -----
  refs.evSet = new Map();
  const evRows = ChatSound.groups.map((g) => {
    const label = GROUP_LABELS[g] || g;
    const previewBtn = el('button', {
      type: 'button',
      class: 'cs-set-icon sm',
      'aria-label': `معاينة صوت ${label}`,
      title: 'معاينة الصوت',
      text: '▶',
      onclick: () => previewSound(GROUP_PREVIEW[g]),
    });
    const row = switchRow({
      label,
      on: true,
      extra: previewBtn,
      onChange: (v) => ChatSound.updateSettings({ events: { [g]: v } }),
    });
    refs.evSet.set(g, row.set);
    return row.row;
  });
  refs.eventsSec = secCard('المؤثرات حسب النوع', ...evRows);

  // ----- المظهر -----
  refs.themeRadios = THEMES.map((t) => [
    t,
    el('button', {
      type: 'button',
      class: 'cs-set-option',
      role: 'radio',
      'aria-checked': 'false',
      text: THEME_LABELS[t],
      onclick: () => {
        setTheme(t);
        syncAll();
      },
    }),
  ]);
  const themeGroup = el(
    'div',
    { class: 'cs-set-options', role: 'radiogroup', 'aria-label': 'المظهر', onkeydown: radioKeys },
    refs.themeRadios.map(([, b]) => b),
  );
  refs.themeSec = secCard('المظهر', themeGroup);

  // ----- الخصوصية والأمان -----
  refs.blockBtn = el('button', { type: 'button', class: 'cs-set-btn danger wide', onclick: onBlockToggle });
  refs.reportBtn = el('button', {
    type: 'button',
    class: 'cs-set-btn ghost wide',
    text: 'الإبلاغ عن المحادثة',
    onclick: () => openReportDialog(S.view),
  });
  refs.privacySec = secCard('الخصوصية والأمان', refs.blockBtn, refs.reportBtn);

  // ----- البيانات -----
  refs.clearBtn = el('button', {
    type: 'button',
    class: 'cs-set-btn ghost wide',
    text: 'مسح السجل من عندي',
    onclick: onClearHistory,
  });
  refs.deleteBtn = el('button', {
    type: 'button',
    class: 'cs-set-btn danger wide',
    text: 'حذف المحادثة من عندي',
    onclick: onDeleteChat,
  });
  refs.dataSec = secCard(
    'البيانات',
    el('p', {
      class: 'cs-set-note',
      text: 'هذه الإجراءات تؤثر على حسابك فقط، ولا تحذف شيئاً عند الطرف الآخر.',
    }),
    refs.clearBtn,
    refs.deleteBtn,
  );

  const body = el(
    'div',
    { class: 'cs-set-body' },
    profile,
    refs.reqIn,
    refs.reqOut,
    actions,
    refs.notifySec,
    refs.soundSec,
    refs.eventsSec,
    refs.themeSec,
    refs.privacySec,
    refs.dataSec,
  );

  const panel = el(
    'div',
    { class: 'cs-set-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    head,
    body,
  );
  const overlay = el('div', { class: 'cs-set-overlay' }, panel);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closePanel();
  });

  return { overlay, panel, refs };
}

// ---------- التحديث الفوري ----------

/** يُحدّث كل عناصر اللوحة من الحالة الحالية، دون إعادة بنائها. */
function syncAll() {
  const r = S.refs;
  const v = S.view;
  if (!S.open || !r || !v) return;

  // الملف المختصر
  const name = displayName(v);
  r.avatarHost.replaceChildren(avatarNode(name, v.photo));
  r.name.textContent = name;
  r.verified.hidden = !v.verified;
  r.handle.textContent = handleOf(v);
  r.handle.hidden = !handleOf(v);
  r.status.textContent = chatStatusText(v);
  r.viewBtn.hidden = !isDirectView(v);

  // الطلبات
  r.reqIn.hidden = !v.isRequestIncoming;
  r.reqOut.hidden = !v.isRequestOutgoing;

  // الإجراءات السريعة
  const muted = isMutedView(v);
  setPressed(r.pinBtn, !!v.pinned);
  r.pinLabel.textContent = v.pinned ? 'إلغاء التثبيت' : 'تثبيت';
  setPressed(r.archBtn, !!v.archived);
  r.archLabel.textContent = v.archived ? 'إلغاء الأرشفة' : 'أرشفة';
  setActive(r.muteBtn, muted);
  r.muteLabel.textContent = muted ? 'مكتومة' : 'الإشعارات';

  // كتم المحادثة
  r.muteState.textContent = muteStateText(v);
  const muteKind = currentMuteOption(v);
  syncRadios(r.muteRadios, muteKind === 'timed' ? null : muteKind);

  // الصوت والإشعارات العامة
  const st = ChatSound.getSettings();
  r.sw.enabled.set(st.enabled);
  r.volume.value = String(st.volume);
  r.volumeOut.textContent = `${st.volume}%`;
  r.sw.notify.set(st.notifyEnabled);
  syncPermission();
  r.sw.preview.set(st.showPreview);
  r.sw.vibrate.set(st.vibrate);
  r.sw.title.set(st.titleBadge);
  r.sw.quiet.set(st.quietEnabled);
  r.quietFields.hidden = !st.quietEnabled;
  r.quietFrom.value = String(st.quietFrom);
  r.quietTo.value = String(st.quietTo);
  r.quietNow.textContent = !st.quietEnabled
    ? 'ساعات الهدوء متوقفة'
    : (ChatSound.isQuietNow() ? 'نشطة الآن' : 'غير نشطة الآن');

  // المؤثرات حسب النوع
  for (const g of ChatSound.groups) {
    r.evSet.get(g)?.(st.events?.[g] !== false);
  }

  // المظهر
  syncRadios(r.themeRadios, readTheme());

  // الخصوصية
  r.blockBtn.hidden = !isDirectView(v);
  r.blockBtn.textContent = v.blockedByMe ? 'إلغاء الحظر' : 'حظر المستخدم';
  r.blockBtn.className = v.blockedByMe ? 'cs-set-btn ghost wide' : 'cs-set-btn danger wide';
}
/* ============================================================
   js/chat-settings.js — الجزء 3/3
   يحتوي: الإجراءات (تثبيت، أرشفة، كتم، طلبات، حظر، مسح، حذف)،
   نافذة الإبلاغ، الفتح والإغلاق، الاختصارات، الربط بأحداث
   ChatCore، التهيئة والإنهاء، والتصدير (ChatSettings).
   الجزء 1/3: الاستيرادات والثوابت والحالة وأدوات الحالة والمظهر.
   الجزء 2/3: أدوات التحكم، بناء اللوحة، والتحديث الفوري.
   ============================================================ */

// ---------- الإجراءات ----------

/** يمنع تنفيذ إجراء آخر أثناء إجراء جارٍ، ويُبلغ المستخدم بدل التجاهل الصامت. */
function busyGuard() {
  if (!S.busy) return false;
  flash('انتظر لحظة، الإجراء السابق ما زال جارياً', 'info');
  return true;
}

function muteSuccessText(optId) {
  if (optId === 'off') return 'تم تفعيل إشعارات المحادثة';
  if (optId === 'forever') return 'تم كتم المحادثة دائماً';
  const opt = MUTE_OPTIONS.find((o) => o.id === optId);
  return opt ? `تم كتم المحادثة لمدة ${opt.label}` : 'تم تحديث إعدادات الكتم';
}

async function onTogglePin() {
  const v = S.view;
  if (!v || busyGuard()) return;
  const id = v.id;
  const next = !v.pinned;
  await guarded(
    S.refs?.pinBtn,
    'pin',
    () => callCore('pinChat', id, next),
    { success: next ? 'تم تثبيت المحادثة' : 'أُلغي تثبيت المحادثة' },
  );
}

/** الأرشفة تُفعَّل بـ archiveChat، وإلغاؤها بـ unarchiveChat. */
async function onToggleArchive() {
  const v = S.view;
  if (!v || busyGuard()) return;
  const id = v.id;
  const wasArchived = !!v.archived;
  await guarded(
    S.refs?.archBtn,
    'archive',
    () => (wasArchived ? callCore('unarchiveChat', id) : callCore('archiveChat', id, true)),
    { success: wasArchived ? 'أُعيدت المحادثة إلى القائمة' : 'تمت أرشفة المحادثة' },
  );
}

/** الكتم يُمرَّر لـ muteChat بصيغته الـ async. الخيار 'off' يلغي الكتم. */
async function onMute(optId) {
  const v = S.view;
  if (!v || busyGuard()) return;
  const value = muteValueFor(optId);
  if (value === null) return;
  const id = v.id;
  await guarded(
    null,
    'mute',
    () => callCore('muteChat', id, value),
    { success: muteSuccessText(optId) },
  );
}

function onSearchClick() {
  const id = S.chatId;
  if (!id) return;
  closePanel(false);
  onSearchHook?.(id);
}

function openProfile() {
  const target = S.view?.otherUid;
  if (!target) return;
  closePanel(false);
  S.onOpenProfile?.(target);
}

async function onAccept() {
  const id = S.chatId;
  if (!id || busyGuard()) return;
  await guarded(
    S.refs?.acceptBtn,
    'accept',
    () => callCore('acceptRequest', id),
    { success: 'تم قبول الطلب' },
  );
}

async function onDecline() {
  const id = S.chatId;
  if (!id || busyGuard()) return;
  const ok = await confirmAction({
    title: 'رفض طلب المحادثة؟',
    body: 'سيُخفى الطلب من قائمتك.',
    confirmText: 'رفض',
    danger: true,
  });
  if (!ok || S.chatId !== id) return;
  const done = await guarded(
    S.refs?.declineBtn,
    'decline',
    () => callCore('declineRequest', id),
    { success: 'تم رفض الطلب' },
  );
  if (done) {
    closePanel(false);
    S.onAfterRemove?.(id, 'declined');
  }
}

async function onBlockToggle() {
  const v = S.view;
  if (!v || busyGuard()) return;
  const id = v.id;

  if (v.blockedByMe) {
    await guarded(
      S.refs?.blockBtn,
      'unblock',
      () => callCore('unblockUser', id),
      { success: 'تم إلغاء الحظر' },
    );
    return;
  }

  const ok = await confirmAction({
    title: `حظر ${displayName(v)}؟`,
    body: 'لن يتمكن من مراسلتك، ولن تصلك رسائله. يمكنك إلغاء الحظر لاحقاً.',
    confirmText: 'حظر',
    danger: true,
  });
  if (!ok || S.chatId !== id) return;
  await guarded(
    S.refs?.blockBtn,
    'block',
    () => callCore('blockUser', id),
    { success: 'تم حظر المستخدم' },
  );
}

async function onClearHistory() {
  const id = S.chatId;
  if (!id || busyGuard()) return;
  const ok = await confirmAction({
    title: 'مسح سجل المحادثة من عندك؟',
    body: 'ستبقى الرسائل عند الطرف الآخر، وستختفي من جهازك وحسابك فقط.',
    confirmText: 'مسح',
    danger: true,
  });
  if (!ok || S.chatId !== id) return;
  await guarded(
    S.refs?.clearBtn,
    'clear',
    () => callCore('clearHistoryForMe', id),
    { success: 'تم مسح السجل من عندك' },
  );
}

async function onDeleteChat() {
  const id = S.chatId;
  if (!id || busyGuard()) return;
  const ok = await confirmAction({
    title: 'حذف المحادثة من عندك؟',
    body: 'ستُخفى المحادثة من قائمتك على هذا الحساب فقط، ولن تتأثر عند الطرف الآخر.',
    confirmText: 'حذف',
    danger: true,
  });
  if (!ok || S.chatId !== id) return;
  const done = await guarded(
    S.refs?.deleteBtn,
    'delete',
    () => callCore('deleteChatForMe', id),
    { success: 'تم حذف المحادثة من عندك' },
  );
  if (done) {
    closePanel(false);
    S.onAfterRemove?.(id, 'deleted');
  }
}

/**
 * تبديل إشعارات النظام. طلب الإذن يبدأ داخل نقرة المستخدم مباشرة،
 * وهذا شرط المتصفح، لذلك لا يُسبق باستدعاء async.
 */
async function onToggleNotify(v) {
  ChatSound.updateSettings({ notifyEnabled: v });
  if (v) {
    const perm = ChatSound.notificationPermission();
    if (perm === 'default') {
      await ChatSound.requestNotificationPermission();
    } else if (perm === 'denied') {
      flash(PERM_TEXT.denied, 'danger');
    }
  }
  syncAll();
}

async function onRequestPermission() {
  const res = await ChatSound.requestNotificationPermission();
  if (res === 'granted') flash('تم تفعيل إشعارات النظام', 'success');
  else if (res === 'denied') flash('رفض المتصفح الإذن، ويمكنك تفعيله لاحقاً من إعدادات الموقع', 'danger');
  syncAll();
}

// ---------- نافذة الإبلاغ ----------

/**
 * نافذة الإبلاغ عن المحادثة. تكتب في `reports` بالحقول التي تقبلها القاعدة:
 * reporterUid, targetType, targetId, targetUid, reason, details, status, createdAt.
 */
function openReportDialog(view) {
  if (!view?.id || S.dialogOpen) return;
  S.dialogOpen = true;

  const prev = document.activeElement;
  const titleId = `cs-set-rt-${++uidSeq}`;
  const chatId = view.id;
  const otherUid = view.otherUid || '';
  let reason = null;
  let finished = false;

  const pickReason = (id) => {
    reason = id;
    syncRadios(reasonItems, id);
    submitBtn.disabled = false;
  };

  const reasonItems = REPORT_REASONS.map((r) => [
    r.id,
    el('button', {
      type: 'button',
      class: 'cs-set-option',
      role: 'radio',
      'aria-checked': 'false',
      text: r.label,
      onclick: () => pickReason(r.id),
    }),
  ]);

  const reasonGroup = el(
    'div',
    { class: 'cs-set-options', role: 'radiogroup', 'aria-label': 'سبب البلاغ', onkeydown: radioKeys },
    reasonItems.map(([, b]) => b),
  );

  const details = el('textarea', {
    class: 'cs-set-textarea',
    rows: 3,
    maxlength: DETAILS_MAX,
    placeholder: 'تفاصيل إضافية (اختياري)',
    'aria-label': 'تفاصيل البلاغ',
  });

  const cancelBtn = el('button', {
    type: 'button',
    class: 'cs-set-btn ghost',
    text: 'إلغاء',
    onclick: () => finish(),
  });

  const submitBtn = el('button', {
    type: 'button',
    class: 'cs-set-btn danger',
    text: 'إرسال البلاغ',
    disabled: true,
    onclick: () => submit(),
  });

  const panel = el(
    'div',
    { class: 'cs-set-confirm cs-set-report', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    el('h3', { class: 'cs-set-confirm-title', id: titleId, text: 'الإبلاغ عن المحادثة' }),
    el('p', {
      class: 'cs-set-confirm-body',
      text: 'سيُراجع فريق ClearNote البلاغ. اختر السبب، ويمكنك إضافة تفاصيل.',
    }),
    reasonGroup,
    details,
    el('div', { class: 'cs-set-confirm-foot' }, cancelBtn, submitBtn),
  );

  const overlay = el('div', { class: 'cs-set-overlay is-top' }, panel);

  const finish = () => {
    if (finished) return;
    finished = true;
    S.dialogOpen = false;
    document.removeEventListener('keydown', onKey, true);
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 180);
    if (prev instanceof HTMLElement && prev.isConnected) prev.focus();
  };

  const submit = async () => {
    if (!reason || finished) return;
    const ok = await guarded(
      submitBtn,
      'report',
      async () => {
        if (!S.db) throw new Error('تعذّر الإبلاغ الآن، الخدمة غير مهيأة');
        const reporterUid = currentUid();
        if (!reporterUid) throw new Error('سجّل الدخول أولاً للإبلاغ');
        await addDoc(collection(S.db, 'reports'), {
          reporterUid,
          targetType: 'chat',
          targetId: chatId,
          targetUid: otherUid,
          reason,
          details: details.value.trim().slice(0, DETAILS_MAX),
          status: 'open',
          createdAt: serverTimestamp(),
        });
      },
      { success: 'تم إرسال البلاغ، شكراً لك' },
    );
    if (ok) finish();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish();
      return;
    }
    if (e.key === 'Tab') trapTab(e, panel);
  };

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) finish();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  reasonItems[0][1].focus();
}

// ---------- الفتح والإغلاق ----------

/**
 * فتح لوحة إعدادات المحادثة. يقبل ChatView أو معرّف المحادثة.
 * يُرجع true عند الفتح.
 */
function open(target) {
  const id = typeof target === 'string' ? target : target?.id;
  if (!id) {
    flash('افتح محادثة أولاً', 'info');
    return false;
  }
  if (S.dialogOpen) return false;
  if (S.open && S.chatId === id) return true;

  const view = lastChats.find((c) => c?.id === id) || (typeof target === 'object' ? target : null);
  if (!view) {
    flash('تعذّر فتح إعدادات المحادثة', 'danger');
    return false;
  }

  if (S.open) {
    closePanel(false);
  } else {
    S.lastFocus = document.activeElement;
  }

  S.chatId = id;
  S.view = view;
  const built = buildPanel();
  S.root = built.overlay;
  S.refs = built.refs;
  S.open = true;

  syncAll();
  document.body.append(built.overlay);
  document.addEventListener('keydown', onPanelKey, true);
  requestAnimationFrame(() => built.overlay.classList.add('is-open'));
  built.refs.close.focus();
  return true;
}

function closePanel(restoreFocus = true) {
  if (!S.open) return;
  const overlay = S.root;
  const back = S.lastFocus;

  document.removeEventListener('keydown', onPanelKey, true);
  S.open = false;
  S.chatId = null;
  S.view = null;
  S.root = null;
  S.refs = null;
  S.lastFocus = null;

  if (overlay) {
    overlay.style.pointerEvents = 'none';
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 200);
  }
  if (restoreFocus && back instanceof HTMLElement && back.isConnected) back.focus();
}

/** Escape يغلق اللوحة، وTab محصور داخلها. النوافذ الفرعية تتولى مفاتيحها بنفسها. */
function onPanelKey(e) {
  if (!S.open || S.dialogOpen) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closePanel();
    return;
  }
  if (e.key === 'Tab') trapTab(e, S.root?.querySelector('.cs-set-panel'));
}

// ---------- ربط أحداث ChatCore ----------

function onAuth(user) {
  S.uid = user ? user.uid : null;
  if (!user) {
    lastChats = [];
    closePanel(false);
  }
}

function onChats(list) {
  lastChats = Array.isArray(list) ? list : [];
  if (!S.open) return;
  const fresh = lastChats.find((c) => c?.id === S.chatId);
  if (!fresh) {
    closePanel(false);
    flash('لم تعد المحادثة متاحة', 'info');
    return;
  }
  S.view = fresh;
  syncAll();
}

function onActive(payload) {
  if (!S.open || !S.view || payload?.chat?.id !== S.chatId) return;
  S.view = {
    ...S.view,
    blockedByMe: !!payload.blockedByMe,
    otherUid: payload.otherUid || S.view.otherUid,
  };
  syncAll();
}

const CORE_HANDLERS = Object.freeze([
  ['auth', onAuth],
  ['chats', onChats],
  ['chat:active', onActive],
]);

/** يربط أحداث ChatCore مرة واحدة، ويحفظ دوال الإلغاء لاستخدامها في destroy. */
function bindCore() {
  if (S.bound) return;
  S.bound = true;
  S.coreOffs = CORE_HANDLERS.map(([evt, fn]) => {
    const off = ChatCore.on(evt, fn);
    if (typeof off === 'function') return off;
    return () => ChatCore.off?.(evt, fn);
  });
}

function unbindCore() {
  for (const off of S.coreOffs) {
    try {
      off();
    } catch (err) {
      console.error('[ChatSettings] unbind', err);
    }
  }
  S.coreOffs = [];
  S.bound = false;
}

// ---------- التزامن بين التبويبات ----------

function onStorage(e) {
  if (e.key !== THEME_KEY) return;
  applyTheme(readTheme());
  syncAll();
}

// ---------- التهيئة والإنهاء ----------

/**
 * يُستدعى مرة واحدة قبل ChatCore.init.
 * options.db و options.auth: مراجع Firebase (db مطلوب لكتابة البلاغات).
 * options.onViewProfile(uid): فتح الملف الشخصي.
 * options.onAfterRemove(chatId, reason): بعد الحذف أو الرفض، reason: 'deleted' أو 'declined'.
 * options.onSearch(chatId): فتح البحث داخل المحادثة.
 */
function init(options = {}) {
  if (ready) return ChatSettings;
  ready = true;

  S.db = options.db ?? null;
  S.auth = options.auth ?? null;
  S.uid = S.auth?.currentUser?.uid ?? null;
  S.onOpenProfile = typeof options.onViewProfile === 'function' ? options.onViewProfile : null;
  S.onAfterRemove = typeof options.onAfterRemove === 'function' ? options.onAfterRemove : null;
  onSearchHook = typeof options.onSearch === 'function' ? options.onSearch : null;

  applyTheme(readTheme());
  watchSystemTheme();
  bindCore();

  if (!storageBound) {
    window.addEventListener('storage', onStorage);
    storageBound = true;
  }
  if (!S.unsubSound) {
    S.unsubSound = ChatSound.onSettingsChange(() => syncAll());
  }
  return ChatSettings;
}

function destroy() {
  closePanel(false);
  unbindCore();
  unwatchSystemTheme();

  if (typeof S.unsubSound === 'function') S.unsubSound();
  S.unsubSound = null;

  if (storageBound) {
    window.removeEventListener('storage', onStorage);
    storageBound = false;
  }

  clearTimeout(S.toastTimer);
  flashNode?.remove();
  flashNode = null;
  lastChats = [];
  ready = false;
}

// ---------- التصدير ----------

export const ChatSettings = Object.freeze({
  init,
  open,
  close: () => closePanel(),
  isOpen: () => S.open,
  destroy,
  themes: THEMES,
  getTheme: readTheme,
  setTheme: (pref) => {
    setTheme(pref);
    syncAll();
  },
});
