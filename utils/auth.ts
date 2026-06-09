import { env } from "../config/env";
import type { ApiRequest } from "../types/api";

export const isAuthorizedCronRequest = (request: ApiRequest): boolean => {
  const configuredSecret = env.CRON_SECRET;
  const providedSecret = request.headers["x-cron-secret"];

  if (!configuredSecret || typeof providedSecret !== "string") {
    return false;
  }

  return providedSecret === configuredSecret;
};
