/* ============================================================
   js/chat-sound.js
   يحتوي: إعدادات الصوت والإشعارات (محفوظة محلياً ومتزامنة بين
   التبويبات)، محرك صوتي برمجي بـ Web Audio لا يعتمد على ملفات،
   المؤثرات (إرسال، استقبال، إشعار، تفاعل، تسجيل، حذف، خطأ)،
   ساعات الهدوء، الاهتزاز على الهاتف، إشعارات المتصفح،
   عداد غير المقروء في عنوان الصفحة، وربط أحداث ChatCore.
   التصدير: ChatSound
   ============================================================ */

import { ChatCore } from './chat-core.js';

const STORAGE_KEY = 'clearnote.chat.sound.v1';
const MASTER_MAX = 0.8;
const SEEN_MAX = 500;
const NOTIFY_GAP_MS = 1200;
const TITLE_PREFIX_RE = /^\(\d+\+?\)\s/;
const GESTURE_EVENTS = Object.freeze(['pointerdown', 'keydown', 'touchend']);

/** مجموعات المؤثرات، وكل مجموعة يمكن تفعيلها أو إيقافها من الإعدادات. */
const EVENT_GROUPS = Object.freeze(['send', 'receive', 'notify', 'reaction', 'record', 'delete', 'error']);

/** أقل فاصل زمني بين مؤثرين من المجموعة نفسها، لمنع التكدس عند الرسائل المتتالية. */
const MIN_GAP_MS = Object.freeze({
  send: 350,
  receive: 250,
  notify: 400,
  reaction: 150,
  record: 200,
  delete: 200,
  error: 500,
});

const BOOL_KEYS = Object.freeze([
  'enabled',
  'notifyEnabled',
  'showPreview',
  'vibrate',
  'titleBadge',
  'quietEnabled',
]);

/**
 * وصفات المؤثرات. كل نغمة: at (ثوانٍ من البداية)، f0 (التردد الابتدائي)،
 * f1 (التردد النهائي، اختياري للانزلاق)، dur (المدة)، peak (الذروة)، type (شكل الموجة).
 */
const RECIPES = Object.freeze({
  send: {
    group: 'send',
    notes: [
      { at: 0, f0: 620, f1: 940, dur: 0.09, peak: 0.14, type: 'sine' },
    ],
  },
  receive: {
    group: 'receive',
    notes: [
      { at: 0, f0: 880, dur: 0.16, peak: 0.18, type: 'sine' },
      { at: 0.1, f0: 1175, dur: 0.22, peak: 0.16, type: 'sine' },
    ],
  },
  notify: {
    group: 'notify',
    notes: [
      { at: 0, f0: 784, dur: 0.18, peak: 0.2, type: 'triangle' },
      { at: 0.12, f0: 988, dur: 0.18, peak: 0.2, type: 'triangle' },
      { at: 0.24, f0: 1319, dur: 0.32, peak: 0.18, type: 'triangle' },
    ],
  },
  reaction: {
    group: 'reaction',
    notes: [
      { at: 0, f0: 1046, f1: 1318, dur: 0.12, peak: 0.12, type: 'triangle' },
    ],
  },
  recordStart: {
    group: 'record',
    notes: [
      { at: 0, f0: 740, dur: 0.08, peak: 0.12, type: 'sine' },
      { at: 0.09, f0: 988, dur: 0.1, peak: 0.12, type: 'sine' },
    ],
  },
  recordStop: {
    group: 'record',
    notes: [
      { at: 0, f0: 988, dur: 0.08, peak: 0.12, type: 'sine' },
      { at: 0.09, f0: 740, dur: 0.12, peak: 0.12, type: 'sine' },
    ],
  },
  delete: {
    group: 'delete',
    notes: [
      { at: 0, f0: 420, f1: 240, dur: 0.16, peak: 0.12, type: 'sine' },
    ],
  },
  error: {
    group: 'error',
    notes: [
      { at: 0, f0: 260, f1: 190, dur: 0.24, peak: 0.2, type: 'triangle' },
      { at: 0.14, f0: 210, f1: 170, dur: 0.2, peak: 0.16, type: 'triangle' },
    ],
  },
});

// ---------- الحالة ----------

function defaultSettings() {
  return {
    enabled: true,         // تشغيل المؤثرات الصوتية
    volume: 70,            // 0 إلى 100
    notifyEnabled: true,   // إشعارات المتصفح والنظام
    showPreview: true,     // إظهار نص الرسالة داخل الإشعار
    vibrate: true,         // الاهتزاز على الهواتف
    titleBadge: true,      // عداد غير المقروء في عنوان الصفحة
    quietEnabled: false,   // ساعات الهدوء
    quietFrom: 22,         // بداية ساعات الهدوء (بالساعة، 0 إلى 23)
    quietTo: 7,            // نهاية ساعات الهدوء
    events: Object.fromEntries(EVENT_GROUPS.map((g) => [g, true])),
  };
}

let settings = defaultSettings();
const settingsListeners = new Set();

const engine = {
  ctx: null,
  master: null,
  comp: null,
  lastPlay: new Map(),
};

const chatViews = new Map();   // أحدث صورة لكل محادثة من حدث chats
const seenIds = new Set();     // معرّفات رسائل عُرضت سابقاً، لتمييز الجديد
const handlers = { onOpen: null, icon: '' };

let active = false;
let coreBound = false;
let uid = null;
let baseTitle = '';
let lastNotifyAt = 0;
let gestureOff = null;

// ---------- أدوات صغيرة ----------

function toMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return 0;
}

function isCoarsePointer() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
}

function isPageFocused() {
  return !document.hidden && document.hasFocus();
}

function rememberId(id) {
  seenIds.add(id);
  if (seenIds.size > SEEN_MAX) seenIds.delete(seenIds.values().next().value);
}

// ---------- الإعدادات ----------

function sanitizeSettings(raw) {
  const out = defaultSettings();
  const src = raw && typeof raw === 'object' ? raw : {};

  for (const key of BOOL_KEYS) {
    if (typeof src[key] === 'boolean') out[key] = src[key];
  }
  if (Number.isFinite(src.volume)) {
    out.volume = Math.min(100, Math.max(0, Math.round(src.volume)));
  }
  for (const key of ['quietFrom', 'quietTo']) {
    if (Number.isInteger(src[key]) && src[key] >= 0 && src[key] <= 23) out[key] = src[key];
  }
  if (src.events && typeof src.events === 'object') {
    for (const group of EVENT_GROUPS) {
      if (typeof src.events[group] === 'boolean') out.events[group] = src.events[group];
    }
  }
  return out;
}

function loadSettings() {
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
  } catch {
    return defaultSettings();
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // التخزين معطّل (وضع خاص مثلاً)، والإعدادات تبقى لجلسة الصفحة.
  }
}

function getSettings() {
  return { ...settings, events: { ...settings.events } };
}

function emitSettings() {
  const snapshot = getSettings();
  for (const fn of settingsListeners) {
    try {
      fn(snapshot);
    } catch (err) {
      console.error('[ChatSound] settings listener', err);
    }
  }
}

function applySideEffects() {
  applyVolume();
  syncTitle();
}

/**
 * يدمج التعديلات مع الإعدادات الحالية، ويحفظها، ويطبّقها فوراً.
 * يُرجع نسخة من الإعدادات بعد التحديث.
 */
function updateSettings(patch = {}) {
  if (!patch || typeof patch !== 'object') return getSettings();
  settings = sanitizeSettings({
    ...settings,
    ...patch,
    events: { ...settings.events, ...(patch.events && typeof patch.events === 'object' ? patch.events : {}) },
  });
  saveSettings();
  applySideEffects();
  emitSettings();
  return getSettings();
}

/** يستمع لأي تغيير في الإعدادات. يُرجع دالة لإلغاء الاستماع. */
function onSettingsChange(fn) {
  if (typeof fn !== 'function') return () => {};
  settingsListeners.add(fn);
  return () => settingsListeners.delete(fn);
}

// ---------- ساعات الهدوء ----------

function isQuietNow(date = new Date()) {
  if (!settings.quietEnabled) return false;
  const { quietFrom: from, quietTo: to } = settings;
  if (from === to) return false;
  const h = date.getHours();
  return from < to ? (h >= from && h < to) : (h >= from || h < to);
}

// ---------- المحرك الصوتي ----------

function applyVolume() {
  if (engine.master) engine.master.gain.value = (settings.volume / 100) * MASTER_MAX;
}

function ensureContext() {
  if (engine.ctx) return engine.ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;

  try {
    engine.ctx = new Ctx();
  } catch {
    return null;
  }

  engine.comp = engine.ctx.createDynamicsCompressor();
  engine.master = engine.ctx.createGain();
  engine.master.connect(engine.comp);
  engine.comp.connect(engine.ctx.destination);
  applyVolume();
  return engine.ctx;
}

/** يفعّل الصوت بعد أول تفاعل من المستخدم، لأن المتصفحات تمنع التشغيل قبله. */
async function unlockAudio() {
  const ctx = ensureContext();
  if (!ctx) return false;
  if (ctx.state !== 'running') {
    try {
      await ctx.resume();
    } catch {
      return false;
    }
  }
  return ctx.state === 'running';
}

function bindGestureUnlock() {
  if (gestureOff) return;

  const onGesture = () => {
    unlockAudio().then((ok) => {
      if (ok) releaseGestures();
    });
  };
  const releaseGestures = () => {
    GESTURE_EVENTS.forEach((ev) => document.removeEventListener(ev, onGesture, true));
    gestureOff = null;
  };

  GESTURE_EVENTS.forEach((ev) => document.addEventListener(ev, onGesture, { capture: true, passive: true }));
  gestureOff = releaseGestures;
}

/** نغمة واحدة: مذبذب بمغلّف صوتي (هجوم سريع ثم خفوت أُسّي). */
function scheduleTone(ctx, out, t0, { type = 'sine', f0, f1, dur, peak = 0.2 }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const attack = Math.min(0.012, dur / 4);

  osc.type = type;
  osc.frequency.setValueAtTime(f0, t0);
  if (Number.isFinite(f1) && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);

  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(gain);
  gain.connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}

/**
 * تشغيل وصفة صوتية.
 * force = true يتجاوز التفعيل العام وساعات الهدوء (يُستخدم للمعاينة في الإعدادات فقط).
 */
function playRecipe(name, { force = false } = {}) {
  const recipe = RECIPES[name];
  if (!recipe) return false;

  if (!force) {
    if (!settings.enabled || !settings.events[recipe.group] || isQuietNow()) return false;
  }

  const ctx = ensureContext();
  if (!ctx || ctx.state !== 'running' || !engine.master) return false;

  const now = performance.now();
  const last = engine.lastPlay.get(recipe.group) ?? -Infinity;
  if (now - last < MIN_GAP_MS[recipe.group]) return false;
  engine.lastPlay.set(recipe.group, now);

  const t0 = ctx.currentTime + 0.02;
  for (const note of recipe.notes) {
    scheduleTone(ctx, engine.master, t0 + note.at, note);
  }
  return true;
}

/**
 * تشغيل مؤثر بالاسم: send، receive، notify، reaction، recordStart، recordStop، delete، error.
 * يُرجع true إذا شُغّل فعلاً.
 */
function play(name) {
  return playRecipe(name);
}

/** معاينة مؤثر من شاشة الإعدادات، تتجاوز التفعيل وساعات الهدوء. */
function preview(name) {
  return playRecipe(name, { force: true });
}

// ---------- الاهتزاز ----------

function vibrate(pattern) {
  if (!settings.vibrate || isQuietNow() || !isCoarsePointer()) return;
  if (typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // بعض المتصفحات ترفض الاهتزاز دون تفاعل سابق، وهذا مقبول.
  }
}

// ---------- إشعارات المتصفح ----------

function notificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function notificationPermission() {
  return notificationSupported() ? Notification.permission : 'unsupported';
}

/** يجب استدعاؤها من نقرة مستخدم، وإلا يرفض المتصفح الطلب. */
async function requestNotificationPermission() {
  if (!notificationSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** يعرض إشعاراً للنظام عند غياب الصفحة فقط، ويستبدل إشعارات المحادثة نفسها (tag). */
function showBrowserNotification(p) {
  if (!settings.notifyEnabled || isQuietNow()) return false;
  if (!notificationSupported() || Notification.permission !== 'granted') return false;
  if (isPageFocused()) return false;

  const now = Date.now();
  if (now - lastNotifyAt < NOTIFY_GAP_MS) return false;
  lastNotifyAt = now;

  const title = String(p.title || 'ClearNote').slice(0, 100);
  const body = settings.showPreview
    ? String(p.preview || 'رسالة جديدة').slice(0, 160)
    : 'رسالة جديدة';

  let note;
  try {
    note = new Notification(title, {
      body,
      tag: `chat-${p.chatId}`,
      icon: handlers.icon || undefined,
      silent: true, // الصوت يصدر من المحرك الداخلي لتجنب التكرار
      lang: 'ar',
      dir: 'rtl',
    });
  } catch {
    return false;
  }

  note.onclick = () => {
    window.focus();
    note.close();
    if (handlers.onOpen && p.chatId) handlers.onOpen(p.chatId);
  };
  return true;
}

// ---------- عداد غير المقروء في العنوان ----------

function isMutedView(c, now = Date.now()) {
  if (c.mutedForever) return true;
  const until = toMs(c.mutedUntil);
  if (until) return until > now;
  return c.muted === true;
}

function unreadTotal() {
  const now = Date.now();
  let sum = 0;
  for (const c of chatViews.values()) {
    if (c.hidden || c.archived || isMutedView(c, now)) continue;
    sum += Number(c.unread) || 0;
  }
  return sum;
}

function syncTitle() {
  if (!active) return;
  const n = settings.titleBadge ? unreadTotal() : 0;
  document.title = n > 0 ? `(${n > 99 ? '99+' : n}) ${baseTitle}` : baseTitle;
}

// ---------- معالجات أحداث ChatCore ----------

function onAuth(user) {
  if (!active) return;
  uid = user ? user.uid : null;
  if (!user) {
    chatViews.clear();
    seenIds.clear();
  }
  syncTitle();
}

function onChats(list) {
  if (!active) return;
  chatViews.clear();
  for (const c of Array.isArray(list) ? list : []) {
    if (c?.id) chatViews.set(c.id, c);
  }
  syncTitle();
}

/**
 * يُشغّل مؤثر الإرسال عند ظهور رسالة جديدة من المستخدم نفسه.
 * التحميل الأول والصفحات القديمة تُسجَّل فقط ولا تُشغّل شيئاً.
 */
function onMessages(payload) {
  if (!active || !payload) return;
  const list = Array.isArray(payload.messages) ? payload.messages : [];

  if (payload.reason === 'init' || payload.reason === 'older') {
    for (const m of list) {
      if (m?.id) rememberId(m.id);
    }
    return;
  }

  if (payload.reason !== 'live') return;

  let ownNew = false;
  for (const m of list) {
    if (!m?.id || seenIds.has(m.id)) continue;
    rememberId(m.id);
    if (uid && m.senderUid === uid) ownNew = true;
  }
  if (ownNew) playRecipe('send');
}

/**
 * رسالة واردة من طرف آخر.
 * - المحادثة النشطة والصفحة ظاهرة: صوت استقبال خفيف.
 * - غير ذلك: صوت إشعار، واهتزاز، وإشعار للنظام عند الخلفية.
 * المحادثات المكتومة لا تصدر شيئاً.
 */
function onIncoming(p) {
  if (!active || !p) return;
  if (uid && p.senderUid === uid) return;

  const view = chatViews.get(p.chatId);
  if (view && isMutedView(view)) return;

  const focused = isPageFocused();
  if (p.isActive && focused) {
    playRecipe('receive');
    return;
  }

  playRecipe('notify');
  vibrate([80, 50, 80]);
  showBrowserNotification(p);
}

function onSendFailed() {
  if (!active) return;
  playRecipe('error');
  vibrate([120, 60, 120]);
}

function onToast(p) {
  if (!active || p?.type !== 'danger') return;
  playRecipe('error');
}

function onError() {
  if (!active) return;
  playRecipe('error');
}

function bindCore() {
  if (coreBound) return;
  coreBound = true;
  ChatCore.on('auth', onAuth);
  ChatCore.on('chats', onChats);
  ChatCore.on('messages', onMessages);
  ChatCore.on('incoming', onIncoming);
  ChatCore.on('send-failed', onSendFailed);
  ChatCore.on('toast', onToast);
  ChatCore.on('error', onError);
}

// ---------- التزامن بين التبويبات ----------

function onStorage(e) {
  if (!active || e.key !== STORAGE_KEY) return;
  settings = loadSettings();
  applySideEffects();
  emitSettings();
}

// ---------- التهيئة والإنهاء ----------

/**
 * يُستدعى مرة واحدة قبل ChatCore.init حتى لا تفوت الأجهزة حالة المصادقة الأولى.
 * options.onOpen(chatId): يُستدعى عند النقر على إشعار المتصفح لفتح المحادثة.
 * options.icon: رابط أيقونة الإشعار (اختياري).
 */
function init(options = {}) {
  if (active) return ChatSound;

  handlers.onOpen = typeof options.onOpen === 'function' ? options.onOpen : null;
  handlers.icon = typeof options.icon === 'string' ? options.icon : '';

  settings = loadSettings();
  baseTitle = document.title.replace(TITLE_PREFIX_RE, '');
  active = true;

  bindCore();
  bindGestureUnlock();
  window.addEventListener('storage', onStorage);
  applySideEffects();
  return ChatSound;
}

/** إيقاف الخدمة واستعادة عنوان الصفحة الأصلي. */
function destroy() {
  if (!active) return;
  active = false;
  gestureOff?.();
  window.removeEventListener('storage', onStorage);
  document.title = baseTitle || document.title;
  chatViews.clear();
  seenIds.clear();
  uid = null;
}

// ---------- التصدير ----------

export const ChatSound = Object.freeze({
  init,
  destroy,
  play,
  preview,
  unlock: unlockAudio,
  vibrate,
  getSettings,
  updateSettings,
  onSettingsChange,
  isQuietNow,
  notificationSupported,
  notificationPermission,
  requestNotificationPermission,
  groups: EVENT_GROUPS,
  sounds: Object.freeze(Object.keys(RECIPES)),
});
