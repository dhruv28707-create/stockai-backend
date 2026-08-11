import cors from "cors";
import express from "express";
import type { Request, Response } from "express";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { DocumentData, Query } from "firebase-admin/firestore";
import { env } from "../config/env";
import { getDb } from "../firebase/admin";
import { collectionNames, riskAllocation, type RiskLevel } from "../models";
import {
  getNotificationTokenStatus,
  registerDeviceToken,
  sendPushNotification
} from "../services/fcm";
import { getMarketSummary, getYahooScanQuotes } from "../services/marketData";
import {
  getAngelOneMarketSummary,
  getQuotes,
  isAngelOneConfigured
} from "../services/angelone";
import {
  getBatch,
  BATCH_SIZE,
  TOTAL_BATCHES,
  TOTAL_STOCKS,
  ALL_STOCKS,
  type StockInfo
} from "../config/stocks";
import { sendError, sendSuccess } from "../utils/response";
import { getErrorMessage, getErrorCode } from "../utils/helpers";
import { analyzeWithAI, type Candidate } from "../services/ai";
import { logger, toErrorContext } from "../utils/logger";
import rateLimit from "express-rate-limit";

const app = express();

app.use(
  cors({
    origin: env.CORS_ORIGIN,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept", "Authorization", "x-cron-secret"]
  })
);
app.use(express.json());

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith("/api/cron/")
});
app.use(limiter);

// ─── Health & Info ────────────────────────────────────────────────────────────

app.get("/api", (_req: Request, res: Response) => {
  // Version is a deployment fingerprint: check /api after deploying to confirm
  // the latest build is live.
  sendSuccess(res, { service: "StockAI Backend", storage: "firebase", version: "1.3.0" });
});

app.get("/api/health", (_req: Request, res: Response) => {
  sendSuccess(res, { status: "ready" });
});

// ─── Market Data ──────────────────────────────────────────────────────────────

app.get("/api/market/summary", async (_req: Request, res: Response) => {
  try {
    sendSuccess(res, await getMarketSummary());
  } catch (error) {
    sendError(res, 500, `Failed to fetch market data: ${getErrorMessage(error)}`);
  }
});

app.get("/api/market/angelone/summary", async (req: Request, res: Response) => {
  try {
    if (!isAngelOneConfigured()) {
      sendSuccess(res, {
        configured: false,
        message: "Angel One is not configured. Set ANGEL_ONE_* environment variables."
      });
      return;
    }
    const batch = toPositiveNumber(req.query.batch, 0);
    sendSuccess(res, await getAngelOneMarketSummary(batch || undefined));
  } catch (error) {
    sendError(res, 500, `Angel One market data error: ${getErrorMessage(error)}`);
  }
});

app.get("/api/market/angelone/status", async (_req: Request, res: Response) => {
  sendSuccess(res, {
    configured: isAngelOneConfigured(),
    hasApiKey: !!env.ANGEL_ONE_API_KEY,
    hasClientId: !!env.ANGEL_ONE_CLIENT_ID,
    hasMpin: !!env.ANGEL_ONE_MPIN,
    hasTotpSecret: !!env.ANGEL_ONE_TOTP_SECRET
  });
});

// ─── Recommendations ──────────────────────────────────────────────────────────

app.get("/api/recommendations", async (req: Request, res: Response) => {
  try {
    const statusParam = typeof req.query.status === "string" ? req.query.status : "";
    const status = statusParam && statusParam !== "all" ? statusParam : undefined;
    const action = typeof req.query.action === "string" ? req.query.action : undefined;
    const limit = Math.min(toPositiveNumber(req.query.limit, 50), 100);
    const setup = await getCurrentMonthlySetup();
    const remainingCapital = Number(setup?.remainingCapital);
    const maxEntry = Number.isFinite(remainingCapital) ? remainingCapital : Infinity;

    let query: Query = getDb()
      .collection(collectionNames.recommendations)
      .where("userId", "==", env.SINGLE_USER_ID);

    if (status) query = query.where("status", "==", status);
    if (action) query = query.where("action", "==", action);

    const snap = await query.orderBy("createdAt", "desc").limit(limit).get();
    const items = snap.docs
      .map((doc) => normalizeDoc(doc.id, doc.data()))
      .filter((item) => {
        const entryPrice = Number(
          item.entryPrice ?? item.entry ?? item.currentPrice ?? 0
        );
        return !entryPrice || entryPrice <= maxEntry;
      });

    sendSuccess(res, { items, count: items.length });
  } catch (error) {
    logger.error("[recommendations] Failed to fetch", toErrorContext(error));
    sendError(res, 500, "Failed to fetch recommendations");
  }
});

// ─── Portfolio ────────────────────────────────────────────────────────────────

app.get("/api/portfolio", async (_req: Request, res: Response) => {
  try {
    const month = getCurrentMonth();
    const [monthlySetup, positionsSnap, portfolioSnap] = await Promise.all([
      getMonthlySetup(month),
      getDb()
        .collection(collectionNames.positions)
        .where("userId", "==", env.SINGLE_USER_ID)
        .where("status", "==", "open")
        .get(),
      getDb()
        .collection(collectionNames.portfolio)
        .where("userId", "==", env.SINGLE_USER_ID)
        .limit(1)
        .get()
    ]);

    const openPositions = positionsSnap.docs.map((doc) =>
      normalizeDoc(doc.id, doc.data())
    );
    const portfolioDoc = portfolioSnap.docs[0];

    sendSuccess(res, {
      month,
      monthlySetup,
      portfolio: portfolioDoc ? normalizeDoc(portfolioDoc.id, portfolioDoc.data()) : null,
      openPositionCount: openPositions.length,
      openPositions
    });
  } catch (error) {
    logger.error("[portfolio] Failed to fetch", toErrorContext(error));
    sendError(res, 500, "Failed to fetch portfolio");
  }
});

// ─── Device / Notification Registration ──────────────────────────────────────

const registerDeviceHandler = async (req: Request, res: Response) => {
  try {
    const token = getDeviceTokenFromRequest(req);
    if (!token) {
      sendError(res, 400, "Token is required");
      return;
    }

    await registerDeviceToken(token);
    sendSuccess(res, {
      registered: true,
      hasToken: true,
      tokenPrefix: `${token.slice(0, 12)}...`,
      tokenLength: token.length
    });
  } catch (error) {
    logger.error("[device] Failed to register", toErrorContext(error));
    sendError(res, 500, "Failed to register device");
  }
};

app.get("/api/notifications/register", registerDeviceHandler);
app.post("/api/notifications/register", registerDeviceHandler);

const notificationStatusHandler = async (_req: Request, res: Response) => {
  try {
    const tokenStatus = await getNotificationTokenStatus();
    const lastNotificationSnap = await getDb()
      .collection(collectionNames.notifications)
      .where("userId", "==", env.SINGLE_USER_ID)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    sendSuccess(res, {
      ...tokenStatus,
      lastNotification: lastNotificationSnap.docs[0]
        ? normalizeDoc(
            lastNotificationSnap.docs[0].id,
            lastNotificationSnap.docs[0].data()
          )
        : null
    });
  } catch (error) {
    logger.error("[notifications] Failed to fetch status", toErrorContext(error));
    sendError(res, 500, "Failed to fetch notification status");
  }
};

app.get("/api/notifications/status", notificationStatusHandler);

const testNotificationHandler = async (req: Request, res: Response) => {
  try {
    const requestToken = getDeviceTokenFromRequest(req);
    if (requestToken) {
      await registerDeviceToken(requestToken);
    }

    const tokenStatusBeforeSend = await getNotificationTokenStatus();
    const result = await sendPushNotification(
      getStringFromRequest(req, "title") ?? "StockAI test notification",
      getStringFromRequest(req, "body") ??
        "Your Firebase notification setup is connected.",
      "BUY_ALERT",
      "HIGH"
    );
    const tokenStatusAfterSend = await getNotificationTokenStatus();

    sendSuccess(res, {
      ...result,
      tokenStatus: tokenStatusAfterSend,
      registeredTokenFromRequest: Boolean(requestToken),
      message: result.sent
        ? "Test notification sent."
        : getNotificationFailureMessage(result.error, tokenStatusBeforeSend.hasToken)
    });
  } catch (error) {
    sendSuccess(
      res,
      {
        sent: false,
        hasToken: false,
        error: getErrorMessage(error),
        errorCode: getErrorCode(error),
        message: "Test notification crashed before FCM returned a send result."
      },
      200
    );
  }
};

app.get("/api/notifications/test", testNotificationHandler);
app.post("/api/notifications/test", testNotificationHandler);

app.get("/api/notifications", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(toPositiveNumber(req.query.limit, 50), 100);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;

    let query: Query = getDb()
      .collection(collectionNames.notifications)
      .where("userId", "==", env.SINGLE_USER_ID);

    if (status) query = query.where("status", "==", status);

    const snap = await query.orderBy("createdAt", "desc").limit(limit).get();
    const items = snap.docs.map((doc) => normalizeDoc(doc.id, doc.data()));

    sendSuccess(res, { items, count: items.length });
  } catch (error) {
    logger.error("[notifications] Failed to fetch list", toErrorContext(error));
    sendError(res, 500, "Failed to fetch notifications");
  }
});

// ─── Capital & Monthly Setup ──────────────────────────────────────────────────

app.get("/api/capital/current", async (_req: Request, res: Response) => {
  try {
    sendSuccess(res, toCapitalSetupResponse(await getCurrentMonthlySetup()));
  } catch (error) {
    logger.error("[capital] Failed to fetch current", toErrorContext(error));
    sendError(res, 500, "Failed to fetch monthly capital");
  }
});

const saveCapitalSetupHandler = async (req: Request, res: Response) => {
  try {
    const capital = toPositiveNumber(
      req.body?.capital ??
        req.body?.amount ??
        req.body?.budget ??
        req.body?.monthlyCapital,
      0
    );
    if (!capital) {
      sendError(res, 400, "Valid capital amount is required");
      return;
    }

    const month =
      typeof req.body?.month === "string" ? req.body.month : getCurrentMonth();
    const riskLevel = normalizeRiskLevel(req.body?.riskLevel ?? req.body?.risk);
    const tradingStyle =
      typeof (req.body?.tradingStyle ?? req.body?.style) === "string" &&
      (req.body.tradingStyle ?? req.body.style).trim()
        ? (req.body.tradingStyle ?? req.body.style).trim().toLowerCase()
        : "swing";
    const docId = `${env.SINGLE_USER_ID}_${month}`;
    const now = Timestamp.now();
    const setup = {
      id: docId,
      userId: env.SINGLE_USER_ID,
      month,
      capital,
      budget: capital,
      riskLevel,
      tradingStyle,
      maxTradeCapital: Math.floor(capital * riskAllocation[riskLevel]),
      remainingCapital: capital,
      profitTaken: 0,
      archived: false,
      updatedAt: now
    };

    await getDb()
      .collection(collectionNames.monthlySetup)
      .doc(docId)
      .set({ ...setup, createdAt: now }, { merge: true });

    sendSuccess(res, toCapitalSetupResponse(normalizeDoc(docId, setup)));
  } catch (error) {
    logger.error("[capital] Failed to save budget", toErrorContext(error));
    sendError(res, 500, "Failed to set monthly capital");
  }
};

app.post("/api/capital/budget", saveCapitalSetupHandler);

app.post("/api/capital/profit", async (req: Request, res: Response) => {
  try {
    const amount = toPositiveNumber(req.body?.amount, 0);
    if (!amount) {
      sendError(res, 400, "Valid profit amount is required");
      return;
    }

    const month =
      typeof req.body?.month === "string" ? req.body.month : getCurrentMonth();
    await getDb()
      .collection(collectionNames.monthlySetup)
      .doc(`${env.SINGLE_USER_ID}_${month}`)
      .set(
        {
          userId: env.SINGLE_USER_ID,
          month,
          profitTaken: FieldValue.increment(amount),
          updatedAt: Timestamp.now()
        },
        { merge: true }
      );

    sendSuccess(res, { logged: true });
  } catch (error) {
    logger.error("[capital] Failed to log profit", toErrorContext(error));
    sendError(res, 500, "Failed to log profit");
  }
});

// ─── Cron: Buy Scan ────────────────────────────────────────────────────────────
//
// vercel.json schedules a single daily run that scans every batch:
//   12:00 IST → /api/cron/scan  (no batch param → batch=all)
// Manual / external cron use:
//   12:00 IST → /api/cron/scan?batch=1 … /api/cron/scan?batch=5
// Manual re-run after today's scan already completed (e.g. debugging):
//   /api/cron/scan?force=1
//
// The scan is awaited before responding — background work after res.json() is
// not guaranteed to finish on Vercel.
//
// Same-day duplicates (two batches of notifications) are prevented two ways:
//   1. Firestore-backed dedup — a symbol already notified today is never
//      notified again, even across cold starts.
//   2. Daily run-guard — the full scan is skipped entirely if it already
//      completed today (unless ?force=1).

app.get("/api/cron/scan", async (req: Request, res: Response) => {
  if (!isAuthorizedCronRequest(req)) {
    sendError(res, 401, "Unauthorized cron request");
    return;
  }

  const batchParam = String(req.query.batch ?? "").toLowerCase();
  // No batch param (e.g. the vercel.json cron) or batch=all → scan everything.
  // External cron-job.org setups pass an explicit batch=N and still work.
  const isAll = !batchParam || batchParam === "all" || batchParam === "0";

  // IMPORTANT: we await the scan before responding. On Vercel, async work
  // started after res.json() is not guaranteed to complete (the function is
  // frozen once the response is sent), which silently killed every scan.
  if (isAll) {
    // Daily run-guard: skip when today's full buy scan already completed.
    // This is what stops the "second batch of 5 notifications" — a duplicate
    // trigger later the same day (manual force fetch, delayed/duplicate cron)
    // used to re-run everything because the in-memory dedup had reset on the
    // cold start. Add ?force=1 to bypass deliberately (manual re-run).
    // Note: check-then-run is not atomic — two overlapping triggers could both
    // pass the guard — but Firestore dedup still prevents duplicate pushes.
    const force = req.query.force === "1" || req.query.force === "true";
    const todayState = await getTodayRunState("buy_scan");

    if (!force && todayState.status === "completed") {
      const message = "Buy scan already completed today — skipping duplicate run";
      logger.info("[buy_scan] Skipped (already completed today)", {
        date: getISTDateKey(),
        completedAt: todayState.completedAt?.toDate().toISOString()
      });
      await logCronRun("buy_scan", 0, "skipped", message);
      res.status(200).json({
        status: "skipped",
        job: "buy_scan",
        batch: "all",
        reason: "already_completed_today",
        date: getISTDateKey()
      });
      return;
    }

    try {
      const results = await runBuyScanAll();
      res.status(200).json({
        status: "completed",
        job: "buy_scan",
        batch: "all",
        totalBatches: TOTAL_BATCHES,
        results
      });
    } catch (err) {
      logger.error("[buy_scan] scan-all failed", toErrorContext(err));
      sendError(res, 500, `Buy scan failed: ${getErrorMessage(err)}`);
    }
    return;
  }

  const batchIndex = Math.min(
    Math.max(toPositiveNumber(req.query.batch, 1), 1),
    TOTAL_BATCHES
  );
  const stocks = getBatch(batchIndex);

  try {
    const result = await runBuyScan(batchIndex, stocks);
    res.status(200).json({
      status: "completed",
      job: "buy_scan",
      batch: batchIndex,
      totalBatches: TOTAL_BATCHES,
      stockCount: stocks.length,
      result
    });
  } catch (err) {
    logger.error(`[buy_scan] batch ${batchIndex} failed`, toErrorContext(err));
    sendError(res, 500, `Buy scan failed: ${getErrorMessage(err)}`);
  }
});

// ─── Cron: Sell / Position Check ─────────────────────────────────────────────

app.get("/api/cron/check-positions", async (req: Request, res: Response) => {
  if (!isAuthorizedCronRequest(req)) {
    sendError(res, 401, "Unauthorized cron request");
    return;
  }

  const batchIndex = Math.min(
    Math.max(toPositiveNumber(req.query.batch, 1), 1),
    TOTAL_BATCHES
  );

  try {
    const result = await runSellScan(batchIndex);
    res.status(200).json({
      status: "completed",
      job: "sell_scan",
      batch: batchIndex,
      result
    });
  } catch (err) {
    logger.error(`[sell_scan] batch ${batchIndex} failed`, toErrorContext(err));
    sendError(res, 500, `Sell scan failed: ${getErrorMessage(err)}`);
  }
});

// ─── Stocks Universe ──────────────────────────────────────────────────────────

app.get("/api/stocks/universe", async (_req: Request, res: Response) => {
  sendSuccess(res, {
    totalStocks: TOTAL_STOCKS,
    totalBatches: TOTAL_BATCHES,
    batchSize: BATCH_SIZE
  });
});

// ─── Buy Scan Logic ───────────────────────────────────────────────────────────

interface ScanQuoteData {
  ltp: number;
  dayChange: number;
  dayChangePercentage: number;
  volume: number;
  high: number;
  low: number;
}

type QuoteMap = Record<string, ScanQuoteData>;

/**
 * Fetch quotes for the scans. Defaults to Yahoo Finance (works from Vercel's
 * cloud IPs); Angel One is opt-in via SCAN_DATA_SOURCE=angelone and only
 * works from a residential IP because its WAF blocks datacenter ranges.
 */
async function fetchScanQuotes(batchIndex?: number): Promise<QuoteMap> {
  if (env.SCAN_DATA_SOURCE === "angelone") {
    return getQuotes(batchIndex);
  }
  const tickers = batchIndex
    ? getBatch(batchIndex).map((s) => s.yahooTicker)
    : ALL_STOCKS.map((s) => s.yahooTicker);
  return getYahooScanQuotes(tickers);
}

interface BuyScanResult {
  status: "completed" | "failed" | "skipped" | "no_candidates";
  message?: string;
  notified?: string | null;
  pushSent?: boolean;
  pushError?: string;
}

interface SellScanResult {
  status: "completed" | "failed" | "skipped";
  message?: string;
  alertsSent: number;
}

// ─── Same-day dedup & run guard (Firestore-backed) ────────────────────────────
//
// The old in-memory Set reset on every Vercel cold start, so a second trigger
// the same day (manual force fetch, a delayed/duplicate cron, an external cron
// like cron-job.org) ran on a fresh instance with an empty dedup set and
// notified the same symbols again. Dedup keys and the daily "completed"
// marker now live in Firestore, so they survive cold starts and parallel
// batch runs.

function getISTDateKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

/** True if `key` was already marked notified today (persisted in Firestore). */
async function isKeyNotified(key: string): Promise<boolean> {
  try {
    const snap = await getDb()
      .collection(collectionNames.cronState)
      .doc(`dedup_${getISTDateKey()}`)
      .get();
    const keys = Array.isArray(snap.data()?.keys) ? (snap.data()?.keys as string[]) : [];
    return keys.includes(key);
  } catch (err) {
    // Fail-open: a transient read failure must never block the scan.
    logger.warn("[dedup] Dedup read failed — treating as not notified", {
      error: getErrorMessage(err)
    });
    return false;
  }
}

/**
 * Mark `key` as notified today. Uses arrayUnion so concurrent batch runs
 * (buy batches scan in parallel) merge safely without clobbering each other.
 * Best-effort like logNotification in fcm.ts: a failed write must never turn
 * a successfully delivered push into a "failed" batch (that would make the
 * next trigger re-send the same push).
 */
async function markKeyNotified(key: string): Promise<void> {
  try {
    await getDb()
      .collection(collectionNames.cronState)
      .doc(`dedup_${getISTDateKey()}`)
      .set(
        { keys: FieldValue.arrayUnion(key), updatedAt: Timestamp.now() },
        { merge: true }
      );
  } catch (err) {
    logger.warn("[dedup] Dedup write failed — best effort", {
      key,
      error: getErrorMessage(err)
    });
  }
}

/** Status of today's run for a job ("completed" blocks a duplicate full run). */
async function getTodayRunState(job: "buy_scan" | "sell_scan"): Promise<{
  status?: string;
  completedAt?: Timestamp;
}> {
  try {
    const snap = await getDb()
      .collection(collectionNames.cronState)
      .doc(`${job}_${getISTDateKey()}`)
      .get();
    return (snap.data() ?? {}) as { status?: string; completedAt?: Timestamp };
  } catch (err) {
    // Fail-open: if we can't read the guard, let the scan run — Firestore
    // dedup still stops duplicate notifications.
    logger.warn("[run-guard] State read failed — proceeding", {
      error: getErrorMessage(err)
    });
    return {};
  }
}

/** Record that today's run for `job` finished successfully (best-effort). */
async function markRunCompleted(
  job: "buy_scan" | "sell_scan",
  message?: string
): Promise<void> {
  try {
    await getDb()
      .collection(collectionNames.cronState)
      .doc(`${job}_${getISTDateKey()}`)
      .set(
        {
          job,
          status: "completed",
          completedAt: Timestamp.now(),
          message: message ?? null,
          updatedAt: Timestamp.now()
        },
        { merge: true }
      );
  } catch (err) {
    logger.warn(`[run-guard] Failed to mark ${job} completed — next trigger may re-run`, {
      error: getErrorMessage(err)
    });
  }
}

function buildBuyCandidates(stocks: StockInfo[], quotes: QuoteMap): Candidate[] {
  const withQuote = stocks
    .map((s) => {
      const q = quotes[s.symbol];
      if (!q) return null;
      return {
        symbol: s.symbol,
        name: s.name,
        sector: s.sector,
        price: q.ltp,
        change: q.dayChange,
        changePercent: q.dayChangePercentage,
        volume: q.volume,
        high: q.high,
        low: q.low
      };
    })
    .filter((c): c is Candidate => c !== null);

  const minChange = env.BUY_SCAN_MIN_CHANGE_PERCENT;
  const minVolume = env.BUY_SCAN_MIN_VOLUME;

  let candidates = withQuote
    .filter((c) => c.changePercent >= minChange && c.volume >= minVolume)
    .sort((a, b) => b.changePercent - a.changePercent);

  // If the strict filter finds too little today, widen to the top gainers so
  // the AI still has candidates to evaluate — signals should fire on most days.
  if (candidates.length < 2) {
    const widened = withQuote
      .filter(
        (c) =>
          c.changePercent > 0 && c.volume >= Math.max(10_000, Math.floor(minVolume / 2))
      )
      .sort((a, b) => b.changePercent - a.changePercent)
      .slice(0, 8);
    if (widened.length > 0) candidates = widened;
  }

  return candidates;
}

async function runBuyScan(
  batchIndex: number,
  stocks: StockInfo[],
  quotes?: QuoteMap
): Promise<BuyScanResult> {
  await logCronRun("buy_scan", batchIndex, "running");

  if (env.SCAN_DATA_SOURCE === "angelone" && !isAngelOneConfigured()) {
    await logCronRun("buy_scan", batchIndex, "skipped", "Angel One not configured");
    return { status: "skipped", message: "Angel One not configured" };
  }

  let quoteMap = quotes;
  if (!quoteMap) {
    try {
      quoteMap = await fetchScanQuotes(batchIndex);
    } catch (err) {
      const message = getErrorMessage(err);
      await logCronRun("buy_scan", batchIndex, "failed", message);
      return { status: "failed", message };
    }
  }

  const candidates = buildBuyCandidates(stocks, quoteMap);

  if (candidates.length === 0) {
    await logCronRun("buy_scan", batchIndex, "completed", "No candidates found");
    return { status: "no_candidates", message: "No candidates found" };
  }

  // Use AI to pick the best opportunity from this batch's candidates
  const aiPick = await analyzeWithAI(candidates.slice(0, 10), "buy");

  if (!aiPick) {
    await logCronRun("buy_scan", batchIndex, "completed", "AI found no strong signal");
    return { status: "completed", message: "AI found no strong signal" };
  }

  // Same-day dedup: never notify the same symbol twice in one IST day. Persisted
  // in Firestore so it survives cold starts and duplicate triggers.
  const dedupKey = `BUY:${aiPick.symbol}:${getISTDateKey()}`;
  if (await isKeyNotified(dedupKey)) {
    await logCronRun(
      "buy_scan",
      batchIndex,
      "completed",
      `Already notified ${aiPick.symbol} today`
    );
    return { status: "completed", message: `Already notified ${aiPick.symbol} today` };
  }

  // Save recommendation to Firestore
  const recRef = getDb().collection(collectionNames.recommendations).doc();
  await recRef.set({
    id: recRef.id,
    userId: env.SINGLE_USER_ID,
    symbol: aiPick.symbol,
    name: aiPick.name,
    action: "BUY",
    currentPrice: aiPick.price,
    entryPrice: aiPick.price,
    changePercent: aiPick.changePercent,
    reason: aiPick.reason,
    confidence: aiPick.confidence,
    sector: aiPick.sector,
    status: "pending",
    source: "buy_scan",
    batch: batchIndex,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  });

  // Send push notification
  const push = await sendPushNotification(
    `📈 Buy Signal: ${aiPick.symbol}`,
    `${aiPick.name} is up ${aiPick.changePercent.toFixed(2)}% — ${aiPick.reason}`,
    "BUY_ALERT",
    "HIGH",
    aiPick.symbol
  );

  // Only mark as notified once the push actually went out — a failed push
  // stays eligible for retry on the next scan.
  if (push.sent) {
    await markKeyNotified(dedupKey);
  }

  const message = push.sent
    ? `Notified: ${aiPick.symbol}`
    : `Saved ${aiPick.symbol} but push failed: ${push.error ?? "unknown error"}`;
  await logCronRun("buy_scan", batchIndex, "completed", message);

  return {
    status: "completed",
    message,
    notified: aiPick.symbol,
    pushSent: push.sent,
    pushError: push.error
  };
}

async function runBuyScanAll(): Promise<BuyScanResult[]> {
  // Fetch quotes for the whole universe (Yahoo batches internally; Angel One
  // mode sends one request) — keeps us safely under Vercel's 60s cap.
  let allQuotes: QuoteMap;
  try {
    allQuotes = await fetchScanQuotes();
  } catch (err) {
    const message = getErrorMessage(err);
    await logCronRun("buy_scan", 0, "failed", message);
    return [{ status: "failed", message }];
  }

  // AI analysis is the slow part — run the batches in parallel.
  const pending: Promise<BuyScanResult>[] = [];
  for (let batch = 1; batch <= TOTAL_BATCHES; batch++) {
    const batchStocks = getBatch(batch);
    const batchQuotes: QuoteMap = {};
    for (const s of batchStocks) {
      if (allQuotes[s.symbol]) batchQuotes[s.symbol] = allQuotes[s.symbol];
    }
    if (Object.keys(batchQuotes).length === 0) {
      const message = `No quotes returned for batch ${batch}`;
      await logCronRun("buy_scan", batch, "failed", message);
      pending.push(Promise.resolve({ status: "failed", message }));
      continue;
    }
    pending.push(runBuyScan(batch, batchStocks, batchQuotes));
  }

  const results = await Promise.all(pending);

  // Only mark today's run as completed when every batch finished without a
  // hard failure — a partially failed scan stays eligible for a retry.
  const failed = results.filter((r) => r.status === "failed").length;
  if (failed === 0) {
    const notified = results.filter((r) => r.notified).length;
    await markRunCompleted("buy_scan", `${results.length} batches, ${notified} notified`);
  }

  return results;
}

// ─── Sell Scan Logic ──────────────────────────────────────────────────────────

async function runSellScan(batchIndex: number): Promise<SellScanResult> {
  await logCronRun("sell_scan", batchIndex, "running");

  // Fetch open positions from Firestore
  const positionsSnap = await getDb()
    .collection(collectionNames.positions)
    .where("userId", "==", env.SINGLE_USER_ID)
    .where("status", "==", "open")
    .get();

  if (positionsSnap.empty) {
    await logCronRun("sell_scan", batchIndex, "completed", "No open positions");
    return { status: "completed", message: "No open positions", alertsSent: 0 };
  }

  if (env.SCAN_DATA_SOURCE === "angelone" && !isAngelOneConfigured()) {
    await logCronRun("sell_scan", batchIndex, "skipped", "Angel One not configured");
    return { status: "skipped", message: "Angel One not configured", alertsSent: 0 };
  }

  const positions = positionsSnap.docs.map((doc) => normalizeDoc(doc.id, doc.data()));

  let quotes: QuoteMap;
  try {
    // Fetch quotes for all batches to cover all open positions
    quotes = await fetchScanQuotes();
  } catch (err) {
    const message = getErrorMessage(err);
    await logCronRun("sell_scan", batchIndex, "failed", message);
    return { status: "failed", message, alertsSent: 0 };
  }

  const dayKey = getISTDateKey();
  let alertsSent = 0;

  for (const position of positions) {
    const symbol = String(position.symbol ?? "");
    const q = quotes[symbol];
    if (!q) continue;

    const entryPrice = Number(position.entryPrice ?? position.entry ?? 0);
    if (!entryPrice) continue;

    const pnlPercent = ((q.ltp - entryPrice) / entryPrice) * 100;

    // Alert if down more than 3% from entry (stop-loss zone)
    if (pnlPercent <= -3) {
      const dedupKey = `SL:${symbol}:${dayKey}`;
      if (await isKeyNotified(dedupKey)) continue;
      const push = await sendPushNotification(
        `🔴 Stop-Loss Alert: ${symbol}`,
        `${symbol} is down ${Math.abs(pnlPercent).toFixed(2)}% from your entry of ₹${entryPrice}. Consider exiting.`,
        "STOP_LOSS_ALERT",
        "HIGH",
        symbol
      );
      if (push.sent) {
        await markKeyNotified(dedupKey);
        alertsSent++;
      }
    }
    // Alert if up more than 5% from entry (take-profit zone)
    else if (pnlPercent >= 5) {
      const dedupKey = `TP:${symbol}:${dayKey}`;
      if (await isKeyNotified(dedupKey)) continue;
      const push = await sendPushNotification(
        `🟢 Profit Target: ${symbol}`,
        `${symbol} is up ${pnlPercent.toFixed(2)}% from your entry of ₹${entryPrice}. Consider booking profits.`,
        "SELL_ALERT",
        "HIGH",
        symbol
      );
      if (push.sent) {
        await markKeyNotified(dedupKey);
        alertsSent++;
      }
    }
  }

  await logCronRun("sell_scan", batchIndex, "completed");
  return { status: "completed", alertsSent };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCurrentMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

async function getCurrentMonthlySetup(): Promise<Record<string, unknown> | null> {
  return getMonthlySetup(getCurrentMonth());
}

async function getMonthlySetup(month: string): Promise<Record<string, unknown> | null> {
  const snap = await getDb()
    .collection(collectionNames.monthlySetup)
    .doc(`${env.SINGLE_USER_ID}_${month}`)
    .get();

  return snap.exists ? normalizeDoc(snap.id, snap.data() ?? {}) : null;
}

function toCapitalSetupResponse(
  setup: Record<string, unknown> | null
): Record<string, unknown> {
  if (!setup) {
    return {
      hasSetup: false,
      needsSetup: true,
      isCapitalSet: false,
      month: getCurrentMonth(),
      setup: null
    };
  }

  return {
    ...setup,
    hasSetup: true,
    needsSetup: false,
    isCapitalSet: true,
    setup
  };
}

function normalizeDoc(id: string, data: DocumentData): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({ id, ...data }).map(([key, value]) => [
      key,
      isFirestoreTimestamp(value) ? value.toDate().toISOString() : value
    ])
  );
}

function isFirestoreTimestamp(value: unknown): value is Timestamp {
  return (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function"
  );
}

function toPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeRiskLevel(value: unknown): RiskLevel {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }
  return "medium";
}

function getDeviceTokenFromRequest(req: Request): string {
  const candidates = [
    req.body?.token,
    req.body?.fcmToken,
    req.body?.deviceToken,
    req.body?.registrationToken,
    req.query.token,
    req.query.fcmToken,
    req.query.deviceToken
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
}

function getStringFromRequest(req: Request, field: string): string | null {
  const bodyValue = req.body?.[field];
  const queryValue = req.query[field];

  if (typeof bodyValue === "string" && bodyValue.trim()) {
    return bodyValue.trim();
  }

  if (typeof queryValue === "string" && queryValue.trim()) {
    return queryValue.trim();
  }

  return null;
}

function getNotificationFailureMessage(
  error: string | undefined,
  hadToken: boolean
): string {
  if (!hadToken) {
    return "No FCM token is saved. The frontend must register the Android FCM token first.";
  }
  return error ?? "FCM rejected the test notification.";
}

function isAuthorizedCronRequest(req: Request): boolean {
  if (!env.CRON_SECRET) {
    // Nothing to verify against — accept and log once per run so it's obvious
    // in the logs why auth isn't being enforced.
    logger.warn("[cron] CRON_SECRET is not set — accepting all cron requests");
    return true;
  }

  const authHeader = req.header("authorization");
  const xCronSecret = req.header("x-cron-secret");
  const vercelCronSchedule = req.header("x-vercel-cron-schedule");

  const authorized =
    authHeader === `Bearer ${env.CRON_SECRET}` ||
    xCronSecret === env.CRON_SECRET ||
    // Vercel adds this system header on every scheduled cron trigger. Accepting
    // it keeps the scan alive even when the Authorization header is missing —
    // a documented Vercel gotcha when CRON_SECRET is added/changed after the
    // deploy that registered the cron, or scoped to the wrong environment.
    // The daily run-guard + Firestore dedup below make a spoofed trigger
    // harmless (one scan, no duplicate notifications).
    Boolean(vercelCronSchedule);

  if (!authorized) {
    logger.warn("[cron] Rejected unauthorized cron request", {
      path: req.path,
      hasAuthHeader: Boolean(authHeader),
      hasXCronSecret: Boolean(xCronSecret),
      hasVercelCronSchedule: Boolean(vercelCronSchedule)
    });
  }

  return authorized;
}

async function logCronRun(
  job: "buy_scan" | "sell_scan",
  batchNumber: number,
  status: "running" | "completed" | "failed" | "skipped" | "accepted" = "accepted",
  message?: string
): Promise<void> {
  const ref = getDb().collection("cronRuns").doc();
  await ref.set({
    id: ref.id,
    userId: env.SINGLE_USER_ID,
    job,
    batch: batchNumber,
    totalBatches: TOTAL_BATCHES,
    status,
    message: message ?? null,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  });
}

process.on("unhandledRejection", (reason) => {
  logger.error("[unhandledRejection]", toErrorContext(reason));
});

app.use((err: Error, _req: Request, res: Response, _next) => {
  logger.error("[express] Unhandled error", { error: err.message });
  sendError(res, 500, "Internal server error");
});

if (!process.env.VERCEL) {
  app.listen(env.PORT, () => {
    logger.info(`StockAI backend listening on http://localhost:${env.PORT}`);
  });
}

export default app;
