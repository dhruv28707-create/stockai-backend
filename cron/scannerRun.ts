import { env } from "../config/env";
import { ScannerService } from "../services/scannerService";
import { logger } from "../utils/logger";

export const runMarketScan = async (): Promise<void> => {
  const userId = env.SINGLE_USER_ID;

  if (!userId) {
    logger.warn("runMarketScan: SINGLE_USER_ID not set — aborting scan");
    return;
  }

  logger.info("runMarketScan: starting");

  const scanner = new ScannerService();
  const summary = await scanner.runScan(userId);

  logger.info("runMarketScan: complete", { summary });
};
