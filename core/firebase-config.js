window.KANGSAIN_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBhZrWWFgfBr-AIbESeOvD6qA2hHx4xNlQ",
  authDomain: "archive-pilates.firebaseapp.com",
  projectId: "archive-pilates",
  storageBucket: "archive-pilates.firebasestorage.app",
  messagingSenderId: "904688188103",
  appId: "1:904688188103:web:fa356b7f95597c99af5ce2",
  measurementId: "G-KG5SQ5HE6S",
  functionsRegion: "asia-northeast3",
  vapidKey: ""
};

window.ARCHIVE_CORE_FIREBASE_VERSION = "10.14.1";
// Start static SDK downloads alongside the app; embedded menus reuse the host SDK.
if (window.parent === window) {
  const origin = document.createElement("link");
  origin.rel = "preconnect";
  origin.href = "https://www.gstatic.com";
  origin.crossOrigin = "anonymous";
  document.head.append(origin);
  for (const name of ["app", "firestore", "auth", "functions"]) {
    const preload = document.createElement("link");
    preload.rel = "modulepreload";
    preload.href = `https://www.gstatic.com/firebasejs/${window.ARCHIVE_CORE_FIREBASE_VERSION}/firebase-${name}.js`;
    preload.crossOrigin = "anonymous";
    document.head.append(preload);
  }
}
