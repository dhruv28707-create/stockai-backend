import { env } from "../../../config/env.js";
import { collectionNames } from "../../../models/index.js";
import { FirestoreService } from "../../../services/firestoreService.js";
import { MonthlySetupService } from "../../../services/monthlySetupService.js";
import type { ApiHandler } from "../../../types/api.js";
import { sendError, sendJson } from "../../../utils/http.js";
import { logger, toErrorContext } from "../../../utils/logger.js";

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

  const withLabel = <T>(label: string, promise: Promise<T>): Promise<T> =>
    promise.catch((cause: unknown) => {
      logger.error(`Portfolio sub-query failed: ${label}`, { ...toErrorContext(cause) });
      throw new Error(`Portfolio sub-query failed: ${label}`);
    });

  try {
    const db = new FirestoreService();
    const monthlySetupSvc = new MonthlySetupService();

    const month = new Date().toISOString().slice(0, 7); // YYYY-MM

    const [monthlySetup, openPositionsSnap, portfolioSnap] = await Promise.all([
      withLabel("monthlySetup", monthlySetupSvc.getSetup(userId, month)),
      withLabel("openPositions", db.client
        .collection(collectionNames.positions)
        .where("userId", "==", userId)
        .get()),
      withLabel("portfolio", db.client
        .collection(collectionNames.portfolio)
        .where("userId", "==", userId)
        .limit(1)
        .get())
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
    logger.error("GET /api/portfolio failed", { ...toErrorContext(err) });
    const message = err instanceof Error ? err.message : "Failed to fetch portfolio.";
    sendError(response, 500, "internal_error", message);
  }
};

export default handler;


