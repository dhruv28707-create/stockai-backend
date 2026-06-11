import { z } from "zod";

import { env } from "../../../config/env.js";
import { collectionNames } from "../../../models/index.js";
import { FirestoreService } from "../../../services/firestoreService.js";
import type { ApiHandler } from "../../../types/api.js";
import { sendError, sendJson } from "../../../utils/http.js";
import { logger } from "../../../utils/logger.js";

const querySchema = z.object({
  from: z.string().trim().date().optional(),
  to: z.string().trim().date().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20)
});

/**
 * GET /api/missed-trades?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=20
 *
 * Returns missed trades for the current user, newest first.
 * Optionally filter by date range.
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawQuery = (request as any).query as unknown;
  const parsed = querySchema.safeParse(rawQuery);
  if (!parsed.success) {
    sendError(response, 400, "validation_error",
      parsed.error.issues.map((i) => i.message).join(", "));
    return;
  }

  const { from, to, limit } = parsed.data;

  try {
    const db = new FirestoreService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = db.client
      .collection(collectionNames.missedTrades)
      .where("userId", "==", userId);

    if (from) query = query.where("observedOn", ">=", from);
    if (to)   query = query.where("observedOn", "<=", to);

    query = query.orderBy("observedOn", "desc").limit(limit);

    const snap = await query.get();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = snap.docs.map((d: any) => d.data());

    sendJson(response, 200, { data: { items, count: items.length } });
  } catch (err) {
    logger.error("GET /api/missed-trades failed", {
      error: err instanceof Error ? err.message : String(err)
    });
    sendError(response, 500, "internal_error", "Failed to fetch missed trades.");
  }
};

export default handler;


