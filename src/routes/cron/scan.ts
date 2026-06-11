import { runMarketScan } from "../../../cron/scannerRun";
import type { ApiHandler } from "../../../types/api";
import { isAuthorizedCronRequest } from "../../../utils/auth";
import { sendError, sendJson } from "../../../utils/http";

/**
 * GET /api/cron/scan
 *
 * Called by Vercel cron every minute.
 * Scans the current rotating batch of ~30 Indian stocks.
 * Fires BUY / EXIT recommendations + FCM push when confidence >= 80%.
 */
const handler: ApiHandler = async (request, response) => {
  if (request.method !== "GET") {
    sendError(response, 405, "method_not_allowed", "Method not allowed.");
    return;
  }

  if (!isAuthorizedCronRequest(request)) {
    sendError(response, 401, "unauthorized", "Unauthorized cron request.");
    return;
  }

  await runMarketScan();

  sendJson(response, 200, { data: { status: "accepted" } });
};

export default handler;



