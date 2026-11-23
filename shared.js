// ClearNote shared.js v4.0 — Chat System
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, collection, getDocs, addDoc, query, where, orderBy, limit, startAfter, onSnapshot, writeBatch, increment, arrayUnion, arrayRemove, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCHspBBXBG8DmLPOfKcqE8H8SmAjw5HGpQ",
  authDomain: "clearnote-aefcb.firebaseapp.com",
  projectId: "clearnote-aefcb",
  storageBucket: "clearnote-aefcb.firebasestorage.app",
  messagingSenderId: "909239922660",
  appId: "1:909239922660:web:1db0fbc92c419aa13a21f1"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const ROLES = { ADMIN: "admin", STUDENT: "student", TA: "ta", DOCTOR: "doctor" };

/* ============================================================
   Cloudinary — رفع الصور والملفات والفيديو والصوت
   ============================================================ */
const CLOUDINARY_CLOUD_NAME = "nopxs3zt";
const CLOUDINARY_UPLOAD_PRESET = "clearnote_unsigned";

const LIMITS = {
  avatar: 10 * 1024 * 1024,
  post: 10 * 1024 * 1024,
  pdf: 10 * 1024 * 1024,
  chat_image: 10 * 1024 * 1024,
  chat_file: 10 * 1024 * 1024,
  chat_voice: 10 * 1024 * 1024,
  video: 100 * 1024 * 1024
};

async function cloudinaryUpload(file, resourceType, folder, onProgress) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  fd.append('folder', folder);
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;

  if (onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText).secure_url); }
          catch { reject(new Error('استجابة غير متوقعة')); }
        } else reject(new Error('فشل الرفع'));
      });
      xhr.addEventListener('error', () => reject(new Error('فشل الاتصال')));
      xhr.send(fd);
    });
  }

  const res = await fetch(url, { method: 'POST', body: fd });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || 'فشل الرفع'); }
  return (await res.json()).secure_url;
}

export async function uploadToCloudinary(file, type = 'post', onProgress) {
  if (!file) throw new Error('لم يتم اختيار ملف');
  const maxSize = LIMITS[type] || LIMITS.post;
  if (file.size > maxSize) throw new Error(`حجم الملف كبير (الحد ${(maxSize/1024/1024).toFixed(0)} ميجا)`);

  let rt = 'image';
  let folder = 'clearnote/posts';
  if (file.type === 'application/pdf' || type === 'pdf' || type === 'chat_file') { rt = 'raw'; folder = 'clearnote/files'; }
  else if (file.type.startsWith('video/') || type === 'video') { rt = 'video'; folder = 'clearnote/videos'; }
  else if (file.type.startsWith('audio/') || type === 'chat_voice') { rt = 'video'; folder = 'clearnote/voice'; }
  else if (file.type.startsWith('image/')) { rt = 'image'; folder = type === 'avatar' ? 'clearnote/avatars' : 'clearnote/images'; }
  else if (type === 'chat_file') { rt = 'raw'; folder = 'clearnote/files'; }
  else throw new Error('نوع غير مدعوم');

  return cloudinaryUpload(file, rt, folder, onProgress);
}

export async function uploadAvatar(file) { return uploadToCloudinary(file, 'avatar'); }
export async function uploadVideo(file, onProgress) { return uploadToCloudinary(file, 'video', onProgress); }
export async function uploadChatImage(file) { return uploadToCloudinary(file, 'chat_image'); }
export async function uploadChatFile(file) { return uploadToCloudinary(file, 'chat_file'); }
export async function uploadVoice(blob) {
  if (!blob) throw new Error('لا يوجد تسجيل');
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: blob.type || 'audio/webm' });
  return cloudinaryUpload(file, 'video', 'clearnote/voice');
}

/* ============================================================
   Utilities
   ============================================================ */
export function showToast(msg, type = "success") {
  const t = document.createElement("div");
  t.style.cssText = `position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:${type === "error" ? "#b91c1c" : "#1f6b45"};color:white;padding:14px 28px;border-radius:10px;font-family:'Cairo',sans-serif;font-size:15px;font-weight:bold;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:90%;text-align:center;`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
export function escapeHtml(t) {
  if (!t) return '';
  return String(t).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
export function withTimeout(promise, ms = 10000, label = '') {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('انتهت المهلة: ' + label)), ms))]);
}
export function toDate(v) {
  try { if (!v) return null; return v.toDate ? v.toDate() : new Date(v); }
  catch { return null; }
}
export function formatChatTime(date) {
  if (!date) return '';
  const d = date.toDate ? date.toDate() : new Date(date);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'الآن';
  if (diff < 3600000) return Math.floor(diff/60000) + ' د';
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'أمس';
  if (diff < 7 * 86400000) return d.toLocaleDateString('ar-EG', { weekday: 'short' });
  return d.toLocaleDateString('ar-EG', { day: '2-digit', month: 'short' });
}

/* ============================================================
   Auth & Users (unchanged)
   ============================================================ */
export async function signUp(email, password, name, extraData = {}) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await setDoc(doc(db, "users", cred.user.uid), {
    uid: cred.user.uid, email, name, ...extraData,
    followersCount: 0, followingCount: 0, postsCount: 0,
    isVerified: false, verifiedUntil: null,
    privacy: { bio: 'public', phone: 'private', uniEmail: 'private', university: 'public' },
    chatPrivacy: {
      messageRequestPolicy: 'everyone',
      allowGroupInvites: 'everyone',
      showOnlineStatus: 'everyone',
      showReadReceipts: 'everyone'
    },
    createdAt: serverTimestamp()
  });
  await createAdminNotification('new_student', 'طالب جديد', `${name} سجّل حساب (${extraData.role === 'ta' ? 'معيد' : extraData.role === 'doctor' ? 'دكتور' : 'طالب'})`, 'admin.html', { uid: cred.user.uid }).catch(() => {});
  return cred.user;
}
export async function signIn(email, password) { return (await signInWithEmailAndPassword(auth, email, password)).user; }
export async function signOutUser() { await signOut(auth); }
export async function getUserData(uid) {
  try { const s = await getDoc(doc(db, "users", uid)); return s.exists() ? { id: uid, ...s.data() } : null; }
  catch (e) { console.warn('getUserData failed:', e); return null; }
}
export function onAuth(cb) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) return cb(null, null);
    cb(user, await getUserData(user.uid));
  });
}
export function isAdmin(u) { return u && u.role === 'admin'; }
export function goTo(page) { window.location.href = page; }

/* ============================================================
   Device Fingerprint (v2)
   ============================================================ */
const FP_STORAGE_KEY = 'clearnote_device_fp_v2';
export async function getDeviceFingerprint() {
  try {
    let fp = localStorage.getItem(FP_STORAGE_KEY);
    if (fp && fp.length >= 20) return fp;
  } catch (e) {}
  try {
    const random = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const raw = `${random}|${navigator.platform || 'x'}|${navigator.hardwareConcurrency || 0}|${(Intl.DateTimeFormat().resolvedOptions().timeZone || 'x').replace(/[^a-zA-Z]/g, '')}`;
    const buf = new TextEncoder().encode(raw);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    const fp = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    try { localStorage.setItem(FP_STORAGE_KEY, fp); } catch (e) {}
    return fp;
  } catch (e) {
    const fb = 'fb-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem(FP_STORAGE_KEY, fb); } catch (e) {}
    return fb;
  }
}

export async function checkDeviceStatus(uid) {
  const fp = await getDeviceFingerprint();
  const devRef = doc(db, 'devices', uid, 'list', fp);
  try {
    const devSnap = await getDoc(devRef);
    if (devSnap.exists()) {
      await updateDoc(devRef, { lastSeen: serverTimestamp() }).catch(() => {});
      const d = devSnap.data();
      return { status: d.status, fp, isPrimary: d.isPrimary || false };
    }
    const snap = await getDocs(collection(db, 'devices', uid, 'list'));
    const existing = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const approvedCount = existing.filter(d => d.status === 'approved').length;
    const autoApprove = existing.length === 0 || approvedCount === 0;
    const newStatus = autoApprove ? 'approved' : 'pending';
    const isPrimary = existing.length === 0;
    await setDoc(devRef, {
      deviceId: fp, userAgent: navigator.userAgent, platform: navigator.platform || '',
      status: newStatus, isPrimary,
      createdAt: serverTimestamp(), lastSeen: serverTimestamp()
    });
    if (!autoApprove) {
      const userData = await getUserData(uid);
      await createAdminNotification('new_device', 'طلب جهاز جديد', `${userData?.name || 'طالب'} يحاول الدخول من جهاز جديد`, 'admin.html', { uid, deviceId: fp, kind: 'device' }).catch(() => {});
    }
    return { status: newStatus, fp, isPrimary };
  } catch (e) {
    console.warn('checkDeviceStatus failed:', e);
    return { status: 'approved', fp, isPrimary: false };
  }
}

/* ============================================================
   Profile History
   ============================================================ */
export const PRIVACY_FIELDS = ['bio', 'phone', 'uniEmail', 'university'];
export const PRIVACY_OPTIONS = ['public', 'followers', 'private'];
export const DEFAULT_PRIVACY = { bio: 'public', phone: 'private', uniEmail: 'private', university: 'public' };
export const FIELD_LABELS_AR = {
  name: 'الاسم', bio: 'النبذة', phone: 'رقم الهاتف', uniEmail: 'البريد الجامعي',
  university: 'الجامعة', username: 'اسم المستخدم', avatarUrl: 'الصورة الشخصية',
  nationalId: 'الرقم القومي', privacy: 'الخصوصية'
};

export async function updateUserProfile(uid, updates, editedBy = 'self') {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) throw new Error('المستخدم غير موجود');
  const oldData = userSnap.data();
  const batch = writeBatch(db);
  const changedFields = [];

  Object.keys(updates).forEach(key => {
    const oldVal = oldData[key];
    const newVal = updates[key];
    if (JSON.stringify(oldVal || '') === JSON.stringify(newVal || '')) return;
    changedFields.push(key);
    const histRef = doc(collection(db, 'users', uid, 'profile_history'));
    batch.set(histRef, {
      field: key, fieldLabel: FIELD_LABELS_AR[key] || key,
      oldValue: oldVal ?? null, newValue: newVal ?? null,
      editedAt: serverTimestamp(), editedBy
    });
  });

  if (changedFields.length === 0) return [];
  const finalUpdates = { ...updates, updatedAt: serverTimestamp() };
  if (updates.privacy && oldData.privacy) finalUpdates.privacy = { ...oldData.privacy, ...updates.privacy };
  if (updates.chatPrivacy && oldData.chatPrivacy) finalUpdates.chatPrivacy = { ...oldData.chatPrivacy, ...updates.chatPrivacy };
  batch.update(userRef, finalUpdates);
  await batch.commit();
  return changedFields;
}

export async function getProfileHistory(uid, max = 50) {
  try {
    const q = query(collection(db, 'users', uid, 'profile_history'), orderBy('editedAt', 'desc'), limit(max));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.warn('getProfileHistory failed:', e); return []; }
}

export function canViewField(field, targetUser, viewerUid, isFollowing) {
  if (!targetUser) return false;
  if (field === 'nationalId') return false;
  if (targetUser.uid === viewerUid) return true;
  const priv = targetUser.privacy?.[field] || DEFAULT_PRIVACY[field] || 'public';
  if (priv === 'public') return true;
  if (priv === 'followers') return !!isFollowing;
  return false;
}

/* ============================================================
   Subscriptions
   ============================================================ */
export async function requestSubscription(uid, userName, subjectId, subjectName, notes) {
  const ref = doc(collection(db, 'subscription_requests'));
  await setDoc(ref, { id: ref.id, uid, userName, subjectId, subjectName, notes, status: 'pending', createdAt: serverTimestamp() });
  await createAdminNotification('new_subscription_request', 'طلب اشتراك جديد', `${userName} يطلب الاشتراك في "${subjectName}"`, 'admin.html', { reqId: ref.id, uid, kind: 'subscription' }).catch(() => {});
  return ref.id;
}
export async function activateSubscription(uid, subjectId, durationDays = 30) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + durationDays);
  await setDoc(doc(db, 'subscriptions', `${uid}_${subjectId}`), {
    uid, subjectId, status: 'active', createdAt: serverTimestamp(), expiresAt
  });
}

/* ============================================================
   Follow
   ============================================================ */
export async function followUser(myUid, targetUid) {
  if (myUid === targetUid) throw new Error('لا يمكن متابعة نفسك');
  await setDoc(doc(db, 'follows', `${myUid}_${targetUid}`), { followerUid: myUid, followedUid: targetUid, createdAt: serverTimestamp() });
  await updateDoc(doc(db, 'users', myUid), { followingCount: increment(1) });
  await updateDoc(doc(db, 'users', targetUid), { followersCount: increment(1) });
}
export async function unfollowUser(myUid, targetUid) {
  await deleteDoc(doc(db, 'follows', `${myUid}_${targetUid}`));
  await updateDoc(doc(db, 'users', myUid), { followingCount: increment(-1) });
  await updateDoc(doc(db, 'users', targetUid), { followersCount: increment(-1) });
}
export async function checkIfFollowing(myUid, targetUid) {
  try { return (await getDoc(doc(db, 'follows', `${myUid}_${targetUid}`))).exists(); }
  catch (e) { return false; }
}

/* ============================================================
   Verification
   ============================================================ */
export async function requestVerification(uid, userName, role, type, plan, price, durationDays, notes) {
  try {
    const snap = await getDocs(query(collection(db, 'verification_requests'), where('uid', '==', uid)));
    if (snap.docs.some(d => d.data().status === 'pending')) throw new Error('لديك طلب قيد المراجعة');
  } catch (e) { if (e.message.includes('قيد المراجعة')) throw e; }
  const ref = doc(collection(db, 'verification_requests'));
  await setDoc(ref, { id: ref.id, uid, userName, role, type, plan, price, durationDays, notes, status: 'pending', createdAt: serverTimestamp() });
  const roleLabel = role === 'ta' ? 'معيد' : role === 'doctor' ? 'دكتور' : 'طالب';
  await createAdminNotification(
    'new_verification_request',
    type === 'free' ? 'طلب توثيق مجاني' : 'طلب توثيق مدفوع',
    `${userName} (${roleLabel}) - ${type === 'free' ? 'مجاني' : `${plan} - ${price}ج`}`,
    'admin.html', { reqId: ref.id, uid, kind: 'verification' }
  ).catch(() => {});
  return ref.id;
}
export async function activateVerification(uid, durationDays) {
  const updates = { isVerified: true, verifiedAt: serverTimestamp() };
  if (durationDays > 0) { const e = new Date(); e.setDate(e.getDate() + durationDays); updates.verifiedUntil = e; }
  else updates.verifiedUntil = null;
  await updateDoc(doc(db, 'users', uid), updates);
}
export async function rejectVerification(reqId, uid, reason = '') {
  await updateDoc(doc(db, 'verification_requests', reqId), { status: 'rejected', rejectReason: reason, reviewedAt: serverTimestamp() });
  await createNotification(uid, 'verification_rejected', '❌ تم رفض طلب التوثيق', reason || 'تواصل مع الإدارة', 'profile.html');
}
export async function checkPendingVerification(uid) {
  try {
    const snap = await getDocs(query(collection(db, 'verification_requests'), where('uid', '==', uid)));
    return snap.docs.some(d => d.data().status === 'pending');
  } catch (e) { return false; }
}

/* ============================================================
   Notifications
   ============================================================ */
export async function createNotification(uid, type, title, message, link = '', meta = {}) {
  const ref = doc(collection(db, 'notifications', uid, 'items'));
  await setDoc(ref, { id: ref.id, type, title, message, link, meta, read: false, createdAt: serverTimestamp() });
  return ref.id;
}
export async function createAdminNotification(type, title, message, link = '', meta = {}) {
  const ref = doc(collection(db, 'admin_notifications'));
  await setDoc(ref, { id: ref.id, type, title, message, link, meta, read: false, createdAt: serverTimestamp() });
  return ref.id;
}
export function listenUserNotifications(uid, cb) {
  const q = query(collection(db, 'notifications', uid, 'items'), orderBy('createdAt', 'desc'), limit(50));
  return onSnapshot(q, s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), e => { console.warn(e); cb([]); });
}
export function listenAdminNotifications(cb) {
  const q = query(collection(db, 'admin_notifications'), orderBy('createdAt', 'desc'), limit(80));
  return onSnapshot(q, s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), e => { console.warn(e); cb([]); });
}
export async function markNotificationRead(uid, id) { await updateDoc(doc(db, 'notifications', uid, 'items', id), { read: true }); }
export async function markAdminNotificationRead(id) { await updateDoc(doc(db, 'admin_notifications', id), { read: true }); }
export async function markAllNotificationsRead(uid, notifs) {
  const b = writeBatch(db); let c = false;
  notifs.forEach(n => { if (!n.read) { b.update(doc(db, 'notifications', uid, 'items', n.id), { read: true }); c = true; } });
  if (c) await b.commit();
}
export async function markAllAdminNotificationsRead(notifs) {
  const b = writeBatch(db); let c = false;
  notifs.forEach(n => { if (!n.read) { b.update(doc(db, 'admin_notifications', n.id), { read: true }); c = true; } });
  if (c) await b.commit();
}
export async function deleteNotification(uid, id) { await deleteDoc(doc(db, 'notifications', uid, 'items', id)); }
export async function deleteAdminNotification(id) { await deleteDoc(doc(db, 'admin_notifications', id)); }

/* ============================================================
   Subscriptions & Devices Listeners (existing)
   ============================================================ */
export function listenUserSubscriptions(uid, cb) {
  const q = query(collection(db, 'subscriptions'), where('uid', '==', uid));
  return onSnapshot(q, snap => {
    const subs = {};
    snap.forEach(d => {
      const data = d.data();
      if (data.status === 'active' && data.expiresAt) {
        try {
          const exp = data.expiresAt.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
          if (exp > new Date()) subs[data.subjectId] = data;
        } catch (e) {}
      }
    });
    cb(subs);
  }, e => { console.warn(e); cb({}); });
}
export function listenUserDevices(uid, cb) {
  return onSnapshot(collection(db, 'devices', uid, 'list'), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), e => { console.warn(e); cb([]); });
}

/* ============================================================
   ✅ CHAT SYSTEM — Conversations
   ============================================================ */

/**
 * إنشاء محادثة جديدة (مجموعة، قناة، غرفة مذاكرة، أو DM)
 * @returns {convId, isNew}
 */
export async function createConversation(uid, data) {
  const {
    type, name, description = '', avatarUrl = '',
    visibility = 'public',
    memberUids = [],  // يستثني المالك (يُضاف تلقائياً)
    settings = {},
    studyRoom = null
  } = data;

  if (!['group', 'channel', 'study_room', 'dm'].includes(type)) throw new Error('نوع غير صالح');

  const userData = await getUserData(uid);
  if (!userData) throw new Error('المستخدم غير موجود');

  const convRef = doc(collection(db, 'conversations'));

  const defaultSettings = {
    whoCanWrite: type === 'channel' ? 'admins' : 'all',
    whoCanInvite: 'all',
    whoCanPost: 'all',
    mediaEnabled: true,
    voiceEnabled: true,
    defaultNotifMode: 'all',
    ...settings
  };

  const convData = {
    type, name: name || 'بدون اسم', description, avatarUrl,
    ownerUid: uid, ownerName: userData.name || '',
    visibility,
    memberCount: 1 + memberUids.length,
    memberUids: [uid, ...memberUids.filter(u => u !== uid)],
    settings: defaultSettings,
    pinnedMessageIds: [],
    lastMessageAt: serverTimestamp(),
    lastMessagePreview: 'تم إنشاء المحادثة',
    lastMessageSender: userData.name || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  if (studyRoom) convData.studyRoom = studyRoom;

  await setDoc(convRef, convData);

  const batch = writeBatch(db);
  const myMemRef = doc(db, 'conversations', convRef.id, 'members', uid);
  batch.set(myMemRef, {
    uid, role: 'owner', joinedAt: serverTimestamp(),
    lastReadAt: serverTimestamp(), notifMode: 'all', isPinned: false
  });

  memberUids.filter(u => u !== uid).forEach(muid => {
    const memRef = doc(db, 'conversations', convRef.id, 'members', muid);
    batch.set(memRef, {
      uid: muid, role: 'member', joinedAt: serverTimestamp(),
      lastReadAt: null, notifMode: 'all', isPinned: false
    });
    const notifRef = doc(collection(db, 'notifications', muid, 'items'));
    batch.set(notifRef, {
      id: notifRef.id, type: 'chat_added',
      title: 'أضفتك إلى محادثة',
      message: `${userData.name} أضافك إلى "${name}"`,
      link: `chat.html#/c/${convRef.id}`,
      meta: { convId: convRef.id },
      read: false, createdAt: serverTimestamp()
    });
  });

  await batch.commit();
  return { convId: convRef.id, isNew: true };
}

/**
 * الحصول على DM موجود أو إنشاء طلب مراسلة جديد.
 * @returns {convId?, requestId?, status: 'existing' | 'request_sent' | 'pending_request' | 'blocked'}
 */
export async function getOrCreateDM(uid, targetUid) {
  if (uid === targetUid) throw new Error('لا يمكن مراسلة نفسك');

  // التحقق من الحظر
  const blockedByMe = (await getDoc(doc(db, 'blocks', `${uid}_${targetUid}`))).exists();
  const blockedByThem = (await getDoc(doc(db, 'blocks', `${targetUid}_${uid}`))).exists();
  if (blockedByMe || blockedByThem) return { status: 'blocked' };

  // البحث عن DM موجود
  const existingQ = query(
    collection(db, 'conversations'),
    where('type', '==', 'dm'),
    where('memberUids', 'array-contains', uid)
  );
  const existingSnap = await getDocs(existingQ);
  for (const d of existingSnap.docs) {
    const data = d.data();
    if (data.memberUids && data.memberUids.includes(targetUid) && data.memberUids.length === 2) {
      return { convId: d.id, status: 'existing' };
    }
  }

  // التحقق من طلب معلق
  const reqQ = query(collection(db, 'message_requests'),
    where('fromUid', '==', uid),
    where('toUid', '==', targetUid),
    where('status', '==', 'pending')
  );
  const reqSnap = await getDocs(reqQ);
  if (!reqSnap.empty) return { requestId: reqSnap.docs[0].id, status: 'pending_request' };

  // التحقق من خصوصية المستلم
  const targetData = await getUserData(targetUid);
  if (!targetData) throw new Error('المستخدم غير موجود');

  const policy = targetData.chatPrivacy?.messageRequestPolicy || 'everyone';
  if (policy === 'nobody') return { status: 'blocked', reason: 'لا يقبل طلبات مراسلة' };

  if (policy === 'followers') {
    const followsThem = (await getDoc(doc(db, 'follows', `${uid}_${targetUid}`))).exists();
    const followsMe = (await getDoc(doc(db, 'follows', `${targetUid}_${uid}`))).exists();
    if (!followsThem && !followsMe) return { status: 'blocked', reason: 'يقبل المراسلة من متابعيه فقط' };
  }

  if (policy === 'friends') {
    const f1 = (await getDoc(doc(db, 'follows', `${uid}_${targetUid}`))).exists();
    const f2 = (await getDoc(doc(db, 'follows', `${targetUid}_${uid}`))).exists();
    if (!f1 || !f2) return { status: 'blocked', reason: 'يقبل المراسلة من الأصدقاء فقط' };
  }

  // إنشاء طلب مراسلة
  const reqRef = doc(collection(db, 'message_requests'));
  const myData = await getUserData(uid);
  await setDoc(reqRef, {
    id: reqRef.id, fromUid: uid, fromName: myData.name || '',
    fromAvatarUrl: myData.avatarUrl || '',
    toUid: targetUid, initialMessage: '',
    status: 'pending', createdAt: serverTimestamp()
  });

  await createNotification(targetUid, 'message_request', '📩 طلب مراسلة جديد',
    `${myData.name} يريد مراسلتك`,
    'chat.html#/requests', { requestId: reqRef.id }).catch(() => {});

  return { requestId: reqRef.id, status: 'request_sent' };
}

/**
 * قبول طلب مراسلة → ينشئ DM
 */
export async function acceptMessageRequest(reqId, myUid) {
  const reqRef = doc(db, 'message_requests', reqId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) throw new Error('الطلب غير موجود');
  const req = reqSnap.data();
  if (req.toUid !== myUid) throw new Error('غير مصرح');
  if (req.status !== 'pending') throw new Error('تم معالجة الطلب مسبقاً');

  const myData = await getUserData(myUid);

  // إنشاء DM
  const convRef = doc(collection(db, 'conversations'));
  await setDoc(convRef, {
    type: 'dm',
    name: '', description: '', avatarUrl: '',
    ownerUid: req.fromUid, ownerName: req.fromName || '',
    visibility: 'private',
    memberCount: 2,
    memberUids: [req.fromUid, myUid].sort(),
    settings: {
      whoCanWrite: 'all', whoCanInvite: 'all', whoCanPost: 'all',
      mediaEnabled: true, voiceEnabled: true, defaultNotifMode: 'all'
    },
    pinnedMessageIds: [],
    lastMessageAt: serverTimestamp(),
    lastMessagePreview: 'بدأت المحادثة',
    lastMessageSender: myData.name || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  const batch = writeBatch(db);
  batch.set(doc(db, 'conversations', convRef.id, 'members', myUid), {
    uid: myUid, role: 'member', joinedAt: serverTimestamp(),
    lastReadAt: serverTimestamp(), notifMode: 'all', isPinned: false
  });
  batch.set(doc(db, 'conversations', convRef.id, 'members', req.fromUid), {
    uid: req.fromUid, role: 'member', joinedAt: serverTimestamp(),
    lastReadAt: null, notifMode: 'all', isPinned: false
  });
  batch.update(reqRef, { status: 'accepted', reviewedAt: serverTimestamp(), convId: convRef.id });
  batch.set(doc(collection(db, 'notifications', req.fromUid, 'items')), {
    id: 'notif_' + Date.now(), type: 'message_request_accepted',
    title: '✅ تم قبول طلب المراسلة',
    message: `${myData.name} قبل طلبك`,
    link: `chat.html#/c/${convRef.id}`,
    meta: { convId: convRef.id },
    read: false, createdAt: serverTimestamp()
  });

  await batch.commit();
  return convRef.id;
}

export async function rejectMessageRequest(reqId, myUid, blockUser = false) {
  const reqRef = doc(db, 'message_requests', reqId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) throw new Error('الطلب غير موجود');
  const req = reqSnap.data();
  if (req.toUid !== myUid) throw new Error('غير مصرح');

  await updateDoc(reqRef, { status: 'rejected', reviewedAt: serverTimestamp() });

  if (blockUser) {
    await blockUser(myUid, req.fromUid);
  }
}

export function listenMessageRequests(uid, cb) {
  const q = query(collection(db, 'message_requests'),
    where('toUid', '==', uid),
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc')
  );
  return onSnapshot(q,
    s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))),
    e => { console.warn('message_requests listener error:', e); cb([]); }
  );
}

/**
 * الاستماع لكل محادثات المستخدم (real-time)
 */
export function listenUserConversations(uid, cb) {
  const q = query(
    collection(db, 'conversations'),
    where('memberUids', 'array-contains', uid),
    orderBy('lastMessageAt', 'desc'),
    limit(100)
  );
  return onSnapshot(q,
    s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))),
    e => { console.warn('conversations listener error:', e); cb([]); }
  );
}

export async function getConversation(convId) {
  const snap = await getDoc(doc(db, 'conversations', convId));
  return snap.exists() ? { id: convId, ...snap.data() } : null;
}

export function listenConversation(convId, cb) {
  return onSnapshot(doc(db, 'conversations', convId),
    s => cb(s.exists() ? { id: convId, ...s.data() } : null),
    e => { console.warn('conv listener error:', e); cb(null); }
  );
}

export function listenConversationMembers(convId, cb) {
  return onSnapshot(collection(db, 'conversations', convId, 'members'),
    s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))),
    e => { console.warn('members listener error:', e); cb([]); }
  );
}

export async function getConversationMembers(convId) {
  const snap = await getDocs(collection(db, 'conversations', convId, 'members'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getMyMembership(convId, uid) {
  const snap = await getDoc(doc(db, 'conversations', convId, 'members', uid));
  return snap.exists() ? { id: uid, ...snap.data() } : null;
}

export async function joinConversation(convId, uid) {
  const convRef = doc(db, 'conversations', convId);
  const convSnap = await getDoc(convRef);
  if (!convSnap.exists()) throw new Error('المحادثة غير موجودة');
  const conv = convSnap.data();
  if (conv.visibility === 'private' || conv.visibility === 'invite-only') throw new Error('لا يمكن الانضمام مباشرة');
  if (conv.memberUids?.includes(uid)) return;

  const userData = await getUserData(uid);
  const batch = writeBatch(db);
  batch.set(doc(db, 'conversations', convId, 'members', uid), {
    uid, role: 'member', joinedAt: serverTimestamp(),
    lastReadAt: null, notifMode: 'all', isPinned: false
  });
  batch.update(convRef, {
    memberUids: arrayUnion(uid),
    memberCount: increment(1)
  });
  await batch.commit();
}

export async function leaveConversation(convId, uid) {
  const convRef = doc(db, 'conversations', convId);
  const convSnap = await getDoc(convRef);
  if (!convSnap.exists()) return;
  const conv = convSnap.data();
  if (conv.ownerUid === uid) throw new Error('المالك لا يمكنه المغادرة — يجب تسليم الملكية أولاً');

  const batch = writeBatch(db);
  batch.delete(doc(db, 'conversations', convId, 'members', uid));
  batch.update(convRef, {
    memberUids: arrayRemove(uid),
    memberCount: increment(-1)
  });
  await batch.commit();
}

export async function kickMember(convId, targetUid, byUid) {
  const myMem = await getMyMembership(convId, byUid);
  if (!myMem || !['owner', 'admin'].includes(myMem.role)) throw new Error('غير مصرح');
  if (myMem.role === 'admin') {
    const targetMem = await getMyMembership(convId, targetUid);
    if (targetMem && targetMem.role === 'owner') throw new Error('لا يمكن طرد المالك');
  }
  const batch = writeBatch(db);
  batch.delete(doc(db, 'conversations', convId, 'members', targetUid));
  batch.update(doc(db, 'conversations', convId), {
    memberUids: arrayRemove(targetUid),
    memberCount: increment(-1)
  });
  await batch.commit();
}

export async function updateMemberRole(convId, targetUid, newRole, byUid) {
  if (!['admin', 'moderator', 'member', 'subscriber'].includes(newRole)) throw new Error('دور غير صالح');
  const myMem = await getMyMembership(convId, byUid);
  if (!myMem || myMem.role !== 'owner') throw new Error('فقط المالك يمكنه تغيير الأدوار');
  await updateDoc(doc(db, 'conversations', convId, 'members', targetUid), { role: newRole });
}

export async function updateConversationSettings(convId, updates, byUid) {
  const myMem = await getMyMembership(convId, byUid);
  if (!myMem || !['owner', 'admin'].includes(myMem.role)) throw new Error('غير مصرح');
  const convRef = doc(db, 'conversations', convId);
  const convSnap = await getDoc(convRef);
  const conv = convSnap.data();
  const finalUpdates = { ...updates, updatedAt: serverTimestamp() };
  if (updates.settings && conv.settings) finalUpdates.settings = { ...conv.settings, ...updates.settings };
  await updateDoc(convRef, finalUpdates);
}

/* ============================================================
   Invites
   ============================================================ */
function generateCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < len; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function createInviteLink(convId, options = {}) {
  const { type = 'unlimited', maxUses = null, expiresInHours = null } = options;
  const code = generateCode();
  const ref = doc(db, 'invites', code);
  const data = {
    code, convId,
    createdBy: auth.currentUser.uid,
    createdAt: serverTimestamp(),
    type, maxUses, usedCount: 0
  };
  if (expiresInHours) {
    const exp = new Date(); exp.setHours(exp.getHours() + expiresInHours);
    data.expiresAt = exp;
  }
  await setDoc(ref, data);
  return code;
}

export async function getInviteByCode(code) {
  const snap = await getDoc(doc(db, 'invites', code));
  return snap.exists() ? { id: code, ...snap.data() } : null;
}

export async function acceptInvite(code, uid) {
  const invite = await getInviteByCode(code);
  if (!invite) throw new Error('رابط غير صالح');
  if (invite.expiresAt && toDate(invite.expiresAt) < new Date()) throw new Error('انتهت صلاحية الرابط');
  if (invite.type === 'once' && invite.usedCount >= 1) throw new Error('استُخدم الرابط مسبقاً');
  if (invite.type === 'limited' && invite.usedCount >= (invite.maxUses || 0)) throw new Error('بلغ الرابط الحد الأقصى');

  await joinConversation(invite.convId, uid);
  await updateDoc(doc(db, 'invites', code), { usedCount: increment(1) });
  return invite.convId;
}

/* ============================================================
   Messages
   ============================================================ */
export async function sendMessage(convId, msgData) {
  const uid = auth.currentUser.uid;
  const userData = await getUserData(uid);
  const convRef = doc(db, 'conversations', convId);
  const convSnap = await getDoc(convRef);
  if (!convSnap.exists()) throw new Error('المحادثة غير موجودة');
  const conv = convSnap.data();

  const msgRef = doc(collection(db, 'conversations', convId, 'messages'));
  const msg = {
    id: msgRef.id,
    senderUid: uid,
    senderName: userData.name || '',
    senderAvatarUrl: userData.avatarUrl || '',
    type: msgData.type || 'text',
    content: msgData.content || '',
    media: msgData.media || null,
    replyTo: msgData.replyTo || null,
    mentions: msgData.mentions || [],
    reactions: {},
    isPinned: false, isEdited: false, isDeleted: false,
    forwardedFrom: msgData.forwardedFrom || null,
    poll: msgData.poll || null,
    quiz: msgData.quiz || null,
    task: msgData.task || null,
    createdAt: serverTimestamp()
  };

  const preview = msgData.type === 'text' ? msgData.content?.slice(0, 80) :
                  msgData.type === 'image' ? '📷 صورة' :
                  msgData.type === 'video' ? '🎥 فيديو' :
                  msgData.type === 'file' ? '📎 ملف' :
                  msgData.type === 'voice' ? '🎤 رسالة صوتية' :
                  msgData.type === 'poll' ? '📊 استطلاع' :
                  msgData.type === 'quiz' ? '❓ سؤال تفاعلي' :
                  msgData.type === 'task' ? '✅ مهمة' :
                  msgData.type === 'announcement' ? '📢 إعلان' : 'رسالة';

  const batch = writeBatch(db);
  batch.set(msgRef, msg);
  batch.update(convRef, {
    lastMessageAt: serverTimestamp(),
    lastMessagePreview: preview,
    lastMessageSender: userData.name || '',
    updatedAt: serverTimestamp()
  });
  batch.update(doc(db, 'conversations', convId, 'members', uid), { lastReadAt: serverTimestamp() });

  // إشعارات mentions
  if (msgData.mentions && msgData.mentions.length > 0) {
    msgData.mentions.forEach(muid => {
      if (muid === uid) return;
      const notifRef = doc(collection(db, 'notifications', muid, 'items'));
      batch.set(notifRef, {
        id: notifRef.id, type: 'mention',
        title: 'أشار إليك',
        message: `${userData.name}: ${preview}`,
        link: `chat.html#/c/${convId}`,
        meta: { convId, msgId: msgRef.id },
        read: false, createdAt: serverTimestamp()
      });
    });
  }

  await batch.commit();
  return msgRef.id;
}

export function listenMessages(convId, cb, max = 50) {
  const q = query(
    collection(db, 'conversations', convId, 'messages'),
    orderBy('createdAt', 'desc'),
    limit(max)
  );
  return onSnapshot(q,
    s => cb(s.docs.map(d => ({ id: d.id, ...d.data() })).reverse()),
    e => { console.warn('messages listener error:', e); cb([]); }
  );
}

export async function loadMoreMessages(convId, beforeTimestamp, max = 30) {
  const q = query(
    collection(db, 'conversations', convId, 'messages'),
    orderBy('createdAt', 'desc'),
    startAfter(beforeTimestamp),
    limit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
}

export async function editMessage(convId, msgId, newContent) {
  await updateDoc(doc(db, 'conversations', convId, 'messages', msgId), {
    content: newContent,
    isEdited: true,
    editedAt: serverTimestamp()
  });
}

export async function deleteMessage(convId, msgId, hardDelete = false) {
  if (hardDelete) {
    await deleteDoc(doc(db, 'conversations', convId, 'messages', msgId));
  } else {
    await updateDoc(doc(db, 'conversations', convId, 'messages', msgId), {
      isDeleted: true,
      content: '',
      media: null,
      deletedAt: serverTimestamp()
    });
  }
}

export async function pinMessage(convId, msgId) {
  const convRef = doc(db, 'conversations', convId);
  await updateDoc(convRef, {
    pinnedMessageIds: arrayUnion(msgId)
  });
  await updateDoc(doc(db, 'conversations', convId, 'messages', msgId), {
    isPinned: true, pinnedAt: serverTimestamp(), pinnedBy: auth.currentUser.uid
  });
}

export async function unpinMessage(convId, msgId) {
  await updateDoc(doc(db, 'conversations', convId), {
    pinnedMessageIds: arrayRemove(msgId)
  });
  await updateDoc(doc(db, 'conversations', convId, 'messages', msgId), {
    isPinned: false, pinnedAt: null, pinnedBy: null
  });
}

export async function reactToMessage(convId, msgId, emoji, uid) {
  const msgRef = doc(db, 'conversations', convId, 'messages', msgId);
  const msgSnap = await getDoc(msgRef);
  if (!msgSnap.exists()) return;
  const msg = msgSnap.data();
  const reactions = { ...(msg.reactions || {}) };
  const current = reactions[emoji] || [];
  if (current.includes(uid)) {
    reactions[emoji] = current.filter(u => u !== uid);
    if (reactions[emoji].length === 0) delete reactions[emoji];
  } else {
    reactions[emoji] = [...current, uid];
  }
  await updateDoc(msgRef, { reactions });
}

export async function markConversationRead(convId, uid) {
  try {
    await updateDoc(doc(db, 'conversations', convId, 'members', uid), { lastReadAt: serverTimestamp() });
  } catch (e) {}
}

export async function setMemberNotifMode(convId, uid, mode) {
  await updateDoc(doc(db, 'conversations', convId, 'members', uid), { notifMode: mode });
}

export async function togglePinConversation(convId, uid, pinned) {
  await updateDoc(doc(db, 'conversations', convId, 'members', uid), { isPinned: pinned });
}

/* ============================================================
   Polls, Quiz, Tasks
   ============================================================ */
export async function createPoll(convId, question, options, settings = {}) {
  const poll = {
    question,
    options: options.map((opt, i) => ({ id: 'opt_' + i, text: opt, votes: [] })),
    anonymous: settings.anonymous || false,
    multiChoice: settings.multiChoice || false,
    showLiveResults: settings.showLiveResults !== false,
    allowRevote: settings.allowRevote || false,
    totalVotes: 0,
    closedAt: null
  };
  return sendMessage(convId, { type: 'poll', poll, content: question });
}

export async function votePoll(convId, msgId, optionIds, uid) {
  const msgRef = doc(db, 'conversations', convId, 'messages', msgId);
  const msgSnap = await getDoc(msgRef);
  if (!msgSnap.exists()) throw new Error('الاستطلاع غير موجود');
  const msg = msgSnap.data();
  if (!msg.poll) throw new Error('ليس استطلاعاً');
  if (msg.poll.closedAt) throw new Error('الاستطلاع مغلق');

  const poll = { ...msg.poll };
  const alreadyVoted = poll.options.some(o => o.votes.includes(uid));
  if (alreadyVoted && !poll.allowRevote) throw new Error('صوتت مسبقاً');

  const ids = Array.isArray(optionIds) ? optionIds : [optionIds];
  if (!poll.multiChoice && ids.length > 1) throw new Error('اختيار واحد فقط');

  // إزالة صوت المستخدم من كل الخيارات
  poll.options.forEach(o => { o.votes = o.votes.filter(u => u !== uid); });
  // إضافة الصوت الجديد
  ids.forEach(id => {
    const opt = poll.options.find(o => o.id === id);
    if (opt && !opt.votes.includes(uid)) opt.votes.push(uid);
  });
  poll.totalVotes = poll.options.reduce((s, o) => s + o.votes.length, 0);

  await updateDoc(msgRef, { poll });
}

export async function createQuiz(convId, question, options, correctIdx, explanation = '', revealAt = null) {
  const quiz = {
    question, options,
    correctIdx,
    explanation,
    revealAt,
    answers: {}
  };
  return sendMessage(convId, { type: 'quiz', quiz, content: question });
}

export async function answerQuiz(convId, msgId, optionIdx, uid) {
  const msgRef = doc(db, 'conversations', convId, 'messages', msgId);
  const msgSnap = await getDoc(msgRef);
  if (!msgSnap.exists()) throw new Error('السؤال غير موجود');
  const msg = msgSnap.data();
  if (!msg.quiz) throw new Error('ليس سؤالاً');
  if (msg.quiz.answers?.[uid] !== undefined) throw new Error('أجبت مسبقاً');
  await updateDoc(msgRef, { [`quiz.answers.${uid}`]: optionIdx });
}

export async function createTask(convId, title, description, dueAt, assignedTo = 'all') {
  const task = {
    title, description,
    dueAt: dueAt || null,
    assignedTo,
    completions: []
  };
  return sendMessage(convId, { type: 'task', task, content: title });
}

export async function completeTask(convId, msgId, uid) {
  const msgRef = doc(db, 'conversations', convId, 'messages', msgId);
  const msgSnap = await getDoc(msgRef);
  if (!msgSnap.exists()) return;
  const task = msgSnap.data().task;
  if (!task) return;
  const completions = [...(task.completions || [])];
  if (completions.some(c => c.uid === uid)) return;
  completions.push({ uid, completedAt: new Date().toISOString() });
  await updateDoc(msgRef, { 'task.completions': completions });
}

/* ============================================================
   Blocks
   ============================================================ */
export async function blockUser(blockerUid, blockedUid) {
  await setDoc(doc(db, 'blocks', `${blockerUid}_${blockedUid}`), {
    blockerUid, blockedUid, createdAt: serverTimestamp()
  });
}
export async function unblockUser(blockerUid, blockedUid) {
  await deleteDoc(doc(db, 'blocks', `${blockerUid}_${blockedUid}`));
}
export async function isBlocked(blockerUid, blockedUid) {
  return (await getDoc(doc(db, 'blocks', `${blockerUid}_${blockedUid}`))).exists();
}

/* ============================================================
   Reports
   ============================================================ */
export async function reportMessage(convId, msgId, reporterUid, reason, description = '') {
  const ref = doc(collection(db, 'reports'));
  await setDoc(ref, {
    id: ref.id, reporterUid, convId, msgId, reason, description,
    status: 'pending', createdAt: serverTimestamp()
  });
  await createAdminNotification('new_report', 'بلاغ جديد',
    `بلاغ عن رسالة في محادثة`,
    'admin.html', { reportId: ref.id, convId, msgId }).catch(() => {});
  return ref.id;
}

/* ============================================================
   Study Sessions
   ============================================================ */
export async function startStudySession(convId, config, uid) {
  const { workMinutes = 25, breakMinutes = 5, cycles = 4, topic = '' } = config;
  const ref = doc(collection(db, 'conversations', convId, 'sessions'));
  const endsAt = new Date();
  endsAt.setMinutes(endsAt.getMinutes() + workMinutes);

  await setDoc(ref, {
    id: ref.id, convId, ownerUid: uid,
    workMinutes, breakMinutes, cycles, topic,
    status: 'active', phase: 'work', currentCycle: 1,
    startedAt: serverTimestamp(), endsAt,
    participants: [uid],
    completions: []
  });
  return ref.id;
}

export function listenActiveSession(convId, cb) {
  const q = query(
    collection(db, 'conversations', convId, 'sessions'),
    where('status', 'in', ['active', 'paused']),
    limit(1)
  );
  return onSnapshot(q,
    s => cb(s.empty ? null : { id: s.docs[0].id, ...s.docs[0].data() }),
    e => { console.warn('session listener:', e); cb(null); }
  );
}

export async function pauseStudySession(convId, sessionId) {
  await updateDoc(doc(db, 'conversations', convId, 'sessions', sessionId), { status: 'paused', pausedAt: serverTimestamp() });
}
export async function resumeStudySession(convId, sessionId, remainingMinutes) {
  const endsAt = new Date();
  endsAt.setMinutes(endsAt.getMinutes() + remainingMinutes);
  await updateDoc(doc(db, 'conversations', convId, 'sessions', sessionId), { status: 'active', endsAt, pausedAt: null });
}
export async function endStudySession(convId, sessionId) {
  await updateDoc(doc(db, 'conversations', convId, 'sessions', sessionId), { status: 'done', endedAt: serverTimestamp() });
}
export async function recordStudyCompletion(convId, sessionId, uid, notes = '') {
  const ref = doc(db, 'conversations', convId, 'sessions', sessionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  const completions = [...(data.completions || [])];
  completions.push({ uid, notes, completedAt: new Date().toISOString() });
  await updateDoc(ref, { completions });
}

/* ============================================================
   Chat Privacy
   ============================================================ */
export async function updateChatPrivacy(uid, updates) {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) throw new Error('المستخدم غير موجود');
  const oldData = userSnap.data();
  const newPrivacy = { ...(oldData.chatPrivacy || {}), ...updates };
  await updateDoc(userRef, { chatPrivacy: newPrivacy, updatedAt: serverTimestamp() });
  return newPrivacy;
}

/* ============================================================
   Global Search — أشخاص ومساحات ورسائل
   ============================================================ */
export async function searchUsersByName(queryText, max = 20) {
  if (!queryText || queryText.length < 2) return [];
  const q = queryText.toLowerCase();
  // Firestore doesn't support case-insensitive search natively, use >= and <=
  const snap = await getDocs(query(
    collection(db, 'users'),
    where('name', '>=', queryText),
    where('name', '<=', queryText + '\uf8ff'),
    limit(max)
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function searchConversationsByName(queryText, max = 20) {
  if (!queryText || queryText.length < 2) return [];
  const snap = await getDocs(query(
    collection(db, 'conversations'),
    where('visibility', '==', 'public'),
    where('name', '>=', queryText),
    where('name', '<=', queryText + '\uf8ff'),
    limit(max)
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ============================================================
   Helpers
   ============================================================ */
export function getConversationDisplayName(conv, myUid, otherUserData = null) {
  if (conv.type === 'dm') {
    return otherUserData?.name || conv.name || 'محادثة';
  }
  return conv.name || 'بدون اسم';
}

export function getConversationAvatar(conv, myUid, otherUserData = null) {
  if (conv.type === 'dm' && otherUserData?.avatarUrl) {
    return getAvatarUrl(otherUserData.avatarUrl, 100);
  }
  if (conv.avatarUrl) return getAvatarUrl(conv.avatarUrl, 100);
  return null;
}

export function getAvatarUrl(url, size = 100) {
  if (!url) return null;
  if (url.includes('res.cloudinary.com') && url.includes('/upload/')) {
    return url.replace('/upload/', `/upload/w_${size},h_${size},c_fill,q_auto,f_auto/`);
  }
  return url;
}

export const CONVERSATION_TYPE_LABELS = {
  dm: 'خاص',
  group: 'جروب',
  channel: 'قناة',
  study_room: 'غرفة مذاكرة'
};

export const MEMBER_ROLE_LABELS = {
  owner: 'مالك',
  admin: 'مشرف',
  moderator: 'منظّم',
  member: 'عضو',
  subscriber: 'مشترك',
  guest: 'زائر'
};
