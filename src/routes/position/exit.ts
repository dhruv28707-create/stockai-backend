import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";

import { env } from "../../../config/env.js";
import { collectionNames } from "../../../models/index.js";
import { FirestoreService } from "../../../services/firestoreService.js";
import { MonthlySetupService } from "../../../services/monthlySetupService.js";
import type { ApiHandler } from "../../../types/api.js";
import { sendError, sendJson } from "../../../utils/http.js";
import { logger, toErrorContext } from "../../../utils/logger.js";

const bodySchema = z.object({
  positionId: z.string().trim().min(1),
  symbol: z.string().trim().min(1).toUpperCase(),
  exitPrice: z.number().finite().positive(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
});

/**
 * POST /api/position/exit
 *
 * User confirms they exited an open position.
 * 1. Marks position as closed.
 * 2. Creates a sell trade document (status=filled).
 * 3. Returns capital (exitPrice × quantity) to monthly remaining capital.
 * 4. Updates any related EXIT recommendation to "accepted".
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

  const { positionId, symbol, exitPrice, month } = parsed.data;
  const today = new Date().toISOString().slice(0, 10);

  try {
    const db = new FirestoreService();
    const monthlySetupSvc = new MonthlySetupService();

    // Fetch the position
    const posSnap = await db.client
      .collection(collectionNames.positions)
      .doc(positionId)
      .get();

    if (!posSnap.exists) {
      sendError(response, 404, "not_found", "Position not found.");
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const position = posSnap.data() as any;
    const quantity: number = position.quantity;
    const averagePrice: number = position.averagePrice;
    const returnedCapital = parseFloat((exitPrice * quantity).toFixed(2));
    const pnl = parseFloat(((exitPrice - averagePrice) * quantity).toFixed(2));

    const now = Timestamp.now();

    // 1. Close the position
    await db.client
      .collection(collectionNames.positions)
      .doc(positionId)
      .update({ status: "closed", exitPrice, closedAt: today, updatedAt: now });

    // 2. Create sell trade
    const tradeRef = db.client.collection(collectionNames.trades).doc();
    await tradeRef.set({
      id: tradeRef.id,
      userId,
      symbol,
      side: "sell",
      status: "filled",
      quantity,
      price: exitPrice,
      currency: "INR",
      tradedOn: today,
      pnl,
      createdAt: now,
      updatedAt: now
    });

    // 3. Return capital to monthly setup
    const exitResult = await monthlySetupSvc.exitTrade({
      userId,
      month,
      returnedCapital
    });

    if (!exitResult.success) {
      logger.warn("exitTrade capital return failed (non-blocking)", {
        error: exitResult.error
      });
    }

    // 4. Accept any pending EXIT recommendation for this symbol
    const recSnap = await db.client
      .collection(collectionNames.recommendations)
      .where("userId", "==", userId)
      .where("symbol", "==", symbol)
      .where("action", "==", "sell")
      .where("status", "==", "pending")
      .limit(1)
      .get();

    if (!recSnap.empty) {
      await recSnap.docs[0]?.ref.update({ status: "accepted", updatedAt: now });
    }

    logger.info("Position exited", { userId, symbol, exitPrice, quantity, pnl });

    sendJson(response, 200, {
      data: {
        closed: true,
        positionId,
        tradeId: tradeRef.id,
        symbol,
        quantity,
        exitPrice,
        averagePrice,
        pnl,
        returnedCapital,
        remainingCapital: exitResult.success ? exitResult.setup.remainingCapital : null
      }
    });
  } catch (err) {
    logger.error("POST /api/position/exit failed", { ...toErrorContext(err) });
    sendError(response, 500, "internal_error", "Failed to exit position.");
  }
};

export default handler;


