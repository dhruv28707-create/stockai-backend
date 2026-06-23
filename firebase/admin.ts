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

export const getDb = (): Firestore => getFirestore(getFirebaseApp());

export const getFcm = (): Messaging => getMessaging(getFirebaseApp());
