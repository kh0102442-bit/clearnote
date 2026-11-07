// ============================================================
// ClearNote — Shared Firebase Module
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ===== Firebase Config =====
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

// ===== Constants =====
export const ROLES = {
  ADMIN: "admin",
  STUDENT: "student"
};

export const MAX_DEVICES = 3;

// ===== Helpers =====

export function showToast(msg, type = "success") {
  const toast = document.createElement("div");
  toast.style.cssText = `
    position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
    background: ${type === "error" ? "#b91c1c" : type === "warning" ? "#a8741a" : "#1f6b45"};
    color: white; padding: 12px 24px; border-radius: 6px;
    font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 14px;
    z-index: 99999; box-shadow: 0 4px 16px rgba(0,0,0,.25);
    animation: cnToastIn .3s ease;
    max-width: 90%; text-align: center;
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

export function formatDate(value) {
  if (!value) return "—";
  let d;
  if (value.toDate) d = value.toDate();
  else if (value instanceof Date) d = value;
  else d = new Date(value);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("ar-EG", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

export async function getDeviceFingerprint() {
  const raw = [
    navigator.userAgent,
    navigator.language,
    screen.width + "x" + screen.height,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 0
  ].join("|");
  const buf = new TextEncoder().encode(raw);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}

// ===== Auth helpers =====

export async function signUp(email, password, name) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;

  await setDoc(doc(db, "users", uid), {
    uid,
    email,
    name: name || email.split("@")[0],
    role: ROLES.STUDENT,
    createdAt: serverTimestamp(),
    avatarType: "letter",
    avatarData: null,
    bio: "",
    followers: {},
    following: {},
    totalPoints: 0
  });

  return cred.user;
}

export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signOutUser() {
  await signOut(auth);
}

export async function getUserData(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: uid, ...snap.data() } : null;
}

export async function updateUserData(uid, data) {
  await updateDoc(doc(db, "users", uid), data);
}

export function onAuth(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) return callback(null, null);
    const userData = await getUserData(user.uid);
    callback(user, userData);
  });
}

// ===== Device helpers =====

export async function registerDevice(uid) {
  const fingerprint = await getDeviceFingerprint();
  const deviceId = fingerprint;

  const devicesRef = collection(db, "devices", uid, "list");
  const snap = await getDocs(devicesRef);
  const existing = snap.docs.find(d => d.id === deviceId);

  if (existing) {
    await updateDoc(doc(db, "devices", uid, "list", deviceId), {
      lastSeen: serverTimestamp()
    });
    return { ok: true, deviceId, status: existing.data().status };
  }

  const activeDevices = snap.docs.filter(d => d.data().status === "approved");
  if (activeDevices.length >= MAX_DEVICES) {
    return { ok: false, reason: "max_devices_reached", deviceId };
  }

  await setDoc(doc(db, "devices", uid, "list", deviceId), {
    deviceId,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    status: "pending",
    createdAt: serverTimestamp(),
    lastSeen: serverTimestamp()
  });

  return { ok: false, reason: "pending_approval", deviceId };
}

export async function isDeviceApproved(uid) {
  const fingerprint = await getDeviceFingerprint();
  const snap = await getDoc(doc(db, "devices", uid, "list", fingerprint));
  if (!snap.exists()) return { approved: false, exists: false };
  return { approved: snap.data().status === "approved", exists: true, data: snap.data() };
}

export function isAdmin(userData) {
  return userData && userData.role === ROLES.ADMIN;
}

export function goTo(page) {
  window.location.href = page;
}