import { Timestamp } from "firebase-admin/firestore";
import { env } from "../config/env";
import { getDb, getFcm } from "../firebase/admin";
import { collectionNames } from "../models";

const TOKEN_DOC_ID = "fcm_device_token";

export interface PushMetadata {
  type: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  symbol?: string;
  actionUrl?: string;
}

export async function registerDeviceToken(token: string): Promise<void> {
  await getDb()
    .collection(collectionNames.settings)
    .doc(TOKEN_DOC_ID)
    .set(
      {
        token,
        tokenPrefix: getTokenPrefix(token),
        tokenLength: token.length,
        updatedAt: Timestamp.now()
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

  if (!token) {
    await logNotification({
      userId: env.SINGLE_USER_ID,
      title,
      body,
      channel: "fcm",
      status: "failed",
      errorMessage: "No FCM device token registered.",
      metadata,
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
        Object.entries(metadata)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, String(value)])
      ),
      android: {
        priority: "high",
        ttl: 60 * 1000,
        notification: {
          channelId: channel.channelId,
          sound: channel.sound,
          priority: "high"
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
      deviceToken: token,
      messageId,
      metadata,
      sentAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    return { sent: true, hasToken: true, messageId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = getErrorCode(error);

    await logNotification({
      userId: env.SINGLE_USER_ID,
      title,
      body,
      channel: "fcm",
      status: "failed",
      deviceToken: token,
      errorMessage,
      errorCode,
      metadata,
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

async function logNotification(data: Record<string, unknown>): Promise<void> {
  try {
    const notificationRef = getDb().collection(collectionNames.notifications).doc();
    await notificationRef.set({ id: notificationRef.id, ...data });
  } catch {
    // Notification delivery result is more important than history logging.
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

function getErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return undefined;
}
