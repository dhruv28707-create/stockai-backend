import express from "express";
import type { Request, Response } from "express";

import portfolioHandler from "../src/routes/portfolio/index.js";
import recommendationsHandler from "../src/routes/recommendations/index.js";
import recommendationPurchasedHandler from "../src/routes/recommendation/purchased.js";
import recommendationSkippedHandler from "../src/routes/recommendation/skipped.js";
import openPositionsHandler from "../src/routes/positions/index.js";
import positionExitHandler from "../src/routes/position/exit.js";
import positionHoldHandler from "../src/routes/position/hold.js";
import dailyReportHandler from "../src/routes/reports/daily.js";
import weeklyReportHandler from "../src/routes/reports/weekly.js";
import missedTradesHandler from "../src/routes/missed-trades/index.js";
import scanMarketHandler from "../src/routes/scan/index.js";
import registerDeviceHandler from "../src/routes/notifications/register.js";
import monthlySetupHandler from "../src/routes/monthly/setup.js";
import cronDailyHandler from "../src/routes/cron/daily.js";
import healthHandler from "../src/routes/health.js";

const app = express();
app.use(express.json());

const wrap = (handler: (req: Request, res: Response) => unknown) =>
  (req: Request, res: Response) => handler(req, res);

app.all("/api/portfolio",                wrap(portfolioHandler));
app.all("/api/recommendations",          wrap(recommendationsHandler));
app.all("/api/recommendation/purchased", wrap(recommendationPurchasedHandler));
app.all("/api/recommendation/skipped",   wrap(recommendationSkippedHandler));
app.all("/api/open-positions",           wrap(openPositionsHandler));
app.all("/api/position/exit",            wrap(positionExitHandler));
app.all("/api/position/hold",            wrap(positionHoldHandler));
app.all("/api/daily-report",             wrap(dailyReportHandler));
app.all("/api/weekly-report",            wrap(weeklyReportHandler));
app.all("/api/missed-trades",            wrap(missedTradesHandler));
app.all("/api/scan-market",              wrap(scanMarketHandler));
app.all("/api/register-device",          wrap(registerDeviceHandler));
app.all("/api/month/start",              wrap(monthlySetupHandler));
app.all("/api/cron/daily",               wrap(cronDailyHandler));
app.all("/api/health",                   wrap(healthHandler));

app.get("/api", (_req, res) => {
  res.json({ data: { service: "android-ai-stock-assistant-backend", status: "ready" } });
});

export default app;
