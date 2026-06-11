import type { ApiHandler } from "../../../types/api.js";
import { sendJson } from "../../../utils/http.js";

/**
 * GET /api/notifications
 * Health check for the notifications namespace.
 */
const handler: ApiHandler = (_request, response) => {
  sendJson(response, 200, {
    data: {
      endpoints: [
        "POST /api/notifications/register",
        "POST /api/notifications/buy",
        "POST /api/notifications/exit"
      ]
    }
  });
};

export default handler;


