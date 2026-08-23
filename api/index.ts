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
import {
  getLiveMarketData,
  getMarketSummary,
  getYahooScanQuotes
} from "../services/marketData";
import { getISTTimestampLabel } from "../services/fcm";
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
import { analyzeWithAI, type AIPick, type Candidate } from "../services/ai";
import { logger, toErrorContext } from "../utils/logger";
import rateLimit from "express-rate-limit";

const app = express();

// Behind Vercel/NGINX proxies req.ip comes from X-Forwarded-For; without this
// express-rate-limit either trusts a spoofable header or throws validation
// errors on every request.
app.set("trust proxy", 1);

app.use(
  cors({
    origin: env.CORS_ORIGIN,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept", "Authorization", "x-cron-secret"]
  })
);
app.use(express.json());

app.use((_req: Request, res: Response, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

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
  sendSuccess(res, { service: "StockAI Backend", storage: "firebase", version: "1.7.0" });
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

// Live watchlist snapshot for the app's "moving digits" ticker. Poll this
// every few seconds (the response itself is cached for ~5s server-side).
// The user's saved wishlist stocks are merged into `quotes` so the Market Tab
// shows them moving live alongside the scan watchlist.
app.get("/api/market/live", async (_req: Request, res: Response) => {
  try {
    sendSuccess(res, await getLiveMarketData(await getUserWishlistSymbols()));
  } catch (error) {
    sendError(res, 500, `Failed to fetch live market data: ${getErrorMessage(error)}`);
  }
});

// ─── Wishlist ─────────────────────────────────────────────────────────────────

const WISHLIST_LIMIT = 30;
const VALID_SYMBOL = /^[A-Z0-9&\-.]{1,20}$/;

app.get("/api/market/wishlist", async (_req: Request, res: Response) => {
  try {
    const symbols = await getUserWishlistSymbols();
    if (symbols.length === 0) {
      sendSuccess(res, { items: [], count: 0 });
      return;
    }

    const live = await getLiveMarketData(symbols);
    const wanted = new Set(symbols);
    const items = live.quotes.filter((q) => wanted.has(q.symbol));

    sendSuccess(res, { items, count: items.length, updatedAt: live.updatedAt });
  } catch (error) {
    logger.error("[wishlist] Failed to fetch", toErrorContext(error));
    sendError(res, 500, "Failed to fetch wishlist");
  }
});

app.post("/api/market/wishlist", async (req: Request, res: Response) => {
  try {
    const symbol = String(req.body?.symbol ?? "")
      .trim()
      .toUpperCase();

    if (!VALID_SYMBOL.test(symbol)) {
      sendError(res, 400, "A valid NSE stock symbol is required");
      return;
    }

    // Verify the symbol actually resolves on Yahoo before persisting it.
    const quotes = await getYahooScanQuotes([`${symbol}.NS`]);
    if (!quotes[symbol]) {
      sendError(res, 404, `Symbol ${symbol} not found on NSE`);
      return;
    }

    const existing = await getUserWishlistSymbols();
    if (existing.includes(symbol)) {
      sendSuccess(res, { added: false, symbol, message: "Already in wishlist" });
      return;
    }
    if (existing.length >= WISHLIST_LIMIT) {
      sendError(res, 400, `Wishlist is full (max ${WISHLIST_LIMIT} stocks)`);
      return;
    }

    const docId = `${env.SINGLE_USER_ID}_${symbol}`;
    await getDb().collection(collectionNames.wishlist).doc(docId).set(
      {
        id: docId,
        userId: env.SINGLE_USER_ID,
        symbol,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      },
      { merge: true }
    );

    sendSuccess(res, { added: true, symbol });
  } catch (error) {
    logger.error("[wishlist] Failed to add", toErrorContext(error));
    sendError(res, 500, "Failed to add to wishlist");
  }
});

app.delete("/api/market/wishlist/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol ?? "")
      .trim()
      .toUpperCase();
    if (!VALID_SYMBOL.test(symbol)) {
      sendError(res, 400, "A valid stock symbol is required");
      return;
    }

    await getDb()
      .collection(collectionNames.wishlist)
      .doc(`${env.SINGLE_USER_ID}_${symbol}`)
      .delete();

    sendSuccess(res, { removed: true, symbol });
  } catch (error) {
    logger.error("[wishlist] Failed to remove", toErrorContext(error));
    sendError(res, 500, "Failed to remove from wishlist");
  }
});

// Server-Sent Events stream: pushes a fresh live snapshot every 5s while the
// client stays connected — the same data as /api/market/live, but the app
// doesn't need to poll; digits update on their own like Angel One's feed.
//
// Note for Vercel: serverless functions cap streaming at maxDuration (60s in
// vercel.json), so the connection drops and the client must reconnect (SSE
// clients do this automatically). When self-hosted (npm run dev/start) the
// stream stays open indefinitely.
app.get("/api/market/stream", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let closed = false;
  const send = (event: string, data: unknown) => {
    if (closed) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // client already gone — loop will stop on 'close'
    }
  };

  const pushLive = async () => {
    try {
      send("update", await getLiveMarketData(await getUserWishlistSymbols()));
    } catch (error) {
      send("error", { message: getErrorMessage(error) });
    }
  };

  await pushLive();

  const interval = setInterval(pushLive, 5_000);

  req.on("close", () => {
    closed = true;
    clearInterval(interval);
  });
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

    const snap = await fetchDocsSortedByCreatedAt(query, limit);
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

    const snap = await fetchDocsSortedByCreatedAt(query, limit);
    const items = snap.docs
      .map((doc) => normalizeDoc(doc.id, doc.data()))
      .map(ensureNotificationTimestamps);

    // Mark which notifications the user has already acted on: a BUY_ALERT
    // whose symbol has an open position is "bought". The app uses this when
    // expanding the notification to show "Bought ✓" instead of a Buy button.
    const openPositionIds = await getOpenPositionIdsBySymbol();
    const enrichedItems: Array<Record<string, unknown>> = items.map((item) => {
      const symbol = typeof item.symbol === "string" ? item.symbol : "";
      const positionId = symbol ? openPositionIds.get(symbol) : undefined;
      return {
        ...item,
        isBought: Boolean(positionId),
        positionId: positionId ?? null
      };
    });

    // Guaranteed newest-first order. Firestore's orderBy alone is not enough:
    // legacy docs with missing/mixed-type createdAt values interleave dates
    // (e.g. 17 Aug before 19 Aug), so re-sort deterministically by the
    // enriched epoch timestamp before responding.
    enrichedItems.sort(
      (a, b) => (Number(b.timestampMs) || 0) - (Number(a.timestampMs) || 0)
    );

    sendSuccess(res, { items: enrichedItems, count: enrichedItems.length });
  } catch (error) {
    logger.error("[notifications] Failed to fetch list", toErrorContext(error));
    sendError(res, 500, "Failed to fetch notifications");
  }
});

// ─── Trades (Trade tab) ──────────────────────────────────────────────────────

app.get("/api/trades", async (_req: Request, res: Response) => {
  try {
    const snap = await getDb()
      .collection(collectionNames.positions)
      .where("userId", "==", env.SINGLE_USER_ID)
      .get();
    const items = snap.docs
      .map((doc) => normalizeDoc(doc.id, doc.data()))
      .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));

    sendSuccess(res, {
      items,
      count: items.length,
      openCount: items.filter((t) => t.status === "open").length
    });
  } catch (error) {
    logger.error("[trades] Failed to fetch", toErrorContext(error));
    sendError(res, 500, "Failed to fetch trades");
  }
});

/**
 * Record a stock purchase coming from a buy notification (or manual entry):
 *   1. Creates an open position → shows up in the Trade tab (/api/trades)
 *      and in the portfolio (/api/portfolio openPositions).
 *   2. Appends/refreshes the holding on the portfolio document.
 *   3. Deducts the invested amount from the month's remaining capital.
 *   4. Marks the recommendation "executed" and the notification "bought".
 * Idempotent per symbol: an already-open position is returned as-is instead
 * of being duplicated.
 */
app.post("/api/trade/buy", async (req: Request, res: Response) => {
  try {
    const symbol = String(req.body?.symbol ?? "")
      .trim()
      .toUpperCase();
    if (!VALID_SYMBOL.test(symbol)) {
      sendError(res, 400, "A valid stock symbol is required");
      return;
    }

    const quantity = Math.floor(toPositiveNumber(req.body?.quantity, 0));
    const entryPrice = toPositiveNumber(
      req.body?.entryPrice ?? req.body?.price ?? req.body?.currentPrice,
      0
    );
    if (!quantity || !entryPrice) {
      sendError(res, 400, "Valid quantity and entry price are required");
      return;
    }

    // Idempotency: never open a second position for a symbol already held.
    const existingSnap = await getDb()
      .collection(collectionNames.positions)
      .where("userId", "==", env.SINGLE_USER_ID)
      .where("status", "==", "open")
      .where("symbol", "==", symbol)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      const existing = normalizeDoc(existingSnap.docs[0].id, existingSnap.docs[0].data());
      sendSuccess(res, {
        bought: false,
        alreadyOwned: true,
        message: `${symbol} is already in your portfolio`,
        position: existing
      });
      return;
    }

    const name = typeof req.body?.name === "string" ? req.body.name : symbol;
    const stopLoss = toPositiveNumber(req.body?.stopLoss, 0) || null;
    const target = toPositiveNumber(req.body?.target, 0) || null;
    const expectedReturn = Number(req.body?.expectedReturn) || null;
    const recommendationId =
      typeof req.body?.recommendationId === "string" ? req.body.recommendationId : null;
    const notificationId =
      typeof req.body?.notificationId === "string" ? req.body.notificationId : null;

    const now = Timestamp.now();
    const investedAmount = Math.round(quantity * entryPrice * 100) / 100;

    // 1. Open position (Trade tab + portfolio openPositions).
    const positionRef = getDb().collection(collectionNames.positions).doc();
    const positionData = {
      id: positionRef.id,
      userId: env.SINGLE_USER_ID,
      symbol,
      name,
      quantity,
      entryPrice,
      stopLoss,
      target,
      expectedReturn,
      investedAmount,
      status: "open",
      source: notificationId ? "notification" : "manual",
      recommendationId,
      notificationId,
      entryDate: now,
      createdAt: now,
      updatedAt: now
    };
    await positionRef.set(positionData);

    // 2. Portfolio document: holdings list + invested totals.
    await addHoldingToPortfolio({
      positionId: positionRef.id,
      symbol,
      name,
      quantity,
      entryPrice,
      stopLoss,
      target,
      expectedReturn,
      investedAmount,
      boughtAt: now.toDate().toISOString()
    });

    // 3. Deduct from this month's remaining capital (never below zero).
    const month = getCurrentMonth();
    const setup = await getMonthlySetup(month);
    if (setup) {
      const remaining = Math.max(
        0,
        Number(setup.remainingCapital) - investedAmount
      );
      await getDb()
        .collection(collectionNames.monthlySetup)
        .doc(`${env.SINGLE_USER_ID}_${month}`)
        .set(
          { remainingCapital: remaining, updatedAt: Timestamp.now() },
          { merge: true }
        );
    }

    // 4. Flip the recommendation + notification to bought (best-effort).
    if (recommendationId) {
      await getDb()
        .collection(collectionNames.recommendations)
        .doc(recommendationId)
        .set(
          { status: "executed", executedPositionId: positionRef.id, updatedAt: Timestamp.now() },
          { merge: true }
        )
        .catch(() => undefined);
    }
    if (notificationId) {
      await getDb()
        .collection(collectionNames.notifications)
        .doc(notificationId)
        .set(
          { isBought: true, boughtPositionId: positionRef.id, updatedAt: Timestamp.now() },
          { merge: true }
        )
        .catch(() => undefined);
    }

    sendSuccess(res, {
      bought: true,
      alreadyOwned: false,
      message: `Bought ${quantity} ${symbol} @ ₹${entryPrice.toFixed(2)}`,
      position: normalizeDoc(positionRef.id, positionData)
    });
  } catch (error) {
    logger.error("[trade] Failed to record buy", toErrorContext(error));
    sendError(res, 500, "Failed to record buy trade");
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
// vercel.json schedules one daily run that scans the ₹40–₹150 watchlist and
// notifies the best BUY_SCAN_TOP_PICKS opportunities (top-N, default 5):
//   12:00 PM IST → /api/cron/scan  (no batch param → batch=all)
// Manual / external cron use (legacy single-batch mode, still works):
//   12:00 IST → /api/cron/scan?batch=1
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
        {
          keys: FieldValue.arrayUnion(key),
          updatedAt: Timestamp.now(),
          // TTL hint: enable a TTL policy on "expireAt" in the Firebase
          // console so these daily docs clean themselves up.
          expireAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000)
        },
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
          updatedAt: Timestamp.now(),
          expireAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000)
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
  const minPrice = env.BUY_SCAN_MIN_PRICE;
  const maxPrice = env.BUY_SCAN_MAX_PRICE;

  if (maxPrice < minPrice) {
    // Misconfigured env would silently block every candidate — surface it.
    logger.warn("[buy_scan] BUY_SCAN_MAX_PRICE is below BUY_SCAN_MIN_PRICE", {
      minPrice,
      maxPrice
    });
  }

  // Price-band filter: this account trades ₹50–₹150 stocks, so a watchlist
  // name that crossed outside the band today (e.g. above ₹150) is skipped
  // rather than notified.
  let candidates = withQuote
    .filter(
      (c) =>
        c.changePercent >= minChange &&
        c.volume >= minVolume &&
        c.price >= minPrice &&
        c.price <= maxPrice
    )
    .sort((a, b) => b.changePercent - a.changePercent);

  // If the strict filter finds too little today, widen to the top gainers so
  // the AI still has candidates to evaluate — signals should fire on most days.
  if (candidates.length < 2) {
    const widened = withQuote
      .filter(
        (c) =>
          c.changePercent > 0 &&
          c.volume >= Math.max(10_000, Math.floor(minVolume / 2)) &&
          c.price >= minPrice &&
          c.price <= maxPrice
      )
      .sort((a, b) => b.changePercent - a.changePercent)
      .slice(0, 8);
    if (widened.length > 0) candidates = widened;
  }

  return candidates;
}

interface TradePlan {
  entryPrice: number;
  quantity: number;
  stopLoss: number;
  target: number;
  expectedReturnPercent: number;
  expectedReturn: number;
}

/**
 * Build a simple trade plan for a buy pick so the notification can tell the
 * user exactly what to do:
 *   - quantity  = max rupees to deploy per trade ÷ entry price
 *   - stop loss = entry × (1 − BUY_SCAN_STOP_LOSS_PERCENT%)
 *   - target    = entry × (1 + BUY_SCAN_TARGET_PERCENT%)
 *   - expected return (₹) = quantity × (target − entry)
 * Rupees per trade comes from the monthly setup's maxTradeCapital when one
 * exists, otherwise BUY_SCAN_DEFAULT_CAPITAL.
 */
async function buildTradePlan(entryPrice: number): Promise<TradePlan> {
  const setup = await getCurrentMonthlySetup();
  const maxTradeCapital = Number(setup?.maxTradeCapital);
  const tradeCapital =
    Number.isFinite(maxTradeCapital) && maxTradeCapital > 0
      ? maxTradeCapital
      : env.BUY_SCAN_DEFAULT_CAPITAL;

  const slPercent = env.BUY_SCAN_STOP_LOSS_PERCENT;
  const targetPercent = env.BUY_SCAN_TARGET_PERCENT;
  const quantity = Math.max(1, Math.floor(tradeCapital / entryPrice));
  const stopLoss = Math.round(entryPrice * (1 - slPercent / 100) * 100) / 100;
  const target = Math.round(entryPrice * (1 + targetPercent / 100) * 100) / 100;

  return {
    entryPrice,
    quantity,
    stopLoss,
    target,
    expectedReturnPercent: targetPercent,
    expectedReturn: Math.round(quantity * (target - entryPrice))
  };
}

/**
 * Save a buy recommendation and send its push notification (with same-day
 * dedup). Shared by legacy single-batch mode (1 pick) and the daily all-mode
 * (top-N picks), so both behave identically.
 */
async function handleBuyPick(batchIndex: number, pick: AIPick): Promise<BuyScanResult> {
  // Same-day dedup: never notify the same symbol twice in one IST day. Persisted
  // in Firestore so it survives cold starts and duplicate triggers.
  const dedupKey = `BUY:${pick.symbol}:${getISTDateKey()}`;
  if (await isKeyNotified(dedupKey)) {
    return { status: "completed", message: `Already notified ${pick.symbol} today` };
  }

  const plan = await buildTradePlan(pick.price);

  // Save recommendation to Firestore (trade plan included so the app can
  // render the same numbers the notification shows).
  const recRef = getDb().collection(collectionNames.recommendations).doc();
  await recRef.set({
    id: recRef.id,
    userId: env.SINGLE_USER_ID,
    symbol: pick.symbol,
    name: pick.name,
    action: "BUY",
    currentPrice: pick.price,
    entryPrice: plan.entryPrice,
    changePercent: pick.changePercent,
    reason: pick.reason,
    confidence: pick.confidence,
    sector: pick.sector,
    status: "pending",
    source: "buy_scan",
    batch: batchIndex,
    quantity: plan.quantity,
    stopLoss: plan.stopLoss,
    target: plan.target,
    expectedReturn: plan.expectedReturn,
    expectedReturnPercent: plan.expectedReturnPercent,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  });

  // Send push notification with the full trade plan. The plan fields are also
  // stored in the notification history so expanding the notification in the
  // app can render quantity / SL / target / expected profit, and the app can
  // call POST /api/trade/buy with these ids to record the purchase.
  const push = await sendPushNotification(
    `📈 Buy Signal: ${pick.symbol}`,
    [
      `${pick.name} is up ${pick.changePercent.toFixed(2)}% — ${pick.reason}`,
      `Buy ${plan.quantity} @ ₹${plan.entryPrice.toFixed(2)} | SL ₹${plan.stopLoss.toFixed(2)} | Target ₹${plan.target.toFixed(2)}`,
      `Exp. return ₹${plan.expectedReturn} (${plan.expectedReturnPercent}%)`
    ].join("\n"),
    "BUY_ALERT",
    "HIGH",
    pick.symbol,
    undefined,
    {
      recommendationId: recRef.id,
      name: pick.name,
      entryPrice: plan.entryPrice,
      quantity: plan.quantity,
      stopLoss: plan.stopLoss,
      target: plan.target,
      expectedReturn: plan.expectedReturn,
      expectedReturnPercent: plan.expectedReturnPercent
    }
  );

  // Only mark as notified once the push actually went out — a failed push
  // stays eligible for retry on the next scan.
  if (push.sent) {
    await markKeyNotified(dedupKey);
  }

  const message = push.sent
    ? `Notified: ${pick.symbol}`
    : `Saved ${pick.symbol} but push failed: ${push.error ?? "unknown error"}`;

  return {
    status: "completed",
    message,
    notified: pick.symbol,
    pushSent: push.sent,
    pushError: push.error
  };
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

  // Legacy single-batch mode (external crons): notify the 1 best pick.
  const picks = await analyzeWithAI(candidates.slice(0, 10), "buy", 1);

  if (picks.length === 0) {
    await logCronRun("buy_scan", batchIndex, "completed", "AI found no strong signal");
    return { status: "completed", message: "AI found no strong signal" };
  }

  const result = await handleBuyPick(batchIndex, picks[0]);
  await logCronRun("buy_scan", batchIndex, "completed", result.message);
  return result;
}

async function runBuyScanAll(): Promise<BuyScanResult[]> {
  if (env.SCAN_DATA_SOURCE === "angelone" && !isAngelOneConfigured()) {
    await logCronRun("buy_scan", 0, "skipped", "Angel One not configured");
    return [{ status: "skipped", message: "Angel One not configured" }];
  }

  // Fetch quotes for the whole watchlist in one go (Yahoo batches internally;
  // Angel One mode sends one request) — keeps us safely under Vercel's 60s cap.
  let allQuotes: QuoteMap;
  try {
    allQuotes = await fetchScanQuotes();
  } catch (err) {
    const message = getErrorMessage(err);
    await logCronRun("buy_scan", 0, "failed", message);
    return [{ status: "failed", message }];
  }

  // Build candidates across the whole watchlist (band-filtered), then let the
  // AI rank the best BUY_SCAN_TOP_PICKS opportunities overall — not one per
  // batch. With a ~30-stock watchlist this is one quote call + one AI call,
  // far lighter than the old 5-batch, 150-stock scan.
  const candidates: Candidate[] = [];
  for (let batch = 1; batch <= TOTAL_BATCHES; batch++) {
    const batchStocks = getBatch(batch);
    const batchQuotes: QuoteMap = {};
    for (const s of batchStocks) {
      if (allQuotes[s.symbol]) batchQuotes[s.symbol] = allQuotes[s.symbol];
    }
    if (Object.keys(batchQuotes).length === 0) {
      // One batch with no quotes must not kill the whole daily scan — log and
      // keep scanning the remaining batches.
      logger.warn("[buy_scan] No quotes returned for batch — skipping batch", { batch });
      await logCronRun(
        "buy_scan",
        batch,
        "skipped",
        `No quotes returned for batch ${batch}`
      );
      continue;
    }
    candidates.push(...buildBuyCandidates(batchStocks, batchQuotes));
  }

  if (candidates.length === 0) {
    await logCronRun("buy_scan", 0, "completed", "No candidates found");
    await markRunCompleted("buy_scan", "No candidates found");
    return [{ status: "completed", message: "No candidates found" }];
  }

  const topCandidates = candidates
    .sort((a, b) => b.changePercent - a.changePercent)
    .slice(0, 15);

  const picks = await analyzeWithAI(topCandidates, "buy", env.BUY_SCAN_TOP_PICKS);

  if (picks.length === 0) {
    await logCronRun("buy_scan", 0, "completed", "AI found no strong signal");
    await markRunCompleted("buy_scan", "AI found no strong signal");
    return [{ status: "completed", message: "AI found no strong signal" }];
  }

  const results: BuyScanResult[] = [];
  for (const pick of picks) {
    results.push(await handleBuyPick(0, pick));
  }

  // Only mark today's run as completed when nothing hard-failed AND at least
  // one push actually went out — otherwise a later trigger can retry (e.g.
  // after the device token gets re-registered). Firestore dedup still
  // prevents any already-notified symbol from being pushed twice.
  const failed = results.filter(
    (r) => r.status === "failed" || r.pushSent === false
  ).length;
  if (failed === 0) {
    const notified = results.filter((r) => r.notified).length;
    await markRunCompleted("buy_scan", `${results.length} picks, ${notified} notified`);
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
    // Fetch quotes for the watchlist PLUS every open position's symbol, so
    // positions from the old large-cap universe (e.g. earlier buy signals)
    // keep getting stop-loss / profit-target alerts.
    if (env.SCAN_DATA_SOURCE === "angelone") {
      // Note: getQuotes() only covers the watchlist universe, so legacy
      // large-cap positions get no quotes in Angel One mode. Acceptable —
      // Angel One is broken from cloud IPs anyway (the Yahoo path below
      // unions position tickers and is the default).
      quotes = await getQuotes();
    } else {
      const universeTickers = ALL_STOCKS.map((s) => s.yahooTicker);
      const positionTickers = positions
        .map((p) => String(p.symbol ?? ""))
        .filter(Boolean)
        .map((symbol) => `${symbol}.NS`);
      quotes = await getYahooScanQuotes([
        ...new Set([...universeTickers, ...positionTickers])
      ]);
    }
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

/**
 * Firestore requires a composite index for where("userId") + orderBy("createdAt").
 * If that index is missing, the query throws failed-precondition and every list
 * endpoint 500s. Fall back to an unsorted fetch + in-memory sort so the app
 * keeps working, and log once so the index still gets created in the console.
 */
async function fetchDocsSortedByCreatedAt(
  query: Query,
  limit: number
): Promise<{ docs: Array<{ id: string; data: () => DocumentData }> }> {
  try {
    return await query.orderBy("createdAt", "desc").limit(limit).get();
  } catch (err) {
    const code = getErrorCode(err);
    const msg = getErrorMessage(err);
    if (code !== "failed-precondition" && !msg.includes("index")) throw err;

    logger.warn("[firestore] Composite index missing — falling back to in-memory sort", {
      error: msg.slice(0, 200)
    });
    const snap = await query.limit(limit * 5).get();
    const docs = snap.docs
      .filter((doc) => doc.data().createdAt)
      .sort((a, b) => {
        const ta = a.data().createdAt?.toMillis?.() ?? 0;
        const tb = b.data().createdAt?.toMillis?.() ?? 0;
        return tb - ta;
      })
      .slice(0, limit);
    return { docs };
  }
}

/**
 * Guarantees every notification item carries a renderable timestamp — ISO
 * string, epoch ms, an IST label and IST date-group fields — even for legacy
 * docs created before timestamp fields existed. Fixes the "no timestamp in
 * the notification tab" issue without a data migration.
 *
 * `dateKey` ("2026-08-19", IST) is a stable grouping key so the app can group
 * notifications by day; `dateLabel` ("19 Aug 2026") is the ready-to-render
 * section header for each group.
 */
function ensureNotificationTimestamps(
  item: Record<string, unknown>
): Record<string, unknown> {
  if (item.timestamp && item.timestampLabel && item.timestampMs) return item;

  let date: Date | null = null;
  for (const candidate of [item.timestamp, item.sentAt, item.createdAt]) {
    if (typeof candidate === "string" && candidate) {
      const parsed = new Date(candidate);
      if (!Number.isNaN(parsed.getTime())) {
        date = parsed;
        break;
      }
    }
  }
  if (!date) {
    return {
      ...item,
      timestamp: null,
      timestampLabel: null,
      timestampMs: null,
      dateKey: null,
      dateLabel: null
    };
  }

  return {
    ...item,
    timestamp: date.toISOString(),
    timestampLabel: getISTTimestampLabel(date),
    timestampMs: date.getTime(),
    ...getISTDateGroup(date)
  };
}

/** IST day grouping fields for a notification list: key + display label. */
function getISTDateGroup(date: Date): { dateKey: string; dateLabel: string } {
  const formatter = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", ...options });
  return {
    dateKey: formatter({
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date),
    dateLabel: formatter({ day: "numeric", month: "short", year: "numeric" }).format(date)
  };
}

/**
 * Map of symbol → position id for every open position, used to flag
 * notifications as bought and to keep buys idempotent per symbol.
 */
async function getOpenPositionIdsBySymbol(): Promise<Map<string, string>> {
  try {
    const snap = await getDb()
      .collection(collectionNames.positions)
      .where("userId", "==", env.SINGLE_USER_ID)
      .where("status", "==", "open")
      .get();
    const map = new Map<string, string>();
    for (const doc of snap.docs) {
      const symbol = String(doc.data().symbol ?? "").toUpperCase();
      if (symbol) map.set(symbol, doc.id);
    }
    return map;
  } catch (err) {
    // Fail-open: notifications still render, just without the bought flag.
    logger.warn("[positions] Failed to map open positions", {
      error: getErrorMessage(err)
    });
    return new Map();
  }
}

/**
 * Append (or refresh) a holding on the single portfolio document so the
 * Portfolio tab can render bought stocks directly from `holdings`, alongside
 * the openPositions list derived from the positions collection.
 */
async function addHoldingToPortfolio(holding: Record<string, unknown>): Promise<void> {
  const snap = await getDb()
    .collection(collectionNames.portfolio)
    .where("userId", "==", env.SINGLE_USER_ID)
    .limit(1)
    .get();

  const doc = snap.docs[0];
  const ref = doc?.ref ?? getDb().collection(collectionNames.portfolio).doc();
  const data = doc?.data() ?? {};

  const symbol = String(holding.symbol ?? "");
  const holdings = Array.isArray(data.holdings)
    ? (data.holdings as Record<string, unknown>[]).filter(
        (h) => String(h.symbol ?? "") !== symbol
      )
    : [];
  holdings.push(holding);

  const investedAmount =
    Math.round(
      holdings.reduce((sum, h) => sum + (Number(h.investedAmount) || 0), 0) * 100
    ) / 100;

  await ref.set(
    {
      id: ref.id,
      userId: env.SINGLE_USER_ID,
      holdings,
      holdingsCount: holdings.length,
      investedAmount,
      updatedAt: Timestamp.now(),
      ...(doc?.exists ? {} : { createdAt: Timestamp.now() })
    },
    { merge: true }
  );
}

async function getUserWishlistSymbols(): Promise<string[]> {  try {
    const snap = await getDb()
      .collection(collectionNames.wishlist)
      .where("userId", "==", env.SINGLE_USER_ID)
      .get();
    return snap.docs
      .map((doc) =>
        String(doc.data().symbol ?? "")
          .trim()
          .toUpperCase()
      )
      .filter(Boolean);
  } catch (err) {
    logger.warn("[wishlist] Read failed — continuing without wishlist", {
      error: getErrorMessage(err)
    });
    return [];
  }
}

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

// Unknown routes must return JSON, not Express's default HTML 404 — mobile
// clients parsing JSON would crash on it.
app.use((_req: Request, res: Response) => {
  sendError(res, 404, "Route not found");
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
