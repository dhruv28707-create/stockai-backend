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
  quantity: z.number().int().positive(),
  price: z.number().finite().positive(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
});

/**
 * POST /api/recommendation/purchased
 *
 * User confirms they purchased a recommended stock.
 * 1. Creates a trade document (side=buy, status=filled).
 * 2. Creates/updates a position document.
 * 3. Updates recommendation status to "accepted".
 * 4. Deducts tradeCapital from monthly remaining capital.
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

  const { recommendationId, symbol, quantity, price, month } = parsed.data;
  const tradeCapital = parseFloat((price * quantity).toFixed(2));
  const today = new Date().toISOString().slice(0, 10);

  try {
    const db = new FirestoreService();
    const monthlySetupSvc = new MonthlySetupService();

    // 1. Deduct capital — validates limits
    const capitalResult = await monthlySetupSvc.purchaseTrade({
      userId,
      month,
      tradeCapital
    });

    if (!capitalResult.success) {
      sendError(response, 400, "capital_error", capitalResult.error);
      return;
    }

    const now = Timestamp.now();

    // 2. Create trade document
    const tradeRef = db.client.collection(collectionNames.trades).doc();
    await tradeRef.set({
      id: tradeRef.id,
      userId,
      symbol,
      side: "buy",
      status: "filled",
      quantity,
      price,
      currency: "INR",
      tradedOn: today,
      recommendationId,
      createdAt: now,
      updatedAt: now
    });

    // 3. Create position document
    const posRef = db.client.collection(collectionNames.positions).doc();
    await posRef.set({
      id: posRef.id,
      userId,
      portfolioId: userId,
      symbol,
      quantity,
      averagePrice: price,
      currency: "INR",
      status: "open",
      tradeId: tradeRef.id,
      recommendationId,
      createdAt: now,
      updatedAt: now
    });

    // 4. Update recommendation status to accepted
    await db.client
      .collection(collectionNames.recommendations)
      .doc(recommendationId)
      .update({ status: "accepted", updatedAt: now });

    logger.info("Trade purchased", { userId, symbol, quantity, price, tradeCapital });

    sendJson(response, 201, {
      data: {
        tradeId: tradeRef.id,
        positionId: posRef.id,
        symbol,
        quantity,
        price,
        tradeCapital,
        remainingCapital: capitalResult.setup.remainingCapital
      }
    });
  } catch (err) {
    logger.error("POST /api/recommendation/purchased failed", {
      error: err instanceof Error ? err.message : String(err)
    });
    sendError(response, 500, "internal_error", "Failed to record purchase.");
  }
};

export default handler;
