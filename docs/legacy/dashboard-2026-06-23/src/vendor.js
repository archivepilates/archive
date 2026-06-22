import Chart from "chart.js/auto";
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc, getFirestore } from "firebase/firestore";

window.Chart = Chart;

const config = window.KANGSAIN_FIREBASE_CONFIG;
const loginGate = document.getElementById("loginGate");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
let currentUser = null;
const userWaiters = [];

function emit(name, detail = {}) {
  document.dispatchEvent(new CustomEvent(name, { detail }));
}

function setLoginVisible(visible, message = "") {
  loginGate?.classList.toggle("on", visible);
  if (loginError) loginError.textContent = message;
}

function friendlyAuthError(err) {
  const code = String((err && err.code) || "");
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "로그인 정보를 확인하세요";
  }
  if (code.includes("too-many-requests")) return "요청이 많습니다. 잠시 후 다시 시도하세요";
  return err && err.message ? err.message : "로그인에 실패했습니다";
}

function waitForUser(timeoutMs = 8000) {
  if (currentUser) return Promise.resolve(currentUser);
  return new Promise((done, fail) => {
    const timer = setTimeout(() => {
      setLoginVisible(true);
      fail(new Error("로그인 후 다시 시도하세요"));
    }, timeoutMs);
    userWaiters.push((user) => {
      clearTimeout(timer);
      done(user);
    });
  });
}

window.archiveDashboardAuthReady = new Promise((resolve) => {
  if (!config) {
    setLoginVisible(true, "Firebase 설정을 찾을 수 없습니다");
    resolve({
      mode: "firebase",
      fetchDashboard: async () => {
        throw new Error("Firebase 설정을 찾을 수 없습니다.");
      },
    });
    return;
  }

  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);

  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    setLoginVisible(!user);
    if (user) {
      userWaiters.splice(0).forEach((done) => done(user));
      emit("archiveDashboardAuthReady");
    } else {
      emit("archiveDashboardAuthRequired");
    }
  });

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const phone = document.getElementById("phoneInput")?.value.replace(/\D/g, "") || "";
    const pin = document.getElementById("pinInput")?.value.trim() || "";
    if (!phone || !pin) {
      setLoginVisible(true, "휴대폰번호와 비밀번호를 입력하세요");
      return;
    }
    try {
      setLoginVisible(true, "");
      await signInWithEmailAndPassword(auth, `p${phone}@archivepilates.com`, pin);
    } catch (err) {
      setLoginVisible(true, friendlyAuthError(err));
    }
  });

  window.archiveDashboardSignOut = () => signOut(auth);
  resolve({
    mode: "firebase",
    fetchDashboard: async () => {
      await waitForUser();
      const snap = await getDoc(doc(db, "dashboardSnapshots", "current"));
      if (!snap.exists()) throw new Error("현황판 데이터가 아직 동기화되지 않았습니다.");
      return snap.data();
    },
  });
});
