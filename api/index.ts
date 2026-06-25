import cors from "cors";
import express from "express";
import type { Request, Response } from "express";

import portfolioHandler from "../src/routes/portfolio/index.js";
import recommendationsHandler from "../src/routes/recommendations/index.js";
import recommendationPurchasedHandler from "../src/routes/recommendation/purchased.js";
import recommendationSkippedHandler from "../src/routes/recommendation/skipped.js";
import openPositionsHandler from "../src/routes/positions/index.js";
import positionExitHandler from "../src/routes/position/exit.js";
import positionHoldHandler from "../src/routes/position/hold.js";
// KEY CHANGE: daily/weekly report generation removed — the report cron
// slot is now used for a second daily market scan instead (see
// cron/dailyStockCheck.ts removal and vercel.json). ReportService and
// its models are left in place in case they're needed again later, but
// no route or cron calls them anymore.
import missedTradesHandler from "../src/routes/missed-trades/index.js";
import scanMarketHandler from "../src/routes/scan/index.js";
import cronScanHandler from "../src/routes/cron/scan.js";
import registerDeviceHandler from "../src/routes/notifications/register.js";
import notificationsListHandler from "../src/routes/notifications/list.js";
import marketSummaryHandler from "../src/routes/market/summary.js";
import monthlySetupHandler from "../src/routes/monthly/setup.js";
import healthHandler from "../src/routes/health.js";

const app = express();

// ── CORS — must be before all routes ────────────────────────
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept", "Authorization"]
  })
);

app.use(express.json());

const wrap =
  (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response) =>
    handler(req, res);

// ── Routes ───────────────────────────────────────────────────
app.all("/api/portfolio", wrap(portfolioHandler));
app.all("/api/recommendations", wrap(recommendationsHandler));
app.all("/api/recommendation/purchased", wrap(recommendationPurchasedHandler));
app.all("/api/recommendation/skipped", wrap(recommendationSkippedHandler));
app.all("/api/open-positions", wrap(openPositionsHandler));
app.all("/api/position/exit", wrap(positionExitHandler));
app.all("/api/position/hold", wrap(positionHoldHandler));
app.all("/api/missed-trades", wrap(missedTradesHandler));
app.all("/api/scan-market", wrap(scanMarketHandler));
app.all("/api/cron/scan", wrap(cronScanHandler));
app.all("/api/register-device", wrap(registerDeviceHandler));
app.all("/api/notifications", wrap(notificationsListHandler));
app.all("/api/market/summary", wrap(marketSummaryHandler));
app.all("/api/month/start", wrap(monthlySetupHandler));
app.all("/api/health", wrap(healthHandler));

app.get("/api", (_req, res) => {
  res.json({ data: { service: "android-ai-stock-assistant-backend", status: "ready" } });
});

export default app;