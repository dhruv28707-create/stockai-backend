import { runPositionCheck } from "../../../cron/positionCheckRun";
import type { ApiHandler } from "../../../types/api";
import { isAuthorizedCronRequest } from "../../../utils/auth";
import { sendError, sendJson } from "../../../utils/http";

/**
 * GET /api/cron/check-positions
 *
 * Called once daily by Vercel cron, separate from /api/cron/scan.
 * Only checks YOUR open positions against their target/stoploss —
 * much faster than a full watchlist scan since it's just a handful
 * of symbols, not the full ~150-stock watchlist.
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

  await runPositionCheck();

  sendJson(response, 200, { data: { status: "accepted" } });
};

export default handler;
