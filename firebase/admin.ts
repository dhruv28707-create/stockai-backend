import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getMessaging, type Messaging } from "firebase-admin/messaging";

import { env } from "../config/env";

const formatPrivateKey = (privateKey: string): string => {
  return privateKey.replace(/\\n/g, "\n");
};

export const getFirebaseApp = (): App => {
  const [existingApp] = getApps();

  if (existingApp) {
    return existingApp;
  }

  if (
    !env.FIREBASE_PROJECT_ID ||
    !env.FIREBASE_CLIENT_EMAIL ||
    !env.FIREBASE_PRIVATE_KEY
  ) {
    throw new Error("Firebase service account environment variables are missing.");
  }

  const normalizedKey = formatPrivateKey(env.FIREBASE_PRIVATE_KEY).trim();

  if (
    !normalizedKey.startsWith("-----BEGIN PRIVATE KEY-----") ||
    !normalizedKey.endsWith("-----END PRIVATE KEY-----")
  ) {
    throw new Error(
      "FIREBASE_PRIVATE_KEY is malformed — expected PEM format after newline normalization."
    );
  }

  return initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: normalizedKey
    })
  });
};

// KEY FIX: this project's Firestore database was created with the
// database ID "default" (plain text), not the SDK's reserved "(default)"
// database. getFirestore(app) with no second argument always targets
// "(default)" — that mismatch caused every query to fail with
// "5 NOT_FOUND" even though credentials and permissions were correct.
// Passing the database ID explicitly fixes this.
export const getDb = (): Firestore => getFirestore(getFirebaseApp(), "default");

export const getFcm = (): Messaging => getMessaging(getFirebaseApp());
