import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({ projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "archive-pilates" });

export const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
