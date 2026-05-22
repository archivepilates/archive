import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const projectId = process.env.FIREBASE_PROJECT || "archive-pilates";
const adminEmail = process.env.ARCHIVEIN_VERIFY_ADMIN_EMAIL || "p01029244425@archivepilates.com";
const targetUrl = process.env.ARCHIVEIN_VERIFY_URL || "https://in.archivepilates.com/";
const studioId = process.env.ARCHIVEIN_VERIFY_STUDIO_ID || "5330";
const staffId = process.env.ARCHIVEIN_VERIFY_STAFF_ID || "operator_01029244425";
const role = process.env.ARCHIVEIN_VERIFY_ROLE || "manager";
const selectedDate = process.env.ARCHIVEIN_VERIFY_DATE || new Date().toLocaleDateString("sv-SE", {
  timeZone: "Asia/Seoul"
});

if (!admin.apps.length) {
  admin.initializeApp({ projectId });
}

const adminReads = [
  {
    label: "staff operator doc",
    run: async ({ db, getDoc, doc }) => ({
      exists: (await getDoc(doc(db, "staffs", staffId))).exists()
    })
  },
  {
    label: "staffs active query",
    run: async ({ db, getDocs, collection, query, where, limit }) => ({
      size: (await getDocs(query(
        collection(db, "staffs"),
        where("studioId", "==", studioId),
        where("active", "==", true),
        limit(1)
      ))).size
    })
  },
  {
    label: "instructorViews query",
    run: async ({ db, getDocs, collection, query, where, limit }) => ({
      size: (await getDocs(query(
        collection(db, "instructorViews"),
        where("studioId", "==", studioId),
        where("date", "==", selectedDate),
        limit(1)
      ))).size
    })
  },
  {
    label: "consultations query",
    run: async ({ db, getDocs, collection, query, where, limit }) => ({
      size: (await getDocs(query(
        collection(db, "consultations"),
        where("studioId", "==", studioId),
        where("date", "==", selectedDate),
        limit(1)
      ))).size
    })
  },
  {
    label: "otherSchedules query",
    run: async ({ db, getDocs, collection, query, where, limit }) => ({
      size: (await getDocs(query(
        collection(db, "otherSchedules"),
        where("studioId", "==", studioId),
        where("date", "==", selectedDate),
        limit(1)
      ))).size
    })
  },
  ...[
    "memberMemos",
    "memberProfiles",
    "memberContactIndex",
    "alimtalkCandidates",
    "privateSurveyResponses",
    "studiomateMemoWriteJobs"
  ].map((collectionName) => ({
    label: `${collectionName} query`,
    run: async ({ db, getDocs, collection, query, where, limit }) => ({
      size: (await getDocs(query(
        collection(db, collectionName),
        where("studioId", "==", studioId),
        limit(1)
      ))).size
    })
  })),
  {
    label: "alimtalkTemplateStates query",
    run: async ({ db, getDocs, collection, query, limit }) => ({
      size: (await getDocs(query(collection(db, "alimtalkTemplateStates"), limit(1)))).size
    })
  },
  {
    label: "adminActions doc",
    run: async ({ db, getDoc, doc }) => ({
      exists: (await getDoc(doc(db, "adminActions", `${studioId}_${selectedDate}`))).exists()
    })
  },
  {
    label: "syncStates doc",
    run: async ({ db, getDoc, doc }) => ({
      exists: (await getDoc(doc(db, "syncStates", `lecturesRange_${studioId}`))).exists()
    })
  },
  {
    label: "dashboardSnapshots current doc",
    run: async ({ db, getDoc, doc }) => ({
      exists: (await getDoc(doc(db, "dashboardSnapshots", "current"))).exists()
    })
  },
  {
    label: "opsState emergency doc",
    run: async ({ db, getDoc, doc }) => ({
      exists: (await getDoc(doc(db, "opsState", "studiomateReservationExcelEmergency"))).exists()
    })
  }
];

const user = await admin.auth().getUserByEmail(adminEmail);
const customToken = await admin.auth().createCustomToken(user.uid, {
  role,
  staffId,
  studioId
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const logs = [];
page.on("console", (msg) => logs.push({ type: msg.type(), text: msg.text().slice(0, 700) }));
page.on("pageerror", (err) => logs.push({ type: "pageerror", text: err.message }));
page.on("requestfailed", (req) => {
  logs.push({
    type: "requestfailed",
    text: `${req.method()} ${req.url()} ${req.failure()?.errorText || ""}`.slice(0, 700)
  });
});

try {
  const url = new URL(targetUrl);
  url.searchParams.set("verify-admin", String(Date.now()));
  await page.goto(url.toString(), { waitUntil: "networkidle" });

  const result = await page.evaluate(async ({ token, adminReadLabels }) => {
    const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js");
    const { getAuth, signInWithCustomToken } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js");
    const firestore = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js");
    const config = window.KANGSAIN_FIREBASE_CONFIG;
    const app = getApps().length ? getApps()[0] : initializeApp(config);
    const auth = getAuth(app);
    await signInWithCustomToken(auth, token);
    const tokenResult = await auth.currentUser.getIdTokenResult(true);
    const db = firestore.getFirestore(app);
    return {
      email: auth.currentUser.email,
      uid: auth.currentUser.uid,
      claims: {
        role: tokenResult.claims.role,
        staffId: tokenResult.claims.staffId,
        studioId: tokenResult.claims.studioId,
        email: tokenResult.claims.email
      },
      configPresent: !!config,
      adminReadLabels,
      firestoreModuleReady: !!db
    };
  }, { token: customToken, adminReadLabels: adminReads.map((item) => item.label) });

  const probes = await page.evaluate(async ({ token: _token, reads, verifyDate, verifyStudioId, verifyStaffId }) => {
    const {
      getFirestore,
      doc,
      getDoc,
      collection,
      query,
      where,
      getDocs,
      limit
    } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js");
    const { getApps } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js");
    const db = getFirestore(getApps()[0]);
    async function attempt(label, fn) {
      try {
        const res = await fn();
        return { label, ok: true, res };
      } catch (err) {
        return { label, ok: false, code: err.code, message: err.message };
      }
    }
    const collectionReads = {
      "staff operator doc": () => getDoc(doc(db, "staffs", verifyStaffId)).then((snap) => ({ exists: snap.exists() })),
      "staffs active query": () => getDocs(query(collection(db, "staffs"), where("studioId", "==", verifyStudioId), where("active", "==", true), limit(1))).then((snap) => ({ size: snap.size })),
      "instructorViews query": () => getDocs(query(collection(db, "instructorViews"), where("studioId", "==", verifyStudioId), where("date", "==", verifyDate), limit(1))).then((snap) => ({ size: snap.size })),
      "consultations query": () => getDocs(query(collection(db, "consultations"), where("studioId", "==", verifyStudioId), where("date", "==", verifyDate), limit(1))).then((snap) => ({ size: snap.size })),
      "otherSchedules query": () => getDocs(query(collection(db, "otherSchedules"), where("studioId", "==", verifyStudioId), where("date", "==", verifyDate), limit(1))).then((snap) => ({ size: snap.size })),
      "memberMemos query": () => getDocs(query(collection(db, "memberMemos"), where("studioId", "==", verifyStudioId), limit(1))).then((snap) => ({ size: snap.size })),
      "memberProfiles query": () => getDocs(query(collection(db, "memberProfiles"), where("studioId", "==", verifyStudioId), limit(1))).then((snap) => ({ size: snap.size })),
      "memberContactIndex query": () => getDocs(query(collection(db, "memberContactIndex"), where("studioId", "==", verifyStudioId), limit(1))).then((snap) => ({ size: snap.size })),
      "alimtalkCandidates query": () => getDocs(query(collection(db, "alimtalkCandidates"), where("studioId", "==", verifyStudioId), limit(1))).then((snap) => ({ size: snap.size })),
      "privateSurveyResponses query": () => getDocs(query(collection(db, "privateSurveyResponses"), where("studioId", "==", verifyStudioId), limit(1))).then((snap) => ({ size: snap.size })),
      "studiomateMemoWriteJobs query": () => getDocs(query(collection(db, "studiomateMemoWriteJobs"), where("studioId", "==", verifyStudioId), limit(1))).then((snap) => ({ size: snap.size })),
      "alimtalkTemplateStates query": () => getDocs(query(collection(db, "alimtalkTemplateStates"), limit(1))).then((snap) => ({ size: snap.size })),
      "adminActions doc": () => getDoc(doc(db, "adminActions", `${verifyStudioId}_${verifyDate}`)).then((snap) => ({ exists: snap.exists() })),
      "syncStates doc": () => getDoc(doc(db, "syncStates", `lecturesRange_${verifyStudioId}`)).then((snap) => ({ exists: snap.exists() })),
      "dashboardSnapshots current doc": () => getDoc(doc(db, "dashboardSnapshots", "current")).then((snap) => ({ exists: snap.exists() })),
      "opsState emergency doc": () => getDoc(doc(db, "opsState", "studiomateReservationExcelEmergency")).then((snap) => ({ exists: snap.exists() }))
    };
    return Promise.all(reads.map((label) => attempt(label, collectionReads[label])));
  }, {
    token: customToken,
    reads: adminReads.map((item) => item.label),
    verifyDate: selectedDate,
    verifyStudioId: studioId,
    verifyStaffId: staffId
  });

  await page.waitForTimeout(8000);
  const screen = await page.evaluate(() => ({
    title: document.title,
    hasOperatorTitle: document.body.innerText.includes("아카이브IN 운영자"),
    hasPermissionError: document.body.innerText.includes("Missing or insufficient permissions"),
    hasActionNeeded: document.body.innerText.includes("액션 필요"),
    hasInstructorTitle: /^IN\s*강사/m.test(document.body.innerText)
  }));
  await page.screenshot({ path: "/tmp/archivein-admin-verify.png", fullPage: true });

  const failedReads = probes.filter((item) => !item.ok);
  const failedScreen = !screen.hasOperatorTitle || screen.hasPermissionError || screen.hasInstructorTitle;
  const summary = {
    ok: failedReads.length === 0 && !failedScreen,
    targetUrl,
    selectedDate,
    adminEmail,
    auth: result,
    screen,
    probes,
    recentLogs: logs.slice(-30),
    screenshot: "/tmp/archivein-admin-verify.png"
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
} finally {
  await browser.close();
}
