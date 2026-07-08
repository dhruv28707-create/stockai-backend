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
  const notificationRef = getDb().collection(collectionNames.notifications).doc();

  if (!token) {
    await notificationRef.set({
      id: notificationRef.id,
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
        priority: priority === "LOW" ? "normal" : "high",
        notification: {
          channelId: type.includes("SELL") || type.includes("EXIT")
            ? "sell_signals"
            : "buy_signals",
          sound: "default"
        }
      }
    });

    await notificationRef.set({
      id: notificationRef.id,
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

    await notificationRef.set({
      id: notificationRef.id,
      userId: env.SINGLE_USER_ID,
      title,
      body,
      channel: "fcm",
      status: "failed",
      deviceToken: token,
      errorMessage,
      metadata,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    return { sent: false, hasToken: true, error: errorMessage };
  }
}
