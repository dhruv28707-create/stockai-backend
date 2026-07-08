import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import { env } from "../config/env";

function formatPrivateKey(privateKey: string): string {
  return privateKey.replace(/\\n/g, "\n");
}

export function getFirebaseApp(): App {
  const [existingApp] = getApps();
  if (existingApp) return existingApp;

  if (
    !env.FIREBASE_PROJECT_ID ||
    !env.FIREBASE_CLIENT_EMAIL ||
    !env.FIREBASE_PRIVATE_KEY
  ) {
    throw new Error("Firebase service account environment variables are missing.");
  }

  return initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: formatPrivateKey(env.FIREBASE_PRIVATE_KEY)
    })
  });
}

export function getDb(): Firestore {
  return getFirestore(getFirebaseApp(), env.FIRESTORE_DATABASE_ID);
}

export function getFcm(): Messaging {
  return getMessaging(getFirebaseApp());
}
