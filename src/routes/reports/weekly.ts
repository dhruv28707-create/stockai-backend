import { z } from "zod";

import { env } from "../../../config/env.js";
import { ReportService } from "../../../services/reportService.js";
import type { ApiHandler } from "../../../types/api.js";
import { sendError, sendJson } from "../../../utils/http.js";
import { logger, toErrorContext } from "../../../utils/logger.js";

const querySchema = z.object({
  date: z.string().trim().date().optional()
});

/**
 * GET /api/reports/weekly?date=YYYY-MM-DD
 * Returns the weekly report for the week containing the given date.
 * Defaults to the current week.
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

  try {
    const service = new ReportService();
    const report = await service.generateWeeklyReport(userId, parsed.data.date);
    sendJson(response, 200, { data: report });
  } catch (err) {
    logger.error("Failed to generate weekly report", { ...toErrorContext(err) });
    sendError(response, 500, "internal_error", "Failed to generate weekly report.");
  }
};

export default handler;


