import { z } from "zod";

import { env } from "../../config/env";
import { yearMonthSchema } from "../../models";
import { MonthlySetupService } from "../../services/monthlySetupService";
import type { ApiHandler } from "../../types/api";
import { sendError, sendJson } from "../../utils/http";
import { logger } from "../../utils/logger";

const bodySchema = z.object({
  month: yearMonthSchema
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

  try {
    const service = new MonthlySetupService();
    const result = await service.archiveMonth({
      userId,
      month: parsed.data.month
    });

    if (!result.success) {
      sendError(response, 409, "conflict", result.error);
      return;
    }

    sendJson(response, 200, { data: result.setup });
  } catch (err) {
    logger.error("Failed to archive month", {
      error: err instanceof Error ? err.message : String(err)
    });
    sendError(response, 500, "internal_error", "Failed to archive month.");
  }
};

export default handler;
