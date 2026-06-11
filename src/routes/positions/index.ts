import { env } from "../../../config/env.js";
import { collectionNames } from "../../../models/index.js";
import { FirestoreService } from "../../../services/firestoreService.js";
import { MarketDataService } from "../../../services/marketDataService.js";
import type { ApiHandler } from "../../../types/api.js";
import { sendError, sendJson } from "../../../utils/http.js";
import { logger } from "../../../utils/logger.js";

/**
 * GET /api/open-positions
 *
 * Returns all open positions with live current price and unrealised P&L.
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
    const marketSvc = new MarketDataService();

    const snap = await db.client
      .collection(collectionNames.positions)
      .where("userId", "==", userId)
      .where("status", "==", "open")
      .get();

    const positions = snap.docs.map((d) => d.data());

    // Enrich with live prices
    const enriched = await Promise.all(
      positions.map(async (pos) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = pos as any;
        const market = await marketSvc.fetchSymbol(p.symbol as string);
        const currentPrice = market?.quote.price ?? p.averagePrice;
        const unrealisedPnL = parseFloat(
          ((currentPrice - p.averagePrice) * p.quantity).toFixed(2)
        );
        return { ...p, currentPrice, unrealisedPnL };
      })
    );

    const totalUnrealisedPnL = parseFloat(
      enriched.reduce((sum, p) => sum + p.unrealisedPnL, 0).toFixed(2)
    );

    sendJson(response, 200, {
      data: { positions: enriched, count: enriched.length, totalUnrealisedPnL }
    });
  } catch (err) {
    logger.error("GET /api/open-positions failed", {
      error: err instanceof Error ? err.message : String(err)
    });
    sendError(response, 500, "internal_error", "Failed to fetch open positions.");
  }
};

export default handler;


