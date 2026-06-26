import { env } from "../config/env";
import { PositionCheckService } from "../services/positionCheckService";
import { logger } from "../utils/logger";

/**
 * Lightweight job: only checks YOUR open positions against their
 * target/stoploss, not the full watchlist. Designed to run later in
 * the day as the 2nd of Vercel Hobby's 2 allowed daily cron jobs,
 * separate from the morning watchlist scan (runMarketScan).
 */
export const runPositionCheck = async (): Promise<void> => {
  const userId = env.SINGLE_USER_ID;

  if (!userId) {
    logger.warn("runPositionCheck: SINGLE_USER_ID not set — aborting");
    return;
  }

  logger.info("runPositionCheck: starting");

  const service = new PositionCheckService();
  const summary = await service.checkPositions(userId);

  logger.info("runPositionCheck: complete", { summary });
};
