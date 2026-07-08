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

app.get("/api", (_req: Request, res: Response) => {
  sendSuccess(res, { service: "StockAI Backend", storage: "firebase", version: "1.0.0" });
});

app.get("/api/health", (_req: Request, res: Response) => {
  sendSuccess(res, { status: "ready" });
});

app.get("/api/market/summary", async (_req: Request, res: Response) => {
  try {
    sendSuccess(res, await getMarketSummary());
  } catch {
    sendError(res, 500, "Failed to fetch market data");
  }
});

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
        const entryPrice = Number(item.entryPrice ?? item.entry ?? item.currentPrice ?? 0);
        return !entryPrice || entryPrice <= maxEntry;
      });

    sendSuccess(res, { items, count: items.length });
  } catch {
    sendError(res, 500, "Failed to fetch recommendations");
  }
});

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

    const openPositions = positionsSnap.docs.map((doc) => normalizeDoc(doc.id, doc.data()));
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
      getStringFromRequest(req, "body") ?? "Your Firebase notification setup is connected.",
      "MARKET_SUMMARY",
      "LOW"
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
  } catch {
    sendError(res, 500, "Failed to send test notification");
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

app.get("/api/capital/current", async (_req: Request, res: Response) => {
  try {
    sendSuccess(res, await getCurrentMonthlySetup());
  } catch {
    sendError(res, 500, "Failed to fetch monthly capital");
  }
});

const saveCapitalSetupHandler = async (req: Request, res: Response) => {
  try {
    const capital = toPositiveNumber(
      req.body?.capital ?? req.body?.amount ?? req.body?.budget ?? req.body?.monthlyCapital,
      0
    );
    if (!capital) {
      sendError(res, 400, "Valid capital amount is required");
      return;
    }

    const month = typeof req.body?.month === "string" ? req.body.month : getCurrentMonth();
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

    sendSuccess(res, setup);
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

    const month = typeof req.body?.month === "string" ? req.body.month : getCurrentMonth();
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

app.get("/api/cron/scan", async (req: Request, res: Response) => {
  if (!isAuthorizedCronRequest(req)) {
    sendError(res, 401, "Unauthorized cron request");
    return;
  }

  await logCronRun("buy_scan");
  sendSuccess(res, { status: "accepted", job: "buy_scan" });
});

app.get("/api/cron/check-positions", async (req: Request, res: Response) => {
  if (!isAuthorizedCronRequest(req)) {
    sendError(res, 401, "Unauthorized cron request");
    return;
  }

  await logCronRun("sell_scan");
  sendSuccess(res, { status: "accepted", job: "sell_scan" });
});

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
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

function getNotificationFailureMessage(error: string | undefined, hadToken: boolean): string {
  if (!hadToken) {
    return "No FCM token is saved. The frontend must register the Android FCM token first.";
  }

  return error ?? "FCM rejected the test notification.";
}

function isAuthorizedCronRequest(req: Request): boolean {
  if (!env.CRON_SECRET) return true;
  return (
    req.header("authorization") === `Bearer ${env.CRON_SECRET}` ||
    req.header("x-cron-secret") === env.CRON_SECRET
  );
}

async function logCronRun(job: "buy_scan" | "sell_scan"): Promise<void> {
  const ref = getDb().collection("cronRuns").doc();
  await ref.set({
    id: ref.id,
    userId: env.SINGLE_USER_ID,
    job,
    status: "accepted",
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
