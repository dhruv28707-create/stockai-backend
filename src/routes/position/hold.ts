import { z } from "zod";

import { env } from "../../../config/env.js";
import { MonthlySetupService } from "../../../services/monthlySetupService.js";
import type { ApiHandler } from "../../../types/api.js";
import { sendError, sendJson } from "../../../utils/http.js";
import { logger } from "../../../utils/logger.js";

const bodySchema = z.object({
  recommendationId: z.string().trim().min(1),
  symbol: z.string().trim().min(1).toUpperCase(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
});

/**
 * POST /api/position/hold
 *
 * User acknowledges an EXIT recommendation but decides to hold.
 * No capital change. Logs the hold decision.
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

  const { recommendationId, symbol, month } = parsed.data;

  try {
    const monthlySetupSvc = new MonthlySetupService();
    const result = await monthlySetupSvc.holdTrade({
      userId,
      month,
      recommendationId
    });

    if (!result.success) {
      sendError(response, 400, "hold_error", result.error);
      return;
    }

    logger.info("Hold decision recorded", { userId, symbol, recommendationId });

    sendJson(response, 200, {
      data: { held: true, symbol, recommendationId }
    });
  } catch (err) {
    logger.error("POST /api/position/hold failed", {
      error: err instanceof Error ? err.message : String(err)
    });
    sendError(response, 500, "internal_error", "Failed to record hold decision.");
  }
};

export default handler;


