import { runDailyStockCheck } from "../../../cron/dailyStockCheck";
import type { ApiHandler } from "../../../types/api";
import { isAuthorizedCronRequest } from "../../../utils/auth";
import { sendError, sendJson } from "../../../utils/http";

const handler: ApiHandler = async (request, response) => {
  if (request.method !== "GET") {
    sendError(response, 405, "method_not_allowed", "Method not allowed.");
    return;
  }

  if (!isAuthorizedCronRequest(request)) {
    sendError(response, 401, "unauthorized", "Unauthorized cron request.");
    return;
  }

  await runDailyStockCheck();

  sendJson(response, 200, {
    data: {
      status: "accepted"
    }
  });
};

export default handler;



