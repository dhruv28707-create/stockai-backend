import { z } from "zod";

import { NotificationService } from "../../../services/notificationService.js";
import type { ApiHandler } from "../../../types/api.js";
import { sendError, sendJson } from "../../../utils/http.js";
import { logger } from "../../../utils/logger.js";

const bodySchema = z.object({
  token: z.string().trim().min(1)
});

/**
 * POST /api/notifications/register
 *
 * Saves a new FCM device token to Firestore.
 * Call this from the Android app whenever the FCM token refreshes.
 */
const handler: ApiHandler = async (request, response) => {
  if (request.method !== "POST") {
    sendError(response, 405, "method_not_allowed", "Method not allowed.");
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
    const service = new NotificationService();
    await service.registerDeviceToken(parsed.data.token);
    sendJson(response, 200, { data: { registered: true } });
  } catch (err) {
    logger.error("Failed to register device token", {
      error: err instanceof Error ? err.message : String(err)
    });
    sendError(response, 500, "internal_error", "Failed to register device token.");
  }
};

export default handler;


