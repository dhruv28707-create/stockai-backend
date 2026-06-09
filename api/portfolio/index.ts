import { env } from "../../config/env.js";
import { collectionNames } from "../../models/index.js";
import { FirestoreService } from "../../services/firestoreService.js";
import { MonthlySetupService } from "../../services/monthlySetupService.js";
import type { ApiHandler } from "../../types/api.js";
import { sendError, sendJson } from "../../utils/http.js";
import { logger } from "../../utils/logger.js";

/**
 * GET /api/portfolio
 *
 * Returns the current month's setup (capital, risk, remaining capital)
 * plus open position count and portfolio document.
 */
const handler: ApiHandler = async (request, response) => {
  if (request.method !== "GET") {
    sendError(response, 405, "method_not_allowed", "Method not allowed.");
    return;
  }

  const userId = env.SINGLE_USER_ID;
  if (!userId) {
    sendError(response, 500, "misconfigured", "SINGLE_USER_ID is not set.");
    return;
  }

  try {
    const db = new FirestoreService();
    const monthlySetupSvc = new MonthlySetupService();

    const month = new Date().toISOString().slice(0, 7); // YYYY-MM

    const [monthlySetup, openPositionsSnap, portfolioSnap] = await Promise.all([
      monthlySetupSvc.getSetup(userId, month),
      db.client
        .collection(collectionNames.positions)
        .where("userId", "==", userId)
        .get(),
      db.client
        .collection(collectionNames.portfolio)
        .where("userId", "==", userId)
        .limit(1)
        .get()
    ]);

    const openPositions = openPositionsSnap.docs.map((d) => d.data());
    const portfolio = portfolioSnap.docs[0]?.data() ?? null;

    sendJson(response, 200, {
      data: {
        month,
        monthlySetup,
        portfolio,
        openPositionCount: openPositions.length,
        openPositions
      }
    });
  } catch (err) {
    logger.error("GET /api/portfolio failed", {
      error: err instanceof Error ? err.message : String(err)
    });
    sendError(response, 500, "internal_error", "Failed to fetch portfolio.");
  }
};

export default handler;
