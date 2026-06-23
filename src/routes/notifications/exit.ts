import { z } from "zod";

import { env } from "../../../config/env.js";
import { NotificationService } from "../../../services/notificationService.js";
import type { ApiHandler } from "../../../types/api.js";
import { sendError, sendJson } from "../../../utils/http.js";
import { logger, toErrorContext } from "../../../utils/logger.js";

const bodySchema = z.object({
  symbol: z.string().trim().min(1).toUpperCase(),
  name: z.string().trim().min(1),
  currentPrice: z.number().finite().positive(),
  exitReason: z.string().trim().min(1),
  confidence: z.number().finite().min(0).max(1)
});

/**
 * POST /api/notifications/exit
 *
 * Sends an EXIT signal push notification for an open position.
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

  const { symbol, name, currentPrice, exitReason, confidence } = parsed.data;

  try {
    const service = new NotificationService();
    const result = await service.sendExitNotification({
      userId,
      symbol,
      name,
      currentPrice,
      exitReason,
      confidence
    });

    if (!result.success) {
      sendError(response, 500, "notification_failed", result.error ?? "Unknown error.");
      return;
    }

    sendJson(response, 200, {
      data: {
        sent: true,
        symbol,
        currentPrice,
        confidence,
        messageId: result.messageId,
        notificationDocId: result.notificationDocId
      }
    });
  } catch (err) {
    logger.error("EXIT notification endpoint error", { ...toErrorContext(err) });
    sendError(response, 500, "internal_error", "Failed to send EXIT notification.");
  }
};

export default handler;


