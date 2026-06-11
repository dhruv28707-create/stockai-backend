import { z } from "zod";

import { env } from "../../../config/env.js";
import { NotificationService } from "../../../services/notificationService.js";
import type { ApiHandler } from "../../../types/api.js";
import { sendError, sendJson } from "../../../utils/http.js";
import { logger } from "../../../utils/logger.js";

const bodySchema = z.object({
  symbol: z.string().trim().min(1).toUpperCase(),
  name: z.string().trim().min(1),
  entry: z.number().finite().positive(),
  atr: z.number().finite().positive(),
  confidence: z.number().finite().min(0).max(1),
  reason: z.string().trim().min(1)
});

/**
 * POST /api/notifications/buy
 *
 * Sends a BUY signal push notification.
 * SL  = entry − (1 × ATR)
 * TGT = entry + (2 × ATR)
 *
 * Called by the scanner automatically, or manually for testing.
 */
const handler: ApiHandler = async (request, response) => {
  if (request.method !== "POST") {
    sendError(response, 405, "method_not_allowed", "Method not allowed.");
    return;
  }

  const userId = env.SINGLE_USER_ID;
  if (!userId) {
    sendError(response, 500, "misconfigured", "SINGLE_USER_ID is not set.");
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawBody = (request as any).body as unknown;
  const parsed = bodySchema.safeParse(rawBody);

  if (!parsed.success) {
    sendError(
      response,
      400,
      "validation_error",
      parsed.error.issues.map((i) => i.message).join(", ")
    );
    return;
  }

  const { symbol, name, entry, atr, confidence, reason } = parsed.data;

  // Compute stoploss and target from ATR
  const stoploss = parseFloat((entry - 1 * atr).toFixed(2));
  const target = parseFloat((entry + 2 * atr).toFixed(2));

  try {
    const service = new NotificationService();
    const result = await service.sendBuyNotification({
      userId,
      symbol,
      name,
      entry,
      stoploss,
      target,
      confidence,
      reason,
      atr
    });

    if (!result.success) {
      sendError(response, 500, "notification_failed", result.error ?? "Unknown error.");
      return;
    }

    sendJson(response, 200, {
      data: {
        sent: true,
        symbol,
        entry,
        stoploss,
        target,
        confidence,
        messageId: result.messageId,
        notificationDocId: result.notificationDocId
      }
    });
  } catch (err) {
    logger.error("BUY notification endpoint error", {
      error: err instanceof Error ? err.message : String(err)
    });
    sendError(response, 500, "internal_error", "Failed to send BUY notification.");
  }
};

export default handler;


