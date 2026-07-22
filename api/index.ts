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
import { getMarketSummary } from "../services/marketData";
import {
  getAngelOneMarketSummary,
  getQuotes,
  isAngelOneConfigured
} from "../services/angelone";
import { getBatch, BATCH_SIZE, TOTAL_BATCHES, TOTAL_STOCKS } from "../config/stocks";
import { sendError, sendSuccess } from "../utils/response";

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept", "Authorization", "x-cron-secret"]
  })
);
app.use(express.json());

// ─── Health & Info ────────────────────────────────────────────────────────────

app.get("/api", (_req: Request, res: Response) => {
  sendSuccess(res, { service: "StockAI Backend", storage: "firebase", version: "1.0.0" });
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
    hasApiKey: !!process.env.ANGEL_ONE_API_KEY,
    hasClientId: !!process.env.ANGEL_ONE_CLIENT_ID,
    hasMpin: !!process.env.ANGEL_ONE_MPIN,
    hasTotpSecret: !!process.env.ANGEL_ONE_TOTP_SECRET
  });
});

// ─── Recommendations ──────────────────────────────────────────────────────────

app.get("/api/recommendations", async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : "pending";
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
  } catch {
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
  } catch {
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
  } catch {
    sendError(res, 500, "Failed to register device");
  }
};

app.get("/api/notifications/register", registerDeviceHandler);
app.post("/api/notifications/register", registerDeviceHandler);
app.get("/api/register-device", registerDeviceHandler);
app.post("/api/register-device", registerDeviceHandler);
app.post("/api/device/register", registerDeviceHandler);
app.post("/api/fcm/register", registerDeviceHandler);
app.get("/api/device/register", registerDeviceHandler);
app.get("/api/fcm/register", registerDeviceHandler);
app.post("/api/api/notifications/register", registerDeviceHandler);
app.post("/api/api/register-device", registerDeviceHandler);
app.post("/notifications/register", registerDeviceHandler);
app.post("/register-device", registerDeviceHandler);
app.get("/api/api/notifications/register", registerDeviceHandler);
app.get("/api/api/register-device", registerDeviceHandler);
app.get("/notifications/register", registerDeviceHandler);
app.get("/register-device", registerDeviceHandler);

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
  } catch {
    sendError(res, 500, "Failed to fetch notification status");
  }
};

app.get("/api/notifications/status", notificationStatusHandler);
app.get("/api/notifications/debug", notificationStatusHandler);
app.get("/api/api/notifications/status", notificationStatusHandler);
app.get("/notifications/status", notificationStatusHandler);

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
app.get("/api/notifications/test-send", testNotificationHandler);
app.post("/api/notifications/test-send", testNotificationHandler);
app.get("/api/test-notification", testNotificationHandler);
app.post("/api/test-notification", testNotificationHandler);
app.get("/api/send-test-notification", testNotificationHandler);
app.post("/api/send-test-notification", testNotificationHandler);
app.get("/api/api/notifications/test", testNotificationHandler);
app.post("/api/api/notifications/test", testNotificationHandler);
app.get("/notifications/test", testNotificationHandler);
app.post("/notifications/test", testNotificationHandler);

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
  } catch {
    sendError(res, 500, "Failed to fetch notifications");
  }
});

// ─── Capital & Monthly Setup ──────────────────────────────────────────────────

app.get("/api/capital/current", async (_req: Request, res: Response) => {
  try {
    sendSuccess(res, toCapitalSetupResponse(await getCurrentMonthlySetup()));
  } catch {
    sendError(res, 500, "Failed to fetch monthly capital");
  }
});
app.get("/api/capital", async (_req: Request, res: Response) => {
  try {
    sendSuccess(res, toCapitalSetupResponse(await getCurrentMonthlySetup()));
  } catch {
    sendError(res, 500, "Failed to fetch monthly capital");
  }
});
app.get("/capital/current", async (_req: Request, res: Response) => {
  try {
    sendSuccess(res, toCapitalSetupResponse(await getCurrentMonthlySetup()));
  } catch {
    sendError(res, 500, "Failed to fetch monthly capital");
  }
});
app.get("/api/month/current", async (_req: Request, res: Response) => {
  try {
    sendSuccess(res, toCapitalSetupResponse(await getCurrentMonthlySetup()));
  } catch {
    sendError(res, 500, "Failed to fetch monthly capital");
  }
});
app.get("/api/monthly/setup", async (_req: Request, res: Response) => {
  try {
    sendSuccess(res, toCapitalSetupResponse(await getCurrentMonthlySetup()));
  } catch {
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
  } catch {
    sendError(res, 500, "Failed to set monthly capital");
  }
};

app.post("/api/capital/budget", saveCapitalSetupHandler);
app.post("/api/month/start", saveCapitalSetupHandler);
app.post("/api/monthly/setup", saveCapitalSetupHandler);
app.post("/api/month/setup", saveCapitalSetupHandler);
app.post("/api/api/capital/budget", saveCapitalSetupHandler);
app.post("/api/api/month/start", saveCapitalSetupHandler);
app.post("/capital/budget", saveCapitalSetupHandler);
app.post("/month/start", saveCapitalSetupHandler);

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
  } catch {
    sendError(res, 500, "Failed to log profit");
  }
});

// ─── Cron: Buy Scan (called by cron-job.org, one batch per call) ──────────────
//
// cron-job.org hits these URLs on schedule:
//   12:00 → /api/cron/scan?batch=1
//   12:05 → /api/cron/scan?batch=2
//   12:10 → /api/cron/scan?batch=3
//   12:15 → /api/cron/scan?batch=4
//   12:20 → /api/cron/scan?batch=5

app.get("/api/cron/scan", async (req: Request, res: Response) => {
  if (!isAuthorizedCronRequest(req)) {
    sendError(res, 401, "Unauthorized cron request");
    return;
  }

  const batchParam = toPositiveNumber(req.query.batch, 1);
  const batchIndex = Math.min(Math.max(batchParam, 1), TOTAL_BATCHES);
  const stocks = getBatch(batchIndex);

  // Respond immediately so Vercel doesn't time out waiting for us.
  // The actual scan runs after this line — Vercel keeps the function alive
  // until the async work resolves (or hits maxDuration: 60 in vercel.json).
  res.status(200).json({
    status: "accepted",
    job: "buy_scan",
    batch: batchIndex,
    totalBatches: TOTAL_BATCHES,
    stockCount: stocks.length,
    stocks: stocks.map((s) => s.symbol)
  });

  // Kick off the real work after responding
  runBuyScan(batchIndex, stocks).catch((err) => {
    console.error(`[buy_scan] batch ${batchIndex} failed:`, err);
  });
});

// ─── Cron: Sell / Position Check ─────────────────────────────────────────────

app.get("/api/cron/check-positions", async (req: Request, res: Response) => {
  if (!isAuthorizedCronRequest(req)) {
    sendError(res, 401, "Unauthorized cron request");
    return;
  }

  const batchParam = toPositiveNumber(req.query.batch, 1);
  const batchIndex = Math.min(Math.max(batchParam, 1), TOTAL_BATCHES);
  const stocks = getBatch(batchIndex);

  res.status(200).json({
    status: "accepted",
    job: "sell_scan",
    batch: batchIndex,
    totalBatches: TOTAL_BATCHES,
    stockCount: stocks.length,
    stocks: stocks.map((s) => s.symbol)
  });

  runSellScan(batchIndex).catch((err) => {
    console.error(`[sell_scan] batch ${batchIndex} failed:`, err);
  });
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

interface StockInfo {
  symbol: string;
  name: string;
  sector: string;
}

async function runBuyScan(batchIndex: number, stocks: StockInfo[]): Promise<void> {
  await logCronRun("buy_scan", batchIndex, "running");

  if (!isAngelOneConfigured()) {
    await logCronRun("buy_scan", batchIndex, "skipped", "Angel One not configured");
    return;
  }

  let quotes: Record<
    string,
    {
      ltp: number;
      dayChange: number;
      dayChangePercentage: number;
      volume: number;
      high: number;
      low: number;
      open: number;
      close: number;
    }
  >;

  try {
    quotes = (await getQuotes(batchIndex)) as typeof quotes;
  } catch (err) {
    await logCronRun("buy_scan", batchIndex, "failed", getErrorMessage(err));
    return;
  }

  // Find stocks showing strong upward movement
  const candidates = stocks
    .filter((s) => {
      const q = quotes[s.symbol];
      if (!q) return false;
      // Criteria: up >1.5% on the day with decent volume
      return q.dayChangePercentage >= 1.5 && q.volume > 50_000;
    })
    .map((s) => {
      const q = quotes[s.symbol];
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
    .sort((a, b) => b.changePercent - a.changePercent);

  if (candidates.length === 0) {
    await logCronRun("buy_scan", batchIndex, "completed", "No candidates found");
    return;
  }

  // Use AI to pick the best opportunity from this batch's candidates
  const aiPick = await analyzeWithAI(candidates, "buy");

  if (!aiPick) {
    await logCronRun("buy_scan", batchIndex, "completed", "AI found no strong signal");
    return;
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
  await sendPushNotification(
    `📈 Buy Signal: ${aiPick.symbol}`,
    `${aiPick.name} is up ${aiPick.changePercent.toFixed(2)}% — ${aiPick.reason}`,
    "BUY_ALERT",
    "HIGH",
    aiPick.symbol
  );

  await logCronRun("buy_scan", batchIndex, "completed", `Notified: ${aiPick.symbol}`);
}

// ─── Sell Scan Logic ──────────────────────────────────────────────────────────

async function runSellScan(batchIndex: number): Promise<void> {
  await logCronRun("sell_scan", batchIndex, "running");

  // Fetch open positions from Firestore
  const positionsSnap = await getDb()
    .collection(collectionNames.positions)
    .where("userId", "==", env.SINGLE_USER_ID)
    .where("status", "==", "open")
    .get();

  if (positionsSnap.empty) {
    await logCronRun("sell_scan", batchIndex, "completed", "No open positions");
    return;
  }

  if (!isAngelOneConfigured()) {
    await logCronRun("sell_scan", batchIndex, "skipped", "Angel One not configured");
    return;
  }

  const positions = positionsSnap.docs.map((doc) => normalizeDoc(doc.id, doc.data()));

  let quotes: Record<
    string,
    { ltp: number; dayChange: number; dayChangePercentage: number; volume: number }
  >;
  try {
    // Fetch quotes for all batches to cover all open positions
    quotes = (await getQuotes()) as typeof quotes;
  } catch (err) {
    await logCronRun("sell_scan", batchIndex, "failed", getErrorMessage(err));
    return;
  }

  for (const position of positions) {
    const symbol = String(position.symbol ?? "");
    const q = quotes[symbol];
    if (!q) continue;

    const entryPrice = Number(position.entryPrice ?? position.entry ?? 0);
    if (!entryPrice) continue;

    const pnlPercent = ((q.ltp - entryPrice) / entryPrice) * 100;

    // Alert if down more than 3% from entry (stop-loss zone)
    if (pnlPercent <= -3) {
      await sendPushNotification(
        `🔴 Stop-Loss Alert: ${symbol}`,
        `${symbol} is down ${Math.abs(pnlPercent).toFixed(2)}% from your entry of ₹${entryPrice}. Consider exiting.`,
        "STOP_LOSS_ALERT",
        "HIGH",
        symbol
      );
    }
    // Alert if up more than 5% from entry (take-profit zone)
    else if (pnlPercent >= 5) {
      await sendPushNotification(
        `🟢 Profit Target: ${symbol}`,
        `${symbol} is up ${pnlPercent.toFixed(2)}% from your entry of ₹${entryPrice}. Consider booking profits.`,
        "SELL_ALERT",
        "HIGH",
        symbol
      );
    }
  }

  await logCronRun("sell_scan", batchIndex, "completed");
}

// ─── AI Analysis ─────────────────────────────────────────────────────────────

interface Candidate {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
}

interface AIPick {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  changePercent: number;
  reason: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

async function analyzeWithAI(
  candidates: Candidate[],
  type: "buy" | "sell"
): Promise<AIPick | null> {
  const prompt = `You are a stock market analyst for NSE (India). Analyze these ${type === "buy" ? "bullish" : "bearish"} stock candidates and pick the SINGLE best ${type} opportunity. Reply ONLY with valid JSON, no markdown, no explanation.

Candidates:
${JSON.stringify(candidates, null, 2)}

Return this exact JSON shape:
{
  "symbol": "STOCK_SYMBOL",
  "name": "Stock Name",
  "sector": "Sector",
  "price": 0,
  "changePercent": 0,
  "reason": "One sentence explanation under 20 words",
  "confidence": "HIGH" | "MEDIUM" | "LOW"
}

If none of these stocks show a genuinely strong ${type} signal, return: null`;

  if (!env.GEMINI_API_KEY) {
    // No AI key at all — fall back to top mover
    const top = candidates[0];
    return {
      symbol: top.symbol,
      name: top.name,
      sector: top.sector,
      price: top.price,
      changePercent: top.changePercent,
      reason: `Strong upward momentum of ${top.changePercent.toFixed(2)}%`,
      confidence: "MEDIUM"
    };
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 300
          }
        })
      }
    );

    const data = (await response.json()) as {
      candidates: Array<{
        content: { parts: Array<{ text: string }> };
      }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    // Strip any markdown fences Gemini might add
    const clean = text.replace(/```json|```/g, "").trim();

    if (clean === "null" || clean === "") return null;

    return JSON.parse(clean) as AIPick;
  } catch (err) {
    console.error("[analyzeWithAI] Gemini failed:", getErrorMessage(err));
    // Fallback: top candidate without AI reasoning
    const top = candidates[0];
    return {
      symbol: top.symbol,
      name: top.name,
      sector: top.sector,
      price: top.price,
      changePercent: top.changePercent,
      reason: `Strong momentum: up ${top.changePercent.toFixed(2)}% today`,
      confidence: "LOW"
    };
  }
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

function isAuthorizedCronRequest(req: Request): boolean {
  if (!env.CRON_SECRET) return true;
  return (
    req.header("authorization") === `Bearer ${env.CRON_SECRET}` ||
    req.header("x-cron-secret") === env.CRON_SECRET
  );
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

if (!process.env.VERCEL) {
  app.listen(env.PORT, () => {
    console.log(`StockAI backend listening on http://localhost:${env.PORT}`);
  });
}

export default app;
