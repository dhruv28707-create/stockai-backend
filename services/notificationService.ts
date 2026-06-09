import { Timestamp } from "firebase-admin/firestore";
import type { Messaging } from "firebase-admin/messaging";

import { env } from "../config/env.js";
import { getFcm } from "../firebase/admin.js";
import { collectionNames } from "../models/index.js";
import { logger } from "../utils/logger.js";
import { FirestoreService } from "./firestoreService.js";

// ─── Payload Types ────────────────────────────────────────────────────────────

export interface BuyNotificationPayload {
  userId: string;
  symbol: string;
  name: string;
  entry: number;       // current price
  stoploss: number;    // entry - (1 × ATR)
  target: number;      // entry + (2 × ATR)
  confidence: number;  // 0–1
  reason: string;      // rule-based rationale text
  atr: number;
}

export interface ExitNotificationPayload {
  userId: string;
  symbol: string;
  name: string;
  currentPrice: number;
  exitReason: string;
  confidence: number;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  notificationDocId?: string;
}

// ─── Token doc shape in Firestore settings ────────────────────────────────────

const TOKEN_DOC_ID = "fcm_device_token";

interface TokenDoc {
  token: string;
  updatedAt: Timestamp;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class NotificationService {
  private readonly db = new FirestoreService();

  constructor(private readonly messaging: Messaging = getFcm()) {}

  get client(): Messaging {
    return this.messaging;
  }

  // ── Device token management ────────────────────────────────────────────────

  /**
   * Resolves the FCM device token.
   * Priority: Firestore (primary) → env var (fallback).
   */
  async resolveDeviceToken(): Promise<string | null> {
    try {
      const snap = await this.db.client
        .collection(collectionNames.settings)
        .doc(TOKEN_DOC_ID)
        .get();

      if (snap.exists) {
        const data = snap.data() as TokenDoc | undefined;
        if (data?.token) return data.token;
      }
    } catch (err) {
      logger.warn("Could not read FCM token from Firestore, falling back to env", {
        error: err instanceof Error ? err.message : String(err)
      });
    }

    return env.FCM_ANDROID_DEVICE_TOKEN ?? null;
  }

  /**
   * Saves a new device token to Firestore.
   * Called by POST /api/notifications/register.
   */
  async registerDeviceToken(token: string): Promise<void> {
    await this.db.client
      .collection(collectionNames.settings)
      .doc(TOKEN_DOC_ID)
      .set({ token, updatedAt: Timestamp.now() });

    logger.info("FCM device token registered", { tokenPrefix: token.slice(0, 10) });
  }

  // ── Internal: write notification log to Firestore ─────────────────────────

  private async logNotification(
    userId: string,
    title: string,
    body: string,
    token: string,
    status: "sent" | "failed",
    metadata: Record<string, unknown>,
    errorMessage?: string
  ): Promise<string> {
    const ref = this.db.client.collection(collectionNames.notifications).doc();
    const now = Timestamp.now();

    await ref.set({
      id: ref.id,
      userId,
      title,
      body,
      channel: "fcm",
      status,
      deviceToken: token,
      sentAt: status === "sent" ? now : undefined,
      ...(errorMessage ? { errorMessage } : {}),
      metadata,
      createdAt: now,
      updatedAt: now
    });

    return ref.id;
  }

  // ── Internal: send via FCM ────────────────────────────────────────────────

  private async sendFCM(
    token: string,
    title: string,
    body: string,
    data: Record<string, string>
  ): Promise<string> {
    const messageId = await this.messaging.send({
      token,
      notification: { title, body },
      data,
      android: {
        priority: "high",
        notification: {
          channelId: "stock_signals",
          sound: "default"
        }
      }
    });
    return messageId;
  }

  // ── sendBuyNotification ────────────────────────────────────────────────────

  /**
   * Sends a BUY signal push notification.
   *
   * Entry  = current price
   * SL     = entry − (1 × ATR)
   * Target = entry + (2 × ATR)
   */
  async sendBuyNotification(payload: BuyNotificationPayload): Promise<SendResult> {
    const {
      userId, symbol, name, entry, stoploss, target,
      confidence, reason, atr
    } = payload;

    const token = await this.resolveDeviceToken();
    if (!token) {
      logger.warn("sendBuyNotification: no FCM token available", { symbol });
      return { success: false, error: "No FCM device token configured." };
    }

    const confidencePct = Math.round(confidence * 100);
    const title = `📈 BUY — ${symbol}`;
    const body = [
      `${name}`,
      `Entry: ₹${entry.toFixed(2)}`,
      `SL: ₹${stoploss.toFixed(2)}  |  Target: ₹${target.toFixed(2)}`,
      `Confidence: ${confidencePct}%`,
      reason
    ].join("\n");

    const data: Record<string, string> = {
      type: "BUY",
      symbol,
      name,
      entry: String(entry),
      stoploss: String(stoploss),
      target: String(target),
      confidence: String(confidence),
      atr: String(atr),
      reason
    };

    try {
      const messageId = await this.sendFCM(token, title, body, data);

      const docId = await this.logNotification(
        userId, title, body, token, "sent",
        { type: "BUY", symbol, entry, stoploss, target, confidence, atr }
      );

      logger.info("BUY notification sent", { symbol, messageId, confidencePct });
      return { success: true, messageId, notificationDocId: docId };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      await this.logNotification(
        userId, title, body, token, "failed",
        { type: "BUY", symbol }, errorMessage
      );

      logger.error("BUY notification failed", { symbol, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  // ── sendExitNotification ───────────────────────────────────────────────────

  /**
   * Sends an EXIT signal push notification for an open position.
   */
  async sendExitNotification(payload: ExitNotificationPayload): Promise<SendResult> {
    const { userId, symbol, name, currentPrice, exitReason, confidence } = payload;

    const token = await this.resolveDeviceToken();
    if (!token) {
      logger.warn("sendExitNotification: no FCM token available", { symbol });
      return { success: false, error: "No FCM device token configured." };
    }

    const confidencePct = Math.round(confidence * 100);
    const title = `📉 EXIT — ${symbol}`;
    const body = [
      `${name}`,
      `Current Price: ₹${currentPrice.toFixed(2)}`,
      `Confidence: ${confidencePct}%`,
      `Reason: ${exitReason}`
    ].join("\n");

    const data: Record<string, string> = {
      type: "EXIT",
      symbol,
      name,
      currentPrice: String(currentPrice),
      confidence: String(confidence),
      exitReason
    };

    try {
      const messageId = await this.sendFCM(token, title, body, data);

      const docId = await this.logNotification(
        userId, title, body, token, "sent",
        { type: "EXIT", symbol, currentPrice, confidence }
      );

      logger.info("EXIT notification sent", { symbol, messageId, confidencePct });
      return { success: true, messageId, notificationDocId: docId };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      await this.logNotification(
        userId, title, body, token, "failed",
        { type: "EXIT", symbol }, errorMessage
      );

      logger.error("EXIT notification failed", { symbol, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }
}
