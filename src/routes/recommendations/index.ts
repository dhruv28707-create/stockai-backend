import { z } from "zod";

import { env } from "../../../config/env.js";
import { collectionNames } from "../../../models/index.js";
import { FirestoreService } from "../../../services/firestoreService.js";
import type { ApiHandler } from "../../../types/api.js";
import { sendError, sendJson } from "../../../utils/http.js";
import { logger, toErrorContext } from "../../../utils/logger.js";

const querySchema = z.object({
  status: z.enum(["pending", "reviewed", "accepted", "dismissed"]).optional(),
  action: z.enum(["buy", "sell", "hold", "watch"]).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20)
});

/**
 * GET /api/recommendations?status=pending&action=buy&limit=20
 *
 * Returns recommendations for the current user, newest first.
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

  const { status, action, limit } = parsed.data;

  try {
    const db = new FirestoreService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = db.client
      .collection(collectionNames.recommendations)
      .where("userId", "==", userId);

    if (status) query = query.where("status", "==", status);
    if (action) query = query.where("action", "==", action);

    query = query.orderBy("createdAt", "desc").limit(limit);

    const snap = await query.get();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = snap.docs.map((d: any) => d.data());

    sendJson(response, 200, { data: { items, count: items.length } });
  } catch (err) {
    logger.error("GET /api/recommendations failed", { ...toErrorContext(err) });
    sendError(response, 500, "internal_error", "Failed to fetch recommendations.");
  }
};

export default handler;


