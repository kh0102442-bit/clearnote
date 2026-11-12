import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp, collection, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

export function showToast(msg, type = "success") {
  const toast = document.createElement("div");
  toast.style.cssText = `position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:${type === "error" ? "#b91c1c" : "#1f6b45"};color:white;padding:14px 28px;border-radius:10px;font-family:'Cairo',sans-serif;font-size:16px;font-weight:bold;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,.25);`;
  toast.textContent = msg; document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

export async function signUp(email, password, name, extraData = {}) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await setDoc(doc(db, "users", cred.user.uid), { 
    uid: cred.user.uid, email, name, ...extraData, createdAt: serverTimestamp() 
  });
  return cred.user;
}

export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signOutUser() { await signOut(auth); }

export async function getUserData(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: uid, ...snap.data() } : null;
}

export function onAuth(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) return callback(null, null);
    const userData = await getUserData(user.uid);
    callback(user, userData);
  });
}

export function isAdmin(userData) { return userData && userData.role === 'admin'; }
export function goTo(page) { window.location.href = page; }

// ===== DEVICE FINGERPRINT LOGIC =====
export async function getDeviceFingerprint() {
  const raw = [navigator.userAgent, navigator.language, screen.width + "x" + screen.height, new Date().getTimezoneOffset()].join("|");
  const buf = new TextEncoder().encode(raw);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

export async function checkDeviceStatus(uid) {
  const fp = await getDeviceFingerprint();
  const devRef = doc(db, 'devices', uid, 'list', fp);
  const devSnap = await getDoc(devRef);

  if (devSnap.exists()) {
    await updateDoc(devRef, { lastSeen: serverTimestamp() });
    return { status: devSnap.data().status, fp };
  }

  const snap = await getDocs(collection(db, 'devices', uid, 'list'));
  const isFirstDevice = snap.docs.length === 0;
  const newStatus = isFirstDevice ? 'approved' : 'pending';

  await setDoc(devRef, {
    deviceId: fp, userAgent: navigator.userAgent, status: newStatus, createdAt: serverTimestamp(), lastSeen: serverTimestamp()
  });

  return { status: newStatus, fp };
}

// ===== SUBSCRIPTIONS =====
export async function checkSubscription(uid, subjectId) {
  const snap = await getDoc(doc(db, 'subscriptions', `${uid}_${subjectId}`));
  if (!snap.exists()) return false;
  const data = snap.data();
  if (data.status !== 'active') return false;
  if (data.expiresAt.toDate() < new Date()) return false;
  return true;
}

export async function requestSubscription(uid, userName, subjectId, subjectName, notes) {
  const reqRef = doc(collection(db, 'subscription_requests'));
  await setDoc(reqRef, {
    id: reqRef.id, uid, userName, subjectId, subjectName, notes,
    status: 'pending', createdAt: serverTimestamp()
  });
  return reqRef.id;
}

export async function activateSubscription(uid, subjectId, durationDays = 30) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + durationDays);
  await setDoc(doc(db, 'subscriptions', `${uid}_${subjectId}`), {
    uid, subjectId, status: 'active', createdAt: serverTimestamp(), expiresAt: expiresAt
  });
}
