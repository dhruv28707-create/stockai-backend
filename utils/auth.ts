import { env } from "../config/env";
import type { ApiRequest } from "../types/api";

/**
 * KEY FIX: Vercel's scheduled cron invocations automatically send
 * `Authorization: Bearer <CRON_SECRET>` — they do NOT send a custom
 * `x-cron-secret` header. The previous version only checked the custom
 * header, which Vercel's cron system never sets, so every real scheduled
 * cron call would have been rejected as unauthorized even with
 * CRON_SECRET configured correctly.
 *
 * This checks Vercel's real Authorization header first, and still
 * accepts the old x-cron-secret header as a fallback so manual testing
 * (e.g. curl, Postman) keeps working the same way it did before.
 */
export const isAuthorizedCronRequest = (request: ApiRequest): boolean => {
  const configuredSecret = env.CRON_SECRET;
  if (!configuredSecret) return false;

  const authHeader = request.headers["authorization"];
  if (typeof authHeader === "string" && authHeader === `Bearer ${configuredSecret}`) {
    return true;
  }

  const legacyHeader = request.headers["x-cron-secret"];
  if (typeof legacyHeader === "string" && legacyHeader === configuredSecret) {
    return true;
  }

  return false;
};
