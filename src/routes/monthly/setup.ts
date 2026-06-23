import { z } from "zod";

import { env } from "../../../config/env";
import { yearMonthSchema } from "../../../models";
import { MonthlySetupService } from "../../../services/monthlySetupService";
import type { ApiHandler } from "../../../types/api";
import { sendError, sendJson } from "../../../utils/http";
import { logger, toErrorContext } from "../../../utils/logger";

const bodySchema = z.object({
  month: yearMonthSchema,
  capital: z.number().finite().positive(),
  riskLevel: z.enum(["low", "medium", "high"]),
  tradingStyle: z.string().trim().min(1)
});

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

  // Parse body — Vercel exposes it as (request as any).body
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

  const { month, capital, riskLevel, tradingStyle } = parsed.data;

  try {
    const service = new MonthlySetupService();
    const result = await service.createMonthlySetup({
      userId,
      month,
      capital,
      riskLevel,
      tradingStyle
    });

    if (!result.success) {
      sendError(response, 409, "conflict", result.error);
      return;
    }

    sendJson(response, 201, { data: result.setup });
  } catch (err) {
    logger.error("Failed to create monthly setup", { ...toErrorContext(err) });
    sendError(response, 500, "internal_error", "Failed to create monthly setup.");
  }
};

export default handler;


