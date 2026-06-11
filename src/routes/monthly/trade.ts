import { z } from "zod";

import { env } from "../../../config/env";
import { yearMonthSchema } from "../../../models";
import { MonthlySetupService } from "../../../services/monthlySetupService";
import type { ApiHandler } from "../../../types/api";
import { sendError, sendJson } from "../../../utils/http";
import { logger } from "../../../utils/logger";

/**
 * POST /api/monthly/trade
 *
 * action = "purchase" → purchaseTrade()
 * action = "skip"     → skipTrade()
 * action = "exit"     → exitTrade()
 * action = "hold"     → holdTrade()
 */

const baseSchema = z.object({
  month: yearMonthSchema,
  action: z.enum(["purchase", "skip", "exit", "hold"])
});

const purchaseSchema = baseSchema.extend({
  action: z.literal("purchase"),
  tradeCapital: z.number().finite().positive()
});

const skipSchema = baseSchema.extend({
  action: z.literal("skip"),
  recommendationId: z.string().trim().min(1),
  reason: z.string().trim().min(1)
});

const exitSchema = baseSchema.extend({
  action: z.literal("exit"),
  returnedCapital: z.number().finite().nonnegative()
});

const holdSchema = baseSchema.extend({
  action: z.literal("hold"),
  recommendationId: z.string().trim().min(1)
});

const bodySchema = z.discriminatedUnion("action", [
  purchaseSchema,
  skipSchema,
  exitSchema,
  holdSchema
]);

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

  const body = parsed.data;
  const service = new MonthlySetupService();

  try {
    let result;

    switch (body.action) {
      case "purchase":
        result = await service.purchaseTrade({
          userId,
          month: body.month,
          tradeCapital: body.tradeCapital
        });
        break;

      case "skip":
        result = await service.skipTrade({
          userId,
          month: body.month,
          recommendationId: body.recommendationId,
          reason: body.reason
        });
        break;

      case "exit":
        result = await service.exitTrade({
          userId,
          month: body.month,
          returnedCapital: body.returnedCapital
        });
        break;

      case "hold":
        result = await service.holdTrade({
          userId,
          month: body.month,
          recommendationId: body.recommendationId
        });
        break;
    }

    if (!result.success) {
      sendError(response, 400, "trade_error", result.error);
      return;
    }

    sendJson(response, 200, { data: result.setup });
  } catch (err) {
    logger.error("Trade action failed", {
      action: body.action,
      error: err instanceof Error ? err.message : String(err)
    });
    sendError(response, 500, "internal_error", "Trade action failed.");
  }
};

export default handler;


