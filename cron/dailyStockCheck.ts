import { env } from "../config/env.js";
import { ReportService } from "../services/reportService.js";
import { logger } from "../utils/logger.js";

/**
 * Runs at 3:30 PM IST (10:00 UTC) Mon–Fri — market close.
 * Generates the daily report and (on Fridays) the weekly report.
 */
export const runDailyStockCheck = async (): Promise<void> => {
  const userId = env.SINGLE_USER_ID;

  if (!userId) {
    logger.warn("runDailyStockCheck: SINGLE_USER_ID not set — aborting");
    return;
  }

  logger.info("runDailyStockCheck: starting");

  const service = new ReportService();

  // Always generate daily report
  const daily = await service.generateDailyReport(userId);
  logger.info("Daily report generated", { reportDate: daily.reportDate });

  // Generate weekly report on Fridays (UTC day = 5)
  const dayOfWeek = new Date().getUTCDay();
  if (dayOfWeek === 5) {
    const weekly = await service.generateWeeklyReport(userId);
    logger.info("Weekly report generated", {
      weekStart: weekly.weekStart,
      weekEnd: weekly.weekEnd
    });
  }

  logger.info("runDailyStockCheck: complete");
};
