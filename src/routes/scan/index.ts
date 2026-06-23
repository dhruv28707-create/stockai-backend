import { env } from "../../../config/env.js";
import { ScannerService } from "../../../services/scannerService.js";
import type { ApiHandler } from "../../../types/api.js";
import { sendError, sendJson } from "../../../utils/http.js";
import { logger, toErrorContext } from "../../../utils/logger.js";

/**
 * POST /api/scan-market
 *
 * Manually triggers a market scan for the current batch.
 * Same logic as the cron scan — useful for testing and on-demand use.
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

  try {
    const scanner = new ScannerService();
    const summary = await scanner.runScan(userId);

    sendJson(response, 200, { data: summary });
  } catch (err) {
    logger.error("POST /api/scan-market failed", { ...toErrorContext(err) });
    sendError(response, 500, "internal_error", "Market scan failed.");
  }
};

export default handler;


