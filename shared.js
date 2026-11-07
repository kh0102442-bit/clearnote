import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

export const ROLES = { ADMIN: "admin", STUDENT: "student" };

export function showToast(msg, type = "success") {
  const toast = document.createElement("div");
  toast.style.cssText = `position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:${type === "error" ? "#b91c1c" : "#1f6b45"};color:white;padding:12px 24px;border-radius:6px;font-family:sans-serif;font-size:14px;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,.25);`;
  toast.textContent = msg; document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

export async function signUp(email, password, name) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await setDoc(doc(db, "users", cred.user.uid), { uid: cred.user.uid, email, name: name || email.split("@")[0], role: ROLES.STUDENT, createdAt: serverTimestamp() });
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

export function isAdmin(userData) { return userData && userData.role === ROLES.ADMIN; }
export function goTo(page) { window.location.href = page; }
