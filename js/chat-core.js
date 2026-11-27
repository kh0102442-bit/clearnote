/* ============================================================
   js/chat-core.js — الجزء 1/2 (النسخة المصححة)
   يُدمج مع الجزء 2/2 بعده مباشرةً. الجزء 1/2 يحتوي على import.

   المسؤوليات:
   - الاتصال بـ Firestore والمستخدم الحالي (تهيئة من chat.html عبر init)
   - قائمة المحادثات، الطلبات، الحظر، التفضيلات الشخصية (userPrefs)
   - المحادثة النشطة والرسائل والإرسال والحذف والتفاعل (الجزء 2)

   عقد الأحداث (on(evt, fn)):
   - 'auth'        → user | null
   - 'ready'       → null                       (تم تحميل القائمة لأول مرة)
   - 'chats'       → Array<ChatView>            (القائمة كاملة مرتبة ومفلترة)
   - 'chat:active' → { chat, blockedByMe, otherUid } | null
   - 'messages'    → { chatId, reason, messages[], hasOlder, loadingOlder, pinned[] }
                      reason: init | older | live | meta | failed
   - 'typing'      → { chatId, uids[], isTyping }
   - 'incoming'    → { chatId, senderUid, otherUid, title, preview, at, isActive, muted }
   - 'send-failed' → { chatId, id, message }
   - 'toast'       → { type: 'success'|'danger'|'info', text }
   - 'error'       → ChatError

   مدة الكتم (muteChat): تقبل false | 'forever' | true | Timestamp | مدة بالمللي ثانية
   | طابع زمني مطلق بالمللي ثانية (أي قيمة >= 1e12 تُعامَل مطلقة).

   ملاحظة: الحقول المتوقعة في users: displayName|name|fullName|username
   و photoURL|avatarUrl|avatar و isVerified و lastSeen. تُقرأ بأمان ولا تُكتب.
   ============================================================ */

import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, getCountFromServer,
  serverTimestamp, writeBatch, arrayUnion, deleteField, Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/* ------------------------------------------------------------
   1) الثوابت
   ------------------------------------------------------------ */

export const CHAT_LIMITS = Object.freeze({
  TEXT_MAX: 4000,
  PREVIEW_MAX: 140,
  REPLY_TEXT_MAX: 300,
  FORWARD_NAME_MAX: 100,
  PAGE_SIZE: 30,
  CHATS_MAX: 500,
  TYPING_TTL_MS: 6000,
  TYPING_GAP_MS: 2500,
  READ_GAP_MS: 600,
  ATTACH_MAX_VIDEO: 104857600,   // 100 MB
  ATTACH_MAX_OTHER: 52428800,    // 50 MB
  MAX_FORWARD_TARGETS: 10,
  EMOJI_MAX_LEN: 16,
});

export const CHAT_STATUS = Object.freeze({
  PENDING: 'pending',
  ACTIVE: 'active',
  BLOCKED: 'blocked',
});

export const MESSAGE_STATE = Object.freeze({
  SENDING: 'sending',
  SENT: 'sent',
  FAILED: 'failed',
});

export const ATTACH_KINDS = Object.freeze(['image', 'video', 'audio', 'pdf', 'file']);

const PREF_KEYS = ['archived', 'pinned', 'muted', 'hiddenAt', 'clearedAt'];
const CLOUD_PREFIX = 'https://res.cloudinary.com/nopxs3zt/';
/** أي قيمة مدة كتم أكبر من هذا الرقم تُعامَل كطابع زمني مطلق (ms منذ 1970). */
const ABS_TIME_THRESHOLD_MS = 1e12;
/** قراءة الطوابع المعلّقة محلياً كتقدير، حتى لا تتأخر الإجراءات المرئية. */
const DATA_OPTS = Object.freeze({ serverTimestamps: 'estimate' });

/* ------------------------------------------------------------
   2) الأخطاء
   ------------------------------------------------------------ */

export class ChatError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ChatError';
    this.code = code;
  }
}

const ERROR_MESSAGES = {
  'permission-denied': 'لا تملك صلاحية تنفيذ هذا الإجراء',
  'not-found': 'المحادثة أو الرسالة غير موجودة',
  'unavailable': 'لا يوجد اتصال بالإنترنت، ستُعاد المحاولة تلقائياً',
  'resource-exhausted': 'تم تجاوز الحد المسموح، حاول بعد قليل',
  'unauthenticated': 'يجب تسجيل الدخول أولاً',
};

export function toChatError(err, fallback = 'حدث خطأ غير متوقع') {
  if (err instanceof ChatError) return err;
  const code = String(err?.code || 'unknown').replace('firestore/', '');
  return new ChatError(code, ERROR_MESSAGES[code] || fallback);
}

const run = async (fn, fallback) => {
  try {
    return await fn();
  } catch (err) {
    throw toChatError(err, fallback);
  }
};

/* ------------------------------------------------------------
   3) ناقل الأحداث
   ------------------------------------------------------------ */

const bus = new Map();

function on(evt, fn) {
  if (!bus.has(evt)) bus.set(evt, new Set());
  bus.get(evt).add(fn);
  return () => bus.get(evt)?.delete(fn);
}

function emit(evt, payload) {
  const set = bus.get(evt);
  if (!set) return;
  set.forEach((fn) => {
    try {
      fn(payload);
    } catch (e) {
      console.error(`[ChatCore] خطأ في مستمع الحدث "${evt}"`, e);
    }
  });
}

/* ------------------------------------------------------------
   4) أدوات مساعدة
   ------------------------------------------------------------ */

const toMs = (v) => {
  if (!v) return null;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return null;
};

const clip = (s, n) => {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const chatIdFor = (a, b) => [a, b].sort().join('_');

const otherOf = (d, uid) => (d?.participants || []).find((p) => p !== uid) || null;

function requireUid() {
  if (!S.uid) throw new ChatError('unauthenticated', ERROR_MESSAGES.unauthenticated);
  return S.uid;
}

const chatRef = (id) => doc(S.db, 'chats', id);
const msgsCol = (id) => collection(S.db, 'chats', id, 'messages');
const msgRef = (chatId, id) => doc(S.db, 'chats', chatId, 'messages', id);
const blockRef = (a, b) => doc(S.db, 'blocks', `${a}_${b}`);

async function readChat(chatId) {
  const snap = await run(() => getDoc(chatRef(chatId)), 'تعذّر فتح المحادثة');
  if (!snap.exists()) throw new ChatError('not-found', ERROR_MESSAGES['not-found']);
  const data = snap.data(DATA_OPTS);
  S.chatDocs.set(chatId, data);
  return data;
}

/** تحديث متفائل لنسخة المحادثة المحلية قبل وصول اللقطة من الخادم. */
function patchChatDoc(chatId, patch) {
  const cur = S.chatDocs.get(chatId);
  if (cur) S.chatDocs.set(chatId, { ...cur, ...patch });
}

/* ------------------------------------------------------------
   5) الحالة الداخلية
   ------------------------------------------------------------ */

const S = {
  db: null,
  auth: null,
  uid: null,
  user: null,
  started: false,
  ready: null,
  authUnsub: null,
  chatsUnsub: null,
  chatsReady: false,
  chatsPrimed: false,
  chatDocs: new Map(),      // chatId → بيانات المستند الخام
  chatViews: [],            // آخر قائمة أُرسلت للواجهة
  seenLastIds: new Map(),   // chatId → آخر lastMessageId (لكشف الوارد)
  profiles: new Map(),      // uid → ملف مختصر
  profileLoads: new Map(),  // uid → Promise
  unread: new Map(),        // `${chatId}:${lastMessageId}` → عدد غير المقروء
  unreadTimer: null,
  readSent: new Map(),      // chatId → آخر وقت أُرسل فيه readAt
  failed: new Map(),        // `${chatId}|${id}` → رسائل فشل إرسالها
  blockedByMe: new Map(),   // chatId → true إذا كنت أنا من حظر الطرف الآخر
  active: null,             // { id, otherUid } للمحادثة النشطة
};

/* ------------------------------------------------------------
   6) الملفات الشخصية
   ------------------------------------------------------------ */

function normalizeProfile(uid, d = {}) {
  return {
    uid,
    name: d.displayName || d.name || d.fullName || d.username || 'مستخدم',
    username: d.username ? `@${String(d.username).replace(/^@/, '')}` : '',
    photo: d.photoURL || d.avatarUrl || d.avatar || '',
    verified: d.isVerified === true,
    lastSeen: toMs(d.lastSeen),
  };
}

function loadProfile(uid) {
  if (!uid) return Promise.resolve(null);
  if (S.profiles.has(uid)) return Promise.resolve(S.profiles.get(uid));
  if (S.profileLoads.has(uid)) return S.profileLoads.get(uid);
  const p = getDoc(doc(S.db, 'users', uid))
    .then((snap) => {
      const prof = normalizeProfile(uid, snap.exists() ? snap.data() : {});
      S.profiles.set(uid, prof);
      return prof;
    })
    .catch(() => {
      const fallback = normalizeProfile(uid, {});
      S.profiles.set(uid, fallback);
      return fallback;
    })
    .finally(() => S.profileLoads.delete(uid));
  S.profileLoads.set(uid, p);
  return p;
}

function nameOf(uid) {
  if (!uid) return 'مستخدم';
  return S.profiles.get(uid)?.name || (uid === S.uid ? 'أنا' : 'مستخدم');
}

/* ------------------------------------------------------------
   7) عرض المحادثات: بناء الكائنات، الرؤية، غير المقروء
   ------------------------------------------------------------ */

function muteState(raw) {
  if (raw === true || raw === 'forever') {
    return { muted: true, until: null, forever: raw === 'forever' };
  }
  const until = toMs(raw);
  if (until && until > Date.now()) return { muted: true, until, forever: false };
  return { muted: false, until: null, forever: false };
}

function buildChatView(id, d) {
  const uid = S.uid;
  const otherUid = otherOf(d, uid);
  const prefs = d.userPrefs?.[uid] || {};
  const lastAt = toMs(d.lastMessageAt);
  const hiddenAt = toMs(prefs.hiddenAt);
  const prof = otherUid ? S.profiles.get(otherUid) : null;
  const mute = muteState(prefs.muted);
  const status = d.status || CHAT_STATUS.ACTIVE; // المحادثات القديمة بلا حالة تُعامَل كنشطة
  return {
    id,
    otherUid,
    participants: d.participants || [],
    status,
    prevStatus: d.prevStatus || null,
    requesterUid: d.requesterUid || null,
    requestSent: d.requestSent === true,
    isRequestIncoming: status === CHAT_STATUS.PENDING && !!d.requesterUid && d.requesterUid !== uid,
    isRequestOutgoing: status === CHAT_STATUS.PENDING && d.requesterUid === uid,
    blocked: status === CHAT_STATUS.BLOCKED,
    title: prof?.name || 'مستخدم',
    username: prof?.username || '',
    photo: prof?.photo || '',
    verified: prof?.verified === true,
    lastMessage: d.lastMessage || '',
    lastMessageId: d.lastMessageId || null,
    lastSenderUid: d.lastSenderUid || null,
    lastMessageAt: lastAt,
    readAt: toMs(d.readAt?.[uid]),
    otherReadAt: otherUid ? toMs(d.readAt?.[otherUid]) : null,
    clearedAt: toMs(prefs.clearedAt),
    archived: prefs.archived === true,
    pinned: prefs.pinned === true,
    muted: mute.muted,
    mutedUntil: mute.until,
    mutedForever: mute.forever,
    hidden: hiddenAt !== null && (lastAt === null || lastAt <= hiddenAt),
    blockedByMe: false,
    unread: 0,
  };
}

function computeUnread(v) {
  if (v.id === S.active?.id) return 0;
  if (!v.lastMessageAt || !v.lastSenderUid || v.lastSenderUid === S.uid) return 0;
  if (v.readAt !== null && v.readAt >= v.lastMessageAt) return 0;
  const key = `${v.id}:${v.lastMessageId}`;
  return S.unread.has(key) ? S.unread.get(key) : -1; // -1 = جارٍ الحساب
}

function viewOf(id) {
  const d = S.chatDocs.get(id);
  if (!d || !S.uid) return null;
  const v = buildChatView(id, d);
  v.blockedByMe = v.blocked && S.blockedByMe.get(id) === true;
  v.unread = computeUnread(v);
  return v;
}

function isVisibleChat(v) {
  if (v.hidden) return false;
  // المحادثة بلا رسائل تُخفى من القائمة، إلا المفتوحة حالياً
  return v.lastMessageAt !== null || v.id === S.active?.id;
}

function emitChatsNow() {
  const views = [];
  for (const id of S.chatDocs.keys()) {
    const v = viewOf(id);
    if (v && isVisibleChat(v)) views.push(v);
  }
  views.sort((a, b) => (b.pinned - a.pinned) || ((b.lastMessageAt || 0) - (a.lastMessageAt || 0)));
  S.chatViews = views;
  emit('chats', views);
  if (views.some((v) => v.unread === -1)) queueUnreadCounts(views);
}

/** يُصدر المحادثة النشطة للواجهة (حدث واحد موحّد). */
function announceActive() {
  if (!S.active) {
    emit('chat:active', null);
    return;
  }
  const view = viewOf(S.active.id);
  emit('chat:active', {
    chat: view,
    blockedByMe: !!(view && view.blockedByMe),
    otherUid: S.active.otherUid,
  });
}

function queueUnreadCounts(views) {
  clearTimeout(S.unreadTimer);
  S.unreadTimer = setTimeout(async () => {
    let changed = false;
    await Promise.all(
      views
        .filter((v) => v.unread === -1)
        .map(async (v) => {
          const key = `${v.id}:${v.lastMessageId}`;
          try {
            const since = Timestamp.fromMillis(v.readAt ?? 0);
            const q = query(
              msgsCol(v.id),
              where('senderUid', '==', v.otherUid),
              where('createdAt', '>', since)
            );
            const snap = await getCountFromServer(q);
            S.unread.set(key, snap.data().count);
          } catch (e) {
            S.unread.set(key, 1); // تقدير آمن عند الفشل
          }
          changed = true;
        })
    );
    if (changed) emitChatsNow();
  }, 250);
}

/* ------------------------------------------------------------
   8) الاتصال بالقائمة وتهيئة الجلسة
   ------------------------------------------------------------ */

function subscribeChats() {
  const firstLoad = !S.chatsReady;
  const q = query(
    collection(S.db, 'chats'),
    where('participants', 'array-contains', S.uid),
    limit(CHAT_LIMITS.CHATS_MAX)
  );
  S.chatsUnsub = onSnapshot(
    q,
    (snap) => {
      const incoming = [];
      let activeChanged = false;
      snap.docChanges().forEach((ch) => {
        const id = ch.doc.id;
        if (ch.type === 'removed') {
          S.chatDocs.delete(id);
          S.seenLastIds.delete(id);
          return;
        }
        const d = ch.doc.data(DATA_OPTS);
        S.chatDocs.set(id, d);
        if (S.active?.id === id) activeChanged = true;
        const lastId = d.lastMessageId || null;
        const prevId = S.seenLastIds.get(id);
        if (S.chatsPrimed && lastId && lastId !== prevId && d.lastSenderUid && d.lastSenderUid !== S.uid) {
          incoming.push({
            chatId: id,
            senderUid: d.lastSenderUid,
            otherUid: d.lastSenderUid,
            preview: d.lastMessage || '',
            at: toMs(d.lastMessageAt),
            isActive: S.active?.id === id,
            muted: muteState(d.userPrefs?.[S.uid]?.muted).muted,
          });
        }
        S.seenLastIds.set(id, lastId);
      });
      S.chatDocs.forEach((d) => {
        const other = otherOf(d, S.uid);
        if (other && !S.profiles.has(other) && !S.profileLoads.has(other)) {
          loadProfile(other).then(() => emitChatsNow());
        }
      });
      if (activeChanged) announceActive();
      emitChatsNow();
      S.chatsPrimed = true;
      if (firstLoad) {
        S.chatsReady = true;
        emit('ready', null);
      }
      incoming.forEach((i) => {
        i.title = nameOf(i.senderUid);
        emit('incoming', i);
      });
    },
    (err) => emit('error', toChatError(err, 'تعذّر تحميل المحادثات'))
  );
}

function resetSession() {
  if (S.chatsUnsub) {
    S.chatsUnsub();
    S.chatsUnsub = null;
  }
  closeActive();
  clearTimeout(S.unreadTimer);
  S.chatDocs.clear();
  S.seenLastIds.clear();
  S.unread.clear();
  S.readSent.clear();
  S.failed.clear();
  S.blockedByMe.clear();
  S.chatViews = [];
  S.chatsReady = false;
  S.chatsPrimed = false;
}

/**
 * تهيئة المحرك. يستدعيها chat.html بعد تهيئة Firebase.
 * @param {{db: Firestore, auth: Auth}} deps
 */
export function init({ db, auth }) {
  if (S.started) return S.ready;
  if (!db || !auth) throw new ChatError('invalid', 'تهيئة الشات ناقصة: db و auth مطلوبان');
  S.db = db;
  S.auth = auth;
  S.started = true;
  S.ready = new Promise((resolve) => {
    let settled = false;
    S.authUnsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        resetSession();
        S.uid = null;
        S.user = null;
        emit('auth', null);
      } else if (S.uid !== user.uid) {
        resetSession();
        S.uid = user.uid;
        S.user = user;
        loadProfile(user.uid).then(() => emitChatsNow());
        subscribeChats();
        emit('auth', user);
      } else {
        S.user = user;
      }
      if (!settled) {
        settled = true;
        resolve(user || null);
      }
    });
  });
  return S.ready;
}

/* ------------------------------------------------------------
   9) إجراءات المحادثة: الإنشاء والطلبات والحظر
   ------------------------------------------------------------ */

/**
 * يضمن وجود مستند المحادثة بين المستخدم الحالي والطرف الآخر.
 * المحادثة الجديدة تُنشأ بحالة pending مع requesterUid = أنا و requestSent = false.
 */
export async function ensureChat(otherUid) {
  const uid = requireUid();
  if (!otherUid || typeof otherUid !== 'string' || otherUid === uid) {
    throw new ChatError('invalid', 'لا يمكن بدء محادثة مع هذا الحساب');
  }
  const id = chatIdFor(uid, otherUid);
  const ref = chatRef(id);
  let snap = null;
  try {
    snap = await getDoc(ref);
  } catch (err) {
    if (err?.code !== 'permission-denied') throw toChatError(err, 'تعذّر فتح المحادثة');
  }
  if (snap?.exists()) {
    S.chatDocs.set(id, snap.data(DATA_OPTS));
    return { id, created: false };
  }
  const [p0, p1] = [uid, otherUid].sort();
  try {
    await setDoc(ref, {
      participants: [p0, p1],
      createdAt: serverTimestamp(),
      status: CHAT_STATUS.PENDING,
      requesterUid: uid,
      requestSent: false,
      readAt: { [uid]: serverTimestamp() },
    });
  } catch (err) {
    // ربما أنشأها الطرف الآخر في نفس اللحظة
    const again = await getDoc(ref).catch(() => null);
    if (again?.exists()) {
      S.chatDocs.set(id, again.data(DATA_OPTS));
      return { id, created: false };
    }
    throw toChatError(err, 'تعذّر إنشاء المحادثة');
  }
  return { id, created: true };
}

export async function acceptRequest(chatId) {
  const uid = requireUid();
  const d = S.chatDocs.get(chatId) ?? (await readChat(chatId));
  if (!(d.status === CHAT_STATUS.PENDING && d.requesterUid && d.requesterUid !== uid)) {
    throw new ChatError('invalid', 'لا يوجد طلب محادثة للقبول');
  }
  await run(() => updateDoc(chatRef(chatId), { status: CHAT_STATUS.ACTIVE }), 'تعذّر قبول الطلب');
  patchChatDoc(chatId, { status: CHAT_STATUS.ACTIVE });
  emitChatsNow();
  emit('toast', { type: 'success', text: 'تم قبول المحادثة' });
}

/** رفض الطلب = إخفاء المحادثة عندي (لا يمكن حذف المستند). */
export function declineRequest(chatId) {
  return deleteChatForMe(chatId);
}

export async function blockUser(chatId) {
  const uid = requireUid();
  const d = S.chatDocs.get(chatId) ?? (await readChat(chatId));
  const otherUid = otherOf(d, uid);
  if (!otherUid) throw new ChatError('invalid', 'لا يمكن حظر هذا الحساب');

  if (d.status === CHAT_STATUS.BLOCKED) {
    if (S.blockedByMe.get(chatId) === true) {
      emit('toast', { type: 'info', text: 'هذا المستخدم محظور بالفعل' });
      return;
    }
    throw new ChatError('permission-denied', 'لا يمكن تنفيذ هذا الإجراء في هذه المحادثة');
  }

  const prevStatus = d.status || CHAT_STATUS.ACTIVE;
  await run(async () => {
    // أولاً سجل الحظر ثم حالة المحادثة (قواعد الحظر تعتمد على وجود السجل)
    const bRef = blockRef(uid, otherUid);
    const existing = await getDoc(bRef).catch(() => null);
    if (!existing?.exists()) {
      await setDoc(bRef, {
        blockerUid: uid,
        blockedUid: otherUid,
        createdAt: serverTimestamp(),
      });
    }
    await updateDoc(chatRef(chatId), {
      status: CHAT_STATUS.BLOCKED,
      prevStatus,
    });
  }, 'تعذّر حظر المستخدم');

  S.blockedByMe.set(chatId, true);
  patchChatDoc(chatId, { status: CHAT_STATUS.BLOCKED, prevStatus });
  emitChatsNow(); // يُحدّث المحادثة النشطة عبر onChatsChanged
  emit('toast', { type: 'success', text: 'تم حظر المستخدم' });
}

export async function unblockUser(chatId) {
  const uid = requireUid();
  const d = S.chatDocs.get(chatId) ?? (await readChat(chatId));
  const otherUid = otherOf(d, uid);

  if (d.status !== CHAT_STATUS.BLOCKED) {
    S.blockedByMe.delete(chatId);
    return;
  }

  // لا يُفك الحظر إلا إذا كنت أنا الحاظر (يوجد سجل حظر باسمي)
  const bSnap = await getDoc(blockRef(uid, otherUid)).catch(() => null);
  if (!bSnap?.exists()) {
    throw new ChatError('permission-denied', 'لا يمكنك فك حظر هذا المستخدم، الحظر من الطرف الآخر');
  }

  const restore = d.prevStatus && d.prevStatus !== CHAT_STATUS.BLOCKED
    ? d.prevStatus
    : CHAT_STATUS.ACTIVE;

  await run(async () => {
    // أولاً تحديث المحادثة ثم حذف السجل
    await updateDoc(chatRef(chatId), { status: restore });
    await deleteDoc(blockRef(uid, otherUid)).catch(() => {});
  }, 'تعذّر فك الحظر');

  S.blockedByMe.delete(chatId);
  patchChatDoc(chatId, { status: restore });
  emitChatsNow();
  emit('toast', { type: 'success', text: 'تم فك الحظر' });
}

/* ------------------------------------------------------------
   10) التفضيلات الشخصية (userPrefs) — لكل مستخدم مفتاحه
   ------------------------------------------------------------ */

export async function setPrefs(chatId, patch) {
  const uid = requireUid();
  const data = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!PREF_KEYS.includes(key)) throw new ChatError('invalid', 'تفضيل غير معروف');
    data[`userPrefs.${uid}.${key}`] = value;
  }
  return run(() => updateDoc(chatRef(chatId), data), 'تعذّر حفظ الإعداد');
}

export const archiveChat = (chatId, on = true) => setPrefs(chatId, { archived: on });

/** إلغاء الأرشفة صراحةً (restoreChat مخصص لإظهار محادثة مخفية فقط). */
export const unarchiveChat = (chatId) => setPrefs(chatId, { archived: false });

export const pinChat = (chatId, on = true) => setPrefs(chatId, { pinned: on });

/** تحويل قيمة الكتم إلى الصيغة المخزنة في userPrefs.muted. */
function muteValue(mode) {
  if (mode === false || mode == null) return false;
  if (mode === 'forever' || mode === true) return 'forever';
  if (mode instanceof Timestamp) return mode.toMillis() > Date.now() ? mode : false;
  const n = Number(mode);
  if (!Number.isFinite(n) || n <= 0) throw new ChatError('invalid', 'مدة الكتم غير صالحة');
  const until = n >= ABS_TIME_THRESHOLD_MS ? n : Date.now() + n;
  return until > Date.now() ? Timestamp.fromMillis(until) : false;
}

/**
 * mode: false | 'forever' | مدة نسبية بالمللي ثانية | طابع زمني مطلق بالمللي ثانية | Timestamp
 */
export async function muteChat(chatId, mode) {
  return setPrefs(chatId, { muted: muteValue(mode) });
}

/**
 * الحذف "لي فقط" للمحادثة: إخفاء + مسح السجل عندي.
 * الرسائل الجديدة بعد الإخفاء تعيد المحادثة تلقائياً.
 */
export function deleteChatForMe(chatId) {
  return setPrefs(chatId, {
    hiddenAt: serverTimestamp(),
    clearedAt: serverTimestamp(),
    pinned: false,
  });
}

export const clearHistoryForMe = (chatId) => setPrefs(chatId, { clearedAt: serverTimestamp() });

/** إظهار محادثة مخفية عندي (لا يلغي الأرشفة ولا مسح السجل). */
export const restoreChat = (chatId) => setPrefs(chatId, { hiddenAt: deleteField() });
/* ============================================================
   js/chat-core.js — الجزء 2/2 (النسخة المصححة)
   يُلحق بعد نهاية الجزء 1/2 مباشرةً (لا يحتوي import).

   يحتوي على: حالة الخيط، الرسائل، الكتابة، القراءة، الإرسال،
   إعادة المحاولة، التعديل والحذف، التفاعلات، التثبيت، إعادة التوجيه،
   فتح المحادثة وإغلاقها، والواجهة العامة ChatCore.
   ============================================================ */

/* ---------- حالة الخيط (المحادثة النشطة) ---------- */

const T = {
  chatId: null,
  token: 0,
  openSeq: 0,
  limit: CHAT_LIMITS.PAGE_SIZE,
  hasOlder: false,
  loadingOlder: false,
  nextReason: 'init',
  server: new Map(),   // id -> رسالة من الخادم (مُطبَّعة)
  pending: new Map(),  // id -> رسالة قيد الإرسال لم تظهر بعد في اللقطة
  unsubMsgs: null,
  unsubTyping: null,
  typingAt: new Map(), // uid -> ms
  typingTimer: null,
  lastTypingSent: 0,
  readTimer: null,
  viewKey: '',
};

/* ---------- أدوات مساعدة ---------- */

const msOf = (v) => (v ? toMs(v) || 0 : 0);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const failKey = (chatId, id) => `${chatId}|${id}`;
const pushToast = (type, text) => emit('toast', { type, text });
const byCreated = (a, b) =>
  a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/* ---------- نصوص المعاينة والرد ---------- */

function attachLabel(a) {
  if (!a) return '';
  switch (a.kind) {
    case 'image': return '🖼️ صورة';
    case 'video': return '🎬 فيديو';
    case 'audio': return '🎵 مقطع صوتي';
    case 'pdf':   return '📄 ملف PDF';
    default:      return `📎 ${a.name || 'ملف'}`;
  }
}

function previewOf(body) {
  const text = (body.text || '').trim();
  return clip(text || attachLabel(body.attachment), CHAT_LIMITS.PREVIEW_MAX);
}

function replyPayload(m) {
  if (!m || !m.id) return null;
  return {
    id: String(m.id),
    senderUid: String(m.senderUid || ''),
    name: clip(String(nameOf(m.senderUid) || 'مستخدم'), 100),
    text: clip((m.text || '').trim() || attachLabel(m.attachment), CHAT_LIMITS.REPLY_TEXT_MAX),
  };
}

/* ---------- التحقق من المرفقات ---------- */

function sanitizeAttachment(a) {
  if (!a || typeof a !== 'object') return { error: 'مرفق غير صالح.' };
  if (!ATTACH_KINDS.includes(a.kind)) return { error: 'نوع الملف غير مدعوم.' };
  if (typeof a.url !== 'string' || !a.url.startsWith(CLOUD_PREFIX) || a.url.length > 500) {
    return { error: 'رابط الملف غير صالح.' };
  }
  const size = Number(a.size);
  if (!(size > 0)) return { error: 'حجم الملف غير صالح.' };
  const isVideo = a.kind === 'video';
  const max = isVideo ? CHAT_LIMITS.ATTACH_MAX_VIDEO : CHAT_LIMITS.ATTACH_MAX_OTHER;
  if (size > max) {
    return {
      error: isVideo
        ? 'الفيديو يتجاوز الحد الأقصى 100 ميجابايت.'
        : 'الملف يتجاوز الحد الأقصى 50 ميجابايت.',
    };
  }
  const out = {
    url: a.url,
    name: clip(String(a.name || 'ملف'), 255) || 'ملف',
    size,
    kind: a.kind,
  };
  if (typeof a.mime === 'string' && a.mime) out.mime = clip(a.mime, 100);
  if (typeof a.publicId === 'string' && a.publicId) out.publicId = clip(a.publicId, 200);
  if (isNum(a.duration) && a.duration >= 0) out.duration = a.duration;
  if (isNum(a.width) && a.width > 0) out.width = a.width;
  if (isNum(a.height) && a.height > 0) out.height = a.height;
  return { value: out };
}

/* ---------- بوابة الإرسال ---------- */

function needsRequestFor(view) {
  return !!view && view.status === CHAT_STATUS.PENDING && !!view.isRequestOutgoing && !view.requestSent;
}

function sendGate(view) {
  if (!view) return 'هذه المحادثة غير متاحة.';
  if (view.blocked || view.status === CHAT_STATUS.BLOCKED) {
    return view.blockedByMe
      ? 'لقد حظرت هذا المستخدم. فك الحظر لإرسال رسالة.'
      : 'لا يمكن إرسال رسائل في هذه المحادثة.';
  }
  if (view.isRequestIncoming) return 'وافق على طلب المحادثة أولاً لتتمكن من الرد.';
  if (view.isRequestOutgoing && view.requestSent) {
    return 'بانتظار موافقة الطرف الآخر على طلب المحادثة.';
  }
  return null;
}

/* ---------- تطبيع الرسائل ---------- */

function buildReactionList(reactions, me) {
  const counts = new Map();
  Object.keys(reactions || {}).forEach((uid) => {
    const e = reactions[uid];
    if (typeof e !== 'string' || !e) return;
    counts.set(e, (counts.get(e) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([emoji, count]) => ({ emoji, count, mine: !!me && reactions[me] === emoji }))
    .sort((a, b) => b.count - a.count);
}

function withDerived(m) {
  m.mine = m.senderUid === S.uid;
  m.reactionList = buildReactionList(m.reactions, S.uid);
  return m;
}

function normalizeMessage(chatId, id, d, pendingWrite = false) {
  const data = d || {};
  return withDerived({
    id,
    chatId,
    senderUid: typeof data.senderUid === 'string' ? data.senderUid : '',
    text: typeof data.text === 'string' ? data.text : '',
    createdAt: msOf(data.createdAt) || Date.now(),
    isEdited: data.isEdited === true,
    editedAt: msOf(data.editedAt),
    replyTo: data.replyTo && typeof data.replyTo === 'object' ? data.replyTo : null,
    forwardedFrom: data.forwardedFrom && typeof data.forwardedFrom === 'object' ? data.forwardedFrom : null,
    attachment: data.attachment && typeof data.attachment === 'object' ? data.attachment : null,
    reactions: data.reactions && typeof data.reactions === 'object' ? { ...data.reactions } : {},
    hiddenFor: Array.isArray(data.hiddenFor) ? data.hiddenFor : [],
    pinned: data.pinned === true,
    pinnedAt: msOf(data.pinnedAt),
    pinnedBy: typeof data.pinnedBy === 'string' ? data.pinnedBy : null,
    state: pendingWrite ? MESSAGE_STATE.SENDING : MESSAGE_STATE.SENT,
  });
}

/** الرسالة مرئية لي إذا لم أخفها ولم تسبق مسح السجل عندي. */
function isVisibleMessage(m, clearedAt) {
  if (!S.uid) return false;
  if (m.hiddenFor.includes(S.uid)) return false;
  if (clearedAt && m.createdAt <= clearedAt) return false;
  return true;
}

function isMessageVisibleToMe(m, chatId) {
  return isVisibleMessage(m, msOf(viewOf(chatId)?.clearedAt));
}

function currentMessage(chatId, id) {
  if (chatId !== T.chatId) return null;
  return T.server.get(id) || T.pending.get(id) || null;
}

/* ---------- إصدار الرسائل ---------- */

function emitMessages(reason) {
  const chatId = T.chatId;
  if (!chatId) return;
  const view = viewOf(chatId);
  const clearedAt = msOf(view && view.clearedAt);
  const messages = [];
  T.server.forEach((m) => {
    if (isVisibleMessage(m, clearedAt)) messages.push(m);
  });
  T.pending.forEach((m, id) => {
    if (!T.server.has(id) && isVisibleMessage(m, clearedAt)) messages.push(m);
  });
  S.failed.forEach((m) => {
    if (m.chatId === chatId && isVisibleMessage(m, clearedAt)) messages.push(m);
  });
  messages.sort(byCreated);
  const pinned = messages
    .filter((m) => m.pinned)
    .sort((a, b) => b.pinnedAt - a.pinnedAt);
  emit('messages', {
    chatId,
    reason,
    messages,
    hasOlder: T.hasOlder,
    loadingOlder: T.loadingOlder,
    pinned,
  });
}

function patchLocal(chatId, id, patch) {
  if (chatId !== T.chatId || !T.server.has(id)) return;
  const m = T.server.get(id);
  T.server.set(id, withDerived({ ...m, ...patch }));
  emitMessages('live');
}

function restoreLocal(chatId, prev) {
  if (chatId !== T.chatId) return;
  T.server.set(prev.id, withDerived({ ...prev }));
  emitMessages('live');
}

/* ---------- الاستماع للرسائل ---------- */

function stopMessages() {
  if (T.unsubMsgs) {
    try { T.unsubMsgs(); } catch (_) { /* تجاهل */ }
    T.unsubMsgs = null;
  }
}

function subscribeMessages(chatId, token) {
  stopMessages();
  const q = query(msgsCol(chatId), orderBy('createdAt', 'desc'), limit(T.limit));
  T.unsubMsgs = onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      if (token !== T.token) return;
      const next = new Map();
      snap.forEach((d) => {
        next.set(d.id, normalizeMessage(chatId, d.id, d.data(DATA_OPTS), d.metadata.hasPendingWrites));
      });
      T.server = next;
      T.hasOlder = snap.size >= T.limit;
      T.loadingOlder = false;
      T.pending.forEach((_, id) => {
        if (next.has(id)) T.pending.delete(id);
      });
      const reason = T.nextReason;
      T.nextReason = 'live';
      emitMessages(reason);
      markRead(chatId);
    },
    (err) => {
      if (token !== T.token) return;
      T.loadingOlder = false;
      emit('error', toChatError(err, 'تعذر تحميل الرسائل.'));
      emitMessages('meta');
    }
  );
}

/* ---------- تحميل الصفحات القديمة ---------- */

function loadOlder() {
  if (!T.chatId || !T.hasOlder || T.loadingOlder) return false;
  T.loadingOlder = true;
  T.nextReason = 'older';
  T.limit += CHAT_LIMITS.PAGE_SIZE;
  emitMessages('meta');
  subscribeMessages(T.chatId, T.token);
  return true;
}

/* ---------- الكتابة ---------- */

function stopTyping() {
  if (T.unsubTyping) {
    try { T.unsubTyping(); } catch (_) { /* تجاهل */ }
    T.unsubTyping = null;
  }
  if (T.typingTimer) {
    clearInterval(T.typingTimer);
    T.typingTimer = null;
  }
  T.typingAt = new Map();
}

function publishTyping(chatId, force = false) {
  if (chatId !== T.chatId) return;
  const now = Date.now();
  let changed = false;
  T.typingAt.forEach((at, uid) => {
    if (now - at >= CHAT_LIMITS.TYPING_TTL_MS) {
      T.typingAt.delete(uid);
      changed = true;
    }
  });
  const uids = [...T.typingAt.keys()];
  if (changed || force) emit('typing', { chatId, uids, isTyping: uids.length > 0 });
  if (uids.length && !T.typingTimer) {
    T.typingTimer = setInterval(() => publishTyping(chatId), 1000);
  } else if (!uids.length && T.typingTimer) {
    clearInterval(T.typingTimer);
    T.typingTimer = null;
  }
}

function subscribeTyping(chatId, token) {
  stopTyping();
  T.unsubTyping = onSnapshot(
    collection(chatRef(chatId), 'typing'),
    (snap) => {
      if (token !== T.token) return;
      const now = Date.now();
      const next = new Map();
      snap.forEach((d) => {
        if (d.id === S.uid) return;
        const at = msOf(d.data(DATA_OPTS).at) || now;
        if (now - at < CHAT_LIMITS.TYPING_TTL_MS) next.set(d.id, at);
      });
      T.typingAt = next;
      publishTyping(chatId, true);
    },
    () => { /* الكتابة ميزة ثانوية، لا نعرض خطأ */ }
  );
}

function notifyTyping(chatId = T.chatId) {
  if (!S.uid || !chatId || chatId !== T.chatId) return;
  const view = viewOf(chatId);
  if (!view || view.status !== CHAT_STATUS.ACTIVE) return;
  const now = Date.now();
  if (now - T.lastTypingSent < CHAT_LIMITS.TYPING_GAP_MS) return;
  T.lastTypingSent = now;
  setDoc(doc(collection(chatRef(chatId), 'typing'), S.uid), { at: serverTimestamp() })
    .catch(() => { /* تجاهل */ });
}

/* ---------- القراءة ---------- */

function latestFromOther() {
  let best = null;
  T.server.forEach((m) => {
    if (m.senderUid && m.senderUid !== S.uid && (!best || m.createdAt > best.createdAt)) best = m;
  });
  return best;
}

function markRead(chatId = T.chatId) {
  if (!S.uid || !chatId || chatId !== T.chatId) return;
  clearTimeout(T.readTimer);
  const last = S.readSent.get(chatId) || 0;
  const wait = Math.max(0, CHAT_LIMITS.READ_GAP_MS - (Date.now() - last));
  T.readTimer = setTimeout(() => doRead(chatId), wait);
}

function doRead(chatId) {
  T.readTimer = null;
  if (chatId !== T.chatId || !S.uid) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  const view = viewOf(chatId);
  const latest = latestFromOther();
  if (!view || !latest) return;
  if (msOf(view.readAt) >= latest.createdAt) return;
  S.readSent.set(chatId, Date.now());
  updateDoc(chatRef(chatId), { [`readAt.${S.uid}`]: serverTimestamp() })
    .catch(() => { /* تجاهل */ });
}

/* ---------- الكتابة الفعلية للرسالة ---------- */

async function writeMessage(chatId, id, body, needsRequest) {
  const batch = writeBatch(S.db);
  const payload = {
    senderUid: S.uid,
    text: body.text || '',
    createdAt: serverTimestamp(),
    isEdited: false,
    reactions: {},
    hiddenFor: [],
    pinned: false,
  };
  if (body.replyTo) payload.replyTo = body.replyTo;
  if (body.attachment) payload.attachment = body.attachment;
  if (body.forwardedFrom) payload.forwardedFrom = body.forwardedFrom;
  batch.set(msgRef(chatId, id), payload);
  const meta = {
    lastMessage: previewOf(body),
    lastMessageAt: serverTimestamp(),
    lastSenderUid: S.uid,
    lastMessageId: id,
  };
  if (needsRequest) meta.requestSent = true;
  batch.update(chatRef(chatId), meta);
  await batch.commit();
}

/* ---------- الإرسال مع الحالات وإعادة المحاولة ---------- */

async function dispatch(chatId, id, body) {
  const needsRequest = needsRequestFor(viewOf(chatId));
  const local = {
    id,
    chatId,
    senderUid: S.uid,
    mine: true,
    text: body.text || '',
    createdAt: Date.now(),
    isEdited: false,
    editedAt: 0,
    replyTo: body.replyTo || null,
    forwardedFrom: body.forwardedFrom || null,
    attachment: body.attachment || null,
    reactions: {},
    reactionList: [],
    hiddenFor: [],
    pinned: false,
    pinnedAt: 0,
    pinnedBy: null,
    state: MESSAGE_STATE.SENDING,
    _body: body,
  };
  if (chatId === T.chatId) {
    // تبقى الرسالة في pending حتى تصل إلى اللقطة (وهي تحمل hasPendingWrites ثم تُستبدل بالنسخة الخادمية)
    T.pending.set(id, local);
    emitMessages('live');
  }
  try {
    await writeMessage(chatId, id, body, needsRequest);
    return true;
  } catch (err) {
    const e = toChatError(err, 'تعذر إرسال الرسالة.');
    T.pending.delete(id);
    S.failed.set(failKey(chatId, id), { ...local, state: MESSAGE_STATE.FAILED });
    emit('send-failed', { chatId, id, message: e.message });
    if (chatId === T.chatId) emitMessages('failed');
    return false;
  }
}

function sendInternal(chatId, body) {
  if (!S.uid) {
    pushToast('danger', 'سجّل الدخول أولاً.');
    return null;
  }
  const err = sendGate(viewOf(chatId));
  if (err) {
    pushToast('danger', err);
    return null;
  }
  const id = doc(msgsCol(chatId)).id;
  dispatch(chatId, id, body);
  return id;
}

function sendText(chatId, rawText, opts = {}) {
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  if (!text) return null;
  if (text.length > CHAT_LIMITS.TEXT_MAX) {
    pushToast('danger', `الرسالة طويلة جداً (الحد ${CHAT_LIMITS.TEXT_MAX} حرف).`);
    return null;
  }
  const body = { text };
  const reply = replyPayload(opts.replyTo);
  if (reply) body.replyTo = reply;
  return sendInternal(chatId, body);
}

function sendAttachment(chatId, file, opts = {}) {
  const res = sanitizeAttachment(file);
  if (res.error) {
    pushToast('danger', res.error);
    return null;
  }
  const caption = typeof opts.text === 'string' ? opts.text.trim() : '';
  if (caption.length > CHAT_LIMITS.TEXT_MAX) {
    pushToast('danger', `النص المرفق طويل جداً (الحد ${CHAT_LIMITS.TEXT_MAX} حرف).`);
    return null;
  }
  const body = { text: caption, attachment: res.value };
  const reply = replyPayload(opts.replyTo);
  if (reply) body.replyTo = reply;
  return sendInternal(chatId, body);
}

function retrySend(chatId, id) {
  const key = failKey(chatId, id);
  const f = S.failed.get(key);
  if (!f || !f._body) return false;
  const err = sendGate(viewOf(chatId));
  if (err) {
    pushToast('danger', err);
    return false;
  }
  S.failed.delete(key);
  if (chatId === T.chatId) emitMessages('live');
  dispatch(chatId, id, f._body);
  return true;
}

function discardFailed(chatId, id) {
  if (!S.failed.delete(failKey(chatId, id))) return false;
  if (chatId === T.chatId) emitMessages('failed');
  return true;
}

/* ---------- التعديل والحذف ---------- */

async function editMessage(chatId, id, rawText) {
  const m = currentMessage(chatId, id);
  if (!m || m.senderUid !== S.uid || m.state !== MESSAGE_STATE.SENT) return false;
  const view = viewOf(chatId);
  if (!view || view.blocked || view.status === CHAT_STATUS.BLOCKED) {
    pushToast('danger', 'لا يمكن تعديل الرسالة في هذه المحادثة.');
    return false;
  }
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  if (!text && !m.attachment) {
    pushToast('danger', 'نص الرسالة فارغ.');
    return false;
  }
  if (text.length > CHAT_LIMITS.TEXT_MAX) {
    pushToast('danger', `الرسالة طويلة جداً (الحد ${CHAT_LIMITS.TEXT_MAX} حرف).`);
    return false;
  }
  if (text === m.text) return true;
  const prev = { ...m };
  patchLocal(chatId, id, { text, isEdited: true, editedAt: Date.now() });
  try {
    await updateDoc(msgRef(chatId, id), {
      text,
      isEdited: true,
      editedAt: serverTimestamp(),
    });
    if (view.lastMessageId === id) {
      updateDoc(chatRef(chatId), { lastMessage: previewOf({ text, attachment: m.attachment }) })
        .catch(() => { /* معاينة غير حرجة */ });
    }
    return true;
  } catch (err) {
    restoreLocal(chatId, prev);
    emit('error', toChatError(err, 'تعذر تعديل الرسالة.'));
    return false;
  }
}

/** بعد حذف آخر رسالة: تُحدَّث معاينة المحادثة، وإن لم تبقَ رسائل تُزال بيانات الترتيب. */
async function refreshPreviewAfterDelete(chatId, deletedId) {
  const snap = await getDocs(query(msgsCol(chatId), orderBy('createdAt', 'desc'), limit(2)));
  const remaining = [];
  snap.forEach((d) => {
    if (d.id !== deletedId) remaining.push(normalizeMessage(chatId, d.id, d.data(DATA_OPTS), false));
  });
  const last = remaining[0];
  if (last) {
    await updateDoc(chatRef(chatId), {
      lastMessage: previewOf(last),
      lastMessageAt: Timestamp.fromMillis(last.createdAt),
      lastSenderUid: last.senderUid,
      lastMessageId: last.id,
    });
  } else {
    await updateDoc(chatRef(chatId), {
      lastMessage: '',
      lastMessageId: deleteField(),
      lastMessageAt: deleteField(),
      lastSenderUid: deleteField(),
    });
  }
}

async function deleteForEveryone(chatId, id) {
  if (S.failed.has(failKey(chatId, id))) return discardFailed(chatId, id);
  const m = currentMessage(chatId, id);
  if (!m || m.senderUid !== S.uid) {
    pushToast('danger', 'يمكنك حذف رسائلك فقط للجميع.');
    return false;
  }
  const view = viewOf(chatId);
  const wasLast = !!view && view.lastMessageId === id;
  const prev = { ...m };
  T.server.delete(id);
  T.pending.delete(id);
  emitMessages('live');
  try {
    await deleteDoc(msgRef(chatId, id));
  } catch (err) {
    T.server.set(id, prev);
    emitMessages('live');
    emit('error', toChatError(err, 'تعذر حذف الرسالة.'));
    return false;
  }
  if (wasLast) refreshPreviewAfterDelete(chatId, id).catch(() => { /* معاينة غير حرجة */ });
  return true;
}

async function deleteForMe(chatId, id) {
  if (!S.uid) return false;
  if (S.failed.has(failKey(chatId, id))) return discardFailed(chatId, id);
  const m = currentMessage(chatId, id);
  if (!m) return false;
  const prev = { ...m };
  T.server.delete(id);
  T.pending.delete(id);
  emitMessages('live');
  try {
    await updateDoc(msgRef(chatId, id), { hiddenFor: arrayUnion(S.uid) });
    return true;
  } catch (err) {
    T.server.set(id, prev);
    emitMessages('live');
    emit('error', toChatError(err, 'تعذر إخفاء الرسالة.'));
    return false;
  }
}

/* ---------- التفاعلات ---------- */

function emojiOk(e) {
  const v = typeof e === 'string' ? e.trim() : '';
  return v && v.length <= CHAT_LIMITS.EMOJI_MAX_LEN ? v : '';
}

function applyReaction(chatId, id, emoji) {
  if (!S.uid) return false;
  const m = currentMessage(chatId, id);
  if (!m || m.state !== MESSAGE_STATE.SENT) return false;
  const view = viewOf(chatId);
  if (!view || view.status !== CHAT_STATUS.ACTIVE) {
    pushToast('info', 'التفاعل متاح في المحادثات النشطة فقط.');
    return false;
  }
  const current = m.reactions[S.uid] || null;
  if (emoji === null && !current) return true;
  if (emoji !== null && current === emoji) return true;
  const prev = { ...m };
  const reactions = { ...m.reactions };
  if (emoji === null) delete reactions[S.uid];
  else reactions[S.uid] = emoji;
  patchLocal(chatId, id, { reactions });
  const ref = msgRef(chatId, id);
  const write = emoji === null
    ? updateDoc(ref, { [`reactions.${S.uid}`]: deleteField() })
    : updateDoc(ref, { [`reactions.${S.uid}`]: emoji });
  write.catch((err) => {
    restoreLocal(chatId, prev);
    emit('error', toChatError(err, 'تعذر تحديث التفاعل.'));
  });
  return true;
}

function setReaction(chatId, id, emoji) {
  const e = emojiOk(emoji);
  return e ? applyReaction(chatId, id, e) : false;
}

function removeReaction(chatId, id) {
  return applyReaction(chatId, id, null);
}

function toggleReaction(chatId, id, emoji) {
  const e = emojiOk(emoji);
  if (!e) return false;
  const m = currentMessage(chatId, id);
  if (m && m.reactions[S.uid] === e) return applyReaction(chatId, id, null);
  return applyReaction(chatId, id, e);
}

/* ---------- التثبيت ---------- */

function setPinned(chatId, id, on) {
  if (!S.uid) return false;
  const m = currentMessage(chatId, id);
  if (!m || m.state !== MESSAGE_STATE.SENT) return false;
  const view = viewOf(chatId);
  if (!view || view.status !== CHAT_STATUS.ACTIVE) {
    pushToast('info', 'التثبيت متاح في المحادثات النشطة فقط.');
    return false;
  }
  if (m.pinned === on) return true;
  const prev = { ...m };
  patchLocal(chatId, id, on
    ? { pinned: true, pinnedAt: Date.now(), pinnedBy: S.uid }
    : { pinned: false, pinnedAt: 0, pinnedBy: null });
  const data = on
    ? { pinned: true, pinnedAt: serverTimestamp(), pinnedBy: S.uid }
    : { pinned: false, pinnedAt: deleteField(), pinnedBy: deleteField() };
  updateDoc(msgRef(chatId, id), data).catch((err) => {
    restoreLocal(chatId, prev);
    emit('error', toChatError(err, 'تعذر تحديث التثبيت.'));
  });
  return true;
}

/* ---------- إعادة التوجيه ---------- */

async function getSourceMessage(chatId, id) {
  const cached =
    (chatId === T.chatId && (T.server.get(id) || T.pending.get(id))) ||
    S.failed.get(failKey(chatId, id)) ||
    null;
  if (cached) return cached;
  const snap = await getDoc(msgRef(chatId, id));
  if (!snap.exists()) return null;
  return normalizeMessage(chatId, id, snap.data(DATA_OPTS), snap.metadata.hasPendingWrites);
}

async function forwardMessage(srcChatId, msgId, targetChatIds = []) {
  if (!S.uid) return 0;
  const targets = [...new Set(targetChatIds)]
    .filter((c) => typeof c === 'string' && c)
    .slice(0, CHAT_LIMITS.MAX_FORWARD_TARGETS);
  if (!targets.length) return 0;

  let src = null;
  try {
    src = await getSourceMessage(srcChatId, msgId);
  } catch (err) {
    emit('error', toChatError(err, 'تعذر تحميل الرسالة.'));
    return 0;
  }
  // لا تُعاد توجيه رسالة أخفيتها عن نفسي أو مسحتُ سجلها
  if (!src || !isMessageVisibleToMe(src, srcChatId)) {
    pushToast('danger', 'الرسالة لم تعد متاحة.');
    return 0;
  }

  let attachment = null;
  if (src.attachment) {
    const res = sanitizeAttachment(src.attachment);
    if (res.error) {
      pushToast('danger', res.error);
      return 0;
    }
    attachment = res.value;
  }

  const originSender = src.forwardedFrom?.senderUid || src.senderUid;
  const originName = src.forwardedFrom?.name || nameOf(originSender);
  const forwardedFrom = {
    name: clip(String(originName || 'مستخدم'), CHAT_LIMITS.FORWARD_NAME_MAX) || 'مستخدم',
    senderUid: String(originSender || '').slice(0, 128),
  };

  const ready = [];
  let skipped = 0;
  targets.forEach((cid) => {
    if (sendGate(viewOf(cid))) {
      skipped += 1;
      return;
    }
    ready.push(cid);
  });

  const body = { text: src.text || '', forwardedFrom };
  if (attachment) body.attachment = attachment;
  if (!body.text && !body.attachment) return 0;

  const results = await Promise.all(ready.map((cid) => {
    const id = doc(msgsCol(cid)).id;
    return dispatch(cid, id, body);
  }));
  const ok = results.filter(Boolean).length;
  if (ok) pushToast('success', `تمت إعادة التوجيه إلى ${ok} محادثة.`);
  if (skipped) pushToast('info', `تم تخطي ${skipped} محادثة لا تسمح بالإرسال حالياً.`);
  return ok;
}

/* ---------- حالة الحظر من جهتي ---------- */

/**
 * عند فتح محادثة محظورة بعد إعادة التحميل، نتحقق من وجود سجل الحظر باسمي
 * لنعرف هل أنا الحاظر أم الطرف الآخر.
 */
async function ensureBlockOwner(chatId, d) {
  const uid = S.uid;
  if (!uid || !d || d.status !== CHAT_STATUS.BLOCKED) {
    S.blockedByMe.delete(chatId);
    return;
  }
  if (S.blockedByMe.get(chatId) === true) return;
  const otherUid = otherOf(d, uid);
  if (!otherUid) return;
  const snap = await getDoc(blockRef(uid, otherUid)).catch(() => null);
  if (snap?.exists()) S.blockedByMe.set(chatId, true);
}

/* ---------- فتح المحادثة وإغلاقها ---------- */

function leaveChat(emitNull = true) {
  const prev = T.chatId;
  stopMessages();
  stopTyping();
  clearTimeout(T.readTimer);
  T.readTimer = null;
  T.token += 1;
  T.chatId = null;
  T.server = new Map();
  T.pending = new Map();
  T.hasOlder = false;
  T.loadingOlder = false;
  T.nextReason = 'init';
  T.limit = CHAT_LIMITS.PAGE_SIZE;
  T.lastTypingSent = 0;
  T.viewKey = '';
  S.active = null;
  if (prev) {
    emit('typing', { chatId: prev, uids: [], isTyping: false });
    emit('messages', { chatId: prev, reason: 'meta', messages: [], hasOlder: false, loadingOlder: false, pinned: [] });
  }
  if (emitNull) emit('chat:active', null);
}

async function openChat(chatId) {
  if (!S.uid) {
    pushToast('danger', 'سجّل الدخول أولاً.');
    return false;
  }
  if (typeof chatId !== 'string' || !chatId) return false;
  if (S.active && S.active.id === chatId) {
    announceActive();
    return true;
  }

  const seq = ++T.openSeq;
  leaveChat(false);

  let view = viewOf(chatId);
  if (!view) {
    try {
      await readChat(chatId);
    } catch (_) { /* يُتحقق منه أدناه */ }
    if (seq !== T.openSeq) return false;
    view = viewOf(chatId);
  }
  if (!view) {
    pushToast('danger', 'هذه المحادثة غير متاحة.');
    return false;
  }

  if (view.blocked && !S.blockedByMe.has(chatId)) {
    try {
      await ensureBlockOwner(chatId, S.chatDocs.get(chatId));
    } catch (_) { /* نعرض الحالة الافتراضية */ }
    if (seq !== T.openSeq) return false;
    view = viewOf(chatId) || view;
  }

  T.chatId = chatId;
  T.token += 1;
  const token = T.token;
  T.limit = CHAT_LIMITS.PAGE_SIZE;
  T.hasOlder = false;
  T.loadingOlder = false;
  T.nextReason = 'init';
  T.server = new Map();
  T.pending = new Map();
  T.viewKey = '';
  S.active = { id: chatId, otherUid: view.otherUid };

  announceActive();
  subscribeMessages(chatId, token);
  subscribeTyping(chatId, token);
  emitChatsNow(); // لتحديث الرؤية وغير المقروء للمحادثة المفتوحة
  return true;
}

async function openDirect(otherUid) {
  if (!S.uid) {
    pushToast('danger', 'سجّل الدخول أولاً.');
    return null;
  }
  if (!otherUid || otherUid === S.uid) {
    pushToast('danger', 'لا يمكن فتح محادثة مع هذا الحساب.');
    return null;
  }
  try {
    const res = await ensureChat(otherUid);
    const id = res && res.id ? res.id : chatIdFor(S.uid, otherUid);
    const ok = await openChat(id);
    return ok ? id : null;
  } catch (err) {
    emit('error', toChatError(err, 'تعذر فتح المحادثة.'));
    return null;
  }
}

function closeChat() {
  leaveChat(true);
  emitChatsNow(); // المحادثة الفارغة المؤقتة تختفي من القائمة عند الإغلاق
}

/* إغلاق كامل (يُستدعى من resetSession عند تسجيل الخروج) */
function closeActive() {
  leaveChat(true);
  S.failed.clear();
  S.readSent.clear();
}

/* ---------- مراقبة تغيّر المحادثة النشطة ---------- */

function onChatsChanged() {
  if (!T.chatId || !S.active) return;
  const view = viewOf(T.chatId);
  if (!view) {
    // المحادثة المفتوحة اختفت من الخادم تماماً (حذف من الطرف الآخر أو إزالة)
    leaveChat(true);
    pushToast('info', 'لم تعد المحادثة متاحة.');
    return;
  }
  const key = [
    msOf(view.clearedAt),
    view.status,
    !!view.blockedByMe,
    !!view.requestSent,
    view.otherUid,
  ].join('|');
  if (key === T.viewKey) return;
  T.viewKey = key;
  S.active.otherUid = view.otherUid;
  announceActive();
  emitMessages('meta');
}

on('chats', onChatsChanged);

/* عند عودة التبويب للظهور تُرسل إيصالات القراءة المؤجلة */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) markRead();
  });
}

/* ---------- الإجراءات الإضافية للرسائل ---------- */

function getMessage(chatId, id) {
  return currentMessage(chatId, id);
}

/* ---------- الواجهة العامة ---------- */

export { on };

export const ChatCore = Object.freeze({
  init,
  on,
  constants: Object.freeze({ CHAT_LIMITS, CHAT_STATUS, MESSAGE_STATE, ATTACH_KINDS }),

  // قائمة المحادثات والإجراءات (الجزء 1)
  ensureChat,
  acceptRequest,
  declineRequest,
  blockUser,
  unblockUser,
  setPrefs,
  archiveChat,
  unarchiveChat,
  pinChat,
  muteChat,
  deleteChatForMe,
  clearHistoryForMe,
  restoreChat,

  // المحادثة النشطة
  openChat,
  openDirect,
  closeChat,
  getActive: () => (S.active ? { ...S.active, chat: viewOf(S.active.id) || null } : null),
  getMessage,
  loadOlder,
  markRead,
  notifyTyping,

  // الإرسال
  sendText,
  sendAttachment,
  retrySend,
  discardFailed,

  // إدارة الرسائل
  editMessage,
  deleteForEveryone,
  deleteForMe,
  setReaction,
  removeReaction,
  toggleReaction,
  pinMessage: (chatId, id) => setPinned(chatId, id, true),
  unpinMessage: (chatId, id) => setPinned(chatId, id, false),
  forwardMessage,
});
