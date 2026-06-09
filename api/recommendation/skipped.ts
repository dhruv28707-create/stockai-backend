import { z } from "zod";

import { env } from "../../config/env.js";
import { collectionNames } from "../../models/index.js";
import { FirestoreService } from "../../services/firestoreService.js";
import { MonthlySetupService } from "../../services/monthlySetupService.js";
import type { ApiHandler } from "../../types/api.js";
import { sendError, sendJson } from "../../utils/http.js";
import { logger } from "../../utils/logger.js";
import { Timestamp } from "firebase-admin/firestore";

const bodySchema = z.object({
  recommendationId: z.string().trim().min(1),
  symbol: z.string().trim().min(1).toUpperCase(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  reason: z.enum(["skipped", "insufficient_capital"]),
  notes: z.string().trim().max(500).optional()
});

/**
 * POST /api/recommendation/skipped
 *
 * User skips a recommendation.
 * 1. Updates recommendation status to "dismissed".
 * 2. Creates a missedTrade document for report tracking.
 * No capital change.
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
    sendError(response, 400, "validation_error",
      parsed.error.issues.map((i) => i.message).join(", "));
    return;
  }

  const { recommendationId, symbol, month, reason, notes } = parsed.data;
  const today = new Date().toISOString().slice(0, 10);

  try {
    const db = new FirestoreService();
    const monthlySetupSvc = new MonthlySetupService();

    // Confirm setup exists
    const skipResult = await monthlySetupSvc.skipTrade({
      userId,
      month,
      recommendationId,
      reason
    });

    if (!skipResult.success) {
      sendError(response, 400, "skip_error", skipResult.error);
      return;
    }

    const now = Timestamp.now();

    // Update recommendation to dismissed
    await db.client
      .collection(collectionNames.recommendations)
      .doc(recommendationId)
      .update({ status: "dismissed", updatedAt: now });

    // Create missed trade document
    const missedRef = db.client.collection(collectionNames.missedTrades).doc();
    await missedRef.set({
      id: missedRef.id,
      userId,
      symbol,
      side: "buy",
      reason: reason === "insufficient_capital" ? "insufficient_funds" : "manual_skip",
      observedOn: today,
      recommendationId,
      ...(notes ? { notes } : {}),
      createdAt: now,
      updatedAt: now
    });

    logger.info("Recommendation skipped", { userId, symbol, recommendationId, reason });

    sendJson(response, 200, {
      data: {
        skipped: true,
        missedTradeId: missedRef.id,
        symbol,
        recommendationId
      }
    });
  } catch (err) {
    logger.error("POST /api/recommendation/skipped failed", {
      error: err instanceof Error ? err.message : String(err)
    });
    sendError(response, 500, "internal_error", "Failed to record skip.");
  }
};

export default handler;
