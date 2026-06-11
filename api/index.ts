import express from "express";
import type { Request, Response } from "express";

// Route handlers
import portfolioHandler from "./portfolio/index.js";
import recommendationsHandler from "./recommendations/index.js";
import recommendationPurchasedHandler from "./recommendation/purchased.js";
import recommendationSkippedHandler from "./recommendation/skipped.js";
import openPositionsHandler from "./positions/index.js";
import positionExitHandler from "./position/exit.js";
import positionHoldHandler from "./position/hold.js";
import dailyReportHandler from "./reports/daily.js";
import weeklyReportHandler from "./reports/weekly.js";
import missedTradesHandler from "./missed-trades/index.js";
import scanMarketHandler from "./scan/index.js";
import registerDeviceHandler from "./notifications/register.js";
import monthlySetupHandler from "./monthly/setup.js";
import cronDailyHandler from "./cron/daily.js";
import healthHandler from "./health.js";

const app = express();
app.use(express.json());

// Wrap each ApiHandler (uses raw req/res) into Express route
const wrap = (handler: (req: Request, res: Response) => unknown) =>
  (req: Request, res: Response) => handler(req, res);

app.all("/api/portfolio",              wrap(portfolioHandler));
app.all("/api/recommendations",        wrap(recommendationsHandler));
app.all("/api/recommendation/purchased", wrap(recommendationPurchasedHandler));
app.all("/api/recommendation/skipped",   wrap(recommendationSkippedHandler));
app.all("/api/open-positions",         wrap(openPositionsHandler));
app.all("/api/position/exit",          wrap(positionExitHandler));
app.all("/api/position/hold",          wrap(positionHoldHandler));
app.all("/api/daily-report",           wrap(dailyReportHandler));
app.all("/api/weekly-report",          wrap(weeklyReportHandler));
app.all("/api/missed-trades",          wrap(missedTradesHandler));
app.all("/api/scan-market",            wrap(scanMarketHandler));
app.all("/api/register-device",        wrap(registerDeviceHandler));
app.all("/api/month/start",            wrap(monthlySetupHandler));
app.all("/api/cron/daily",             wrap(cronDailyHandler));
app.all("/api/health",                 wrap(healthHandler));

app.get("/api", (_req, res) => {
  res.json({ data: { service: "android-ai-stock-assistant-backend", status: "ready" } });
});

export default app;