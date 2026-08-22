import { Timestamp } from "firebase-admin/firestore";
import { env } from "../config/env";
import { getDb, getFcm } from "../firebase/admin";
import { collectionNames } from "../models";
import { getErrorCode } from "../utils/helpers";
import { logger } from "../utils/logger";

const TOKEN_DOC_ID = "fcm_device_token";

// These mean the stored token is dead and will never deliver again.
// (deliberately token-specific — "messaging/invalid-argument" is too broad
// and can be raised by unrelated payload problems)
const INVALID_TOKEN_ERROR_CODES = [
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token"
];

export interface PushMetadata {
  type: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  symbol?: string;
  actionUrl?: string;
}

export async function registerDeviceToken(token: string): Promise<void> {
  const ref = getDb().collection(collectionNames.settings).doc(TOKEN_DOC_ID);
  const existing = await ref.get();
  const now = Timestamp.now();

  await ref.set(
    {
      token,
      tokenPrefix: getTokenPrefix(token),
      tokenLength: token.length,
      // Preserve the original registration date on token refreshes.
      ...(existing.exists ? {} : { createdAt: now }),
      updatedAt: now
    },
    { merge: true }
  );
}

export async function resolveDeviceToken(): Promise<string | null> {
  const tokenDoc = await getDb()
    .collection(collectionNames.settings)
    .doc(TOKEN_DOC_ID)
    .get();

  const savedToken = tokenDoc.data()?.token;
  if (typeof savedToken === "string" && savedToken.trim()) {
    return savedToken;
  }

  return env.FCM_ANDROID_DEVICE_TOKEN ?? null;
}

export async function getNotificationTokenStatus(): Promise<{
  hasToken: boolean;
  tokenPrefix: string | null;
  tokenLength: number | null;
  source: "firestore" | "env" | "none";
}> {
  const tokenDoc = await getDb()
    .collection(collectionNames.settings)
    .doc(TOKEN_DOC_ID)
    .get();

  const savedToken = tokenDoc.data()?.token;
  if (typeof savedToken === "string" && savedToken.trim()) {
    return {
      hasToken: true,
      tokenPrefix: getTokenPrefix(savedToken),
      tokenLength: savedToken.length,
      source: "firestore"
    };
  }

  if (env.FCM_ANDROID_DEVICE_TOKEN) {
    return {
      hasToken: true,
      tokenPrefix: getTokenPrefix(env.FCM_ANDROID_DEVICE_TOKEN),
      tokenLength: env.FCM_ANDROID_DEVICE_TOKEN.length,
      source: "env"
    };
  }

  return { hasToken: false, tokenPrefix: null, tokenLength: null, source: "none" };
}

// Human-readable IST label (e.g. "16 Aug 2026, 4:05 PM") so the app can show
// a concrete time instead of a vague relative one like "just now".
export function getISTTimestampLabel(date = new Date()): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(date);
}

export async function sendPushNotification(
  title: string,
  body: string,
  type: string,
  priority: "HIGH" | "MEDIUM" | "LOW",
  symbol?: string,
  actionUrl?: string
): Promise<{ sent: boolean; hasToken: boolean; messageId?: string; error?: string }> {
  const token = await resolveDeviceToken();
  const metadata: PushMetadata = { type, priority, symbol, actionUrl };
  const channel = getNotificationChannel(type);
  const now = new Date();

  // Carried in the FCM data payload so the app can render a real timestamp
  // instead of defaulting to "just now".
  const timestampData = {
    timestamp: now.toISOString(),
    timestampLabel: getISTTimestampLabel(now)
  };

  if (!token) {
    await logNotification({
      userId: env.SINGLE_USER_ID,
      title,
      body,
      channel: "fcm",
      status: "failed",
      errorMessage: "No FCM device token registered.",
      metadata,
      ...timestampData,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
    return { sent: false, hasToken: false, error: "No FCM device token registered." };
  }

  try {
    const messageId = await getFcm().send({
      token,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries({ ...metadata, ...timestampData })
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, String(value)])
      ),
      android: {
        priority: "high",
        ttl: 24 * 60 * 60 * 1000,
        directBootOk: true,
        notification: {
          channelId: channel.channelId,
          sound: channel.sound,
          priority: "max",
          visibility: "public",
          defaultVibrateTimings: true
        }
      },
      apns: {
        headers: {
          "apns-priority": "10"
        }
      }
    });

    await logNotification({
      userId: env.SINGLE_USER_ID,
      title,
      body,
      channel: "fcm",
      status: "sent",
      tokenPrefix: getTokenPrefix(token),
      messageId,
      metadata,
      ...timestampData,
      sentAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    return { sent: true, hasToken: true, messageId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = getErrorCode(error);

    // If the token is permanently invalid, delete it so the frontend's
    // next notification-status check sees "no token" and re-registers.
    // Only clears when the failing token is the one stored in Firestore — an
    // env-configured token can't be rotated from here.
    if (errorCode && INVALID_TOKEN_ERROR_CODES.includes(errorCode)) {
      await clearInvalidDeviceToken(token);
    }

    await logNotification({
      userId: env.SINGLE_USER_ID,
      title,
      body,
      channel: "fcm",
      status: "failed",
      tokenPrefix: getTokenPrefix(token),
      errorMessage,
      errorCode,
      metadata,
      ...timestampData,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    return {
      sent: false,
      hasToken: true,
      error: errorCode ? `${errorCode}: ${errorMessage}` : errorMessage
    };
  }
}

async function clearInvalidDeviceToken(token: string): Promise<void> {
  try {
    const ref = getDb().collection(collectionNames.settings).doc(TOKEN_DOC_ID);
    const snap = await ref.get();
    if (snap.data()?.token === token) {
      await ref.delete();
      logger.warn("[fcm] Cleared invalid device token; app must re-register.");
    }
  } catch {
    // Best-effort cleanup.
  }
}

// Firestore rejects `undefined` values, and metadata often carries optional
// fields (symbol/actionUrl). Recursively strip them so history logging
// actually succeeds.
function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)])
    );
  }
  return value;
}

async function logNotification(data: Record<string, unknown>): Promise<void> {
  try {
    const notificationRef = getDb().collection(collectionNames.notifications).doc();
    const safeData = stripUndefined(data) as Record<string, unknown>;
    await notificationRef.set({ id: notificationRef.id, ...safeData });
  } catch (err) {
    // History logging must never block delivery, but don't hide the failure.
    logger.warn("[fcm] Failed to log notification", {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

function getTokenPrefix(token: string): string {
  return `${token.slice(0, 12)}...`;
}

function getNotificationChannel(type: string): { channelId: string; sound: string } {
  if (type.includes("SELL") || type.includes("EXIT") || type.includes("STOP_LOSS")) {
    return { channelId: "sell_signals", sound: "sell_signal" };
  }

  if (type.includes("MARKET")) {
    return { channelId: "market_updates", sound: "market_update" };
  }

  return { channelId: "buy_signals", sound: "buy_signal" };
}
