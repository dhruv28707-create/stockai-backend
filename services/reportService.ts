import { Timestamp } from "firebase-admin/firestore";

import { collectionNames } from "../models/index.js";
import type {
  BestMissedTrade,
  DailyReportData,
  DailyReportDocument,
  OpenPositionSummary,
  TradeSummaryEntry,
  WeeklyReportData,
  WeeklyReportDocument
} from "../models/report.js";
import type { MissedTradeDocument } from "../models/missedTrade.js";
import type { PositionDocument } from "../models/position.js";
import type { RecommendationDocument } from "../models/recommendation.js";
import type { TradeDocument } from "../models/trade.js";
import { logger } from "../utils/logger.js";
import { FirestoreService } from "./firestoreService.js";
import { MarketDataService } from "./marketDataService.js";
import { MonthlySetupService } from "./monthlySetupService.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns YYYY-MM-DD for a given Date in IST (UTC+5:30) */
const toISTDateString = (date: Date): string => {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
};

/** Returns YYYY-MM for a given Date in IST */
const toYearMonth = (date: Date): string => toISTDateString(date).slice(0, 7);

/** Returns the Monday of the week containing the given date */
const getWeekStart = (date: Date): Date => {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

/** Returns the Friday of the week containing the given date */
const getWeekEnd = (date: Date): Date => {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 4);
  end.setUTCHours(23, 59, 59, 999);
  return end;
};

/** Portfolio health: 0–100 score based on P&L, win rate and open positions */
const computePortfolioHealth = (
  totalPnL: number,
  winRate: number,
  openCount: number
): { score: number; label: "Excellent" | "Good" | "Fair" | "Poor" } => {
  let score = 50;
  if (totalPnL > 0) score += Math.min(20, totalPnL / 1000);
  else score += Math.max(-20, totalPnL / 1000);
  score += winRate * 20;
  if (openCount > 5) score -= 10;
  const clamped = Math.round(Math.max(0, Math.min(100, score)));
  const label =
    clamped >= 75 ? "Excellent"
    : clamped >= 55 ? "Good"
    : clamped >= 35 ? "Fair"
    : "Poor";
  return { score: clamped, label };
};

// ─── Service ──────────────────────────────────────────────────────────────────

export class ReportService {
  private readonly db = new FirestoreService();
  private readonly marketData = new MarketDataService();
  private readonly monthlySetup = new MonthlySetupService();

  // ── Data fetchers ──────────────────────────────────────────────────────────

  /** All trades for a given user whose tradedOn falls in [startDate, endDate] */
  private async getTradesForPeriod(
    userId: string,
    startDate: string,
    endDate: string
  ): Promise<TradeDocument[]> {
    const snap = await this.db.client
      .collection(collectionNames.trades)
      .where("userId", "==", userId)
      .where("tradedOn", ">=", startDate)
      .where("tradedOn", "<=", endDate)
      .get();
    return snap.docs.map((d) => d.data() as TradeDocument);
  }

  /** All open positions for a user */
  private async getOpenPositions(userId: string): Promise<PositionDocument[]> {
    const snap = await this.db.client
      .collection(collectionNames.positions)
      .where("userId", "==", userId)
      .get();
    return snap.docs.map((d) => d.data() as PositionDocument);
  }

  /** All recommendations for a user created on a given date */
  private async getRecommendationsForDate(
    userId: string,
    date: string
  ): Promise<RecommendationDocument[]> {
    const startTs = Timestamp.fromDate(new Date(`${date}T00:00:00.000Z`));
    const endTs = Timestamp.fromDate(new Date(`${date}T23:59:59.999Z`));
    const snap = await this.db.client
      .collection(collectionNames.recommendations)
      .where("userId", "==", userId)
      .where("createdAt", ">=", startTs)
      .where("createdAt", "<=", endTs)
      .get();
    return snap.docs.map((d) => d.data() as RecommendationDocument);
  }

  /** All missed trades for a user in [startDate, endDate] */
  private async getMissedTradesForPeriod(
    userId: string,
    startDate: string,
    endDate: string
  ): Promise<MissedTradeDocument[]> {
    const snap = await this.db.client
      .collection(collectionNames.missedTrades)
      .where("userId", "==", userId)
      .where("observedOn", ">=", startDate)
      .where("observedOn", "<=", endDate)
      .get();
    return snap.docs.map((d) => d.data() as MissedTradeDocument);
  }

  /** All filled BUY+SELL pairs (all time) for AI accuracy */
  private async getAllFilledTrades(userId: string): Promise<TradeDocument[]> {
    const snap = await this.db.client
      .collection(collectionNames.trades)
      .where("userId", "==", userId)
      .where("status", "==", "filled")
      .get();
    return snap.docs.map((d) => d.data() as TradeDocument);
  }

  // ── AI Accuracy ────────────────────────────────────────────────────────────

  /**
   * AI Accuracy = closed profitable BUY trades / total closed BUY trades (all time).
   * A "closed" BUY trade has a corresponding filled SELL trade for the same symbol.
   */
  private computeAIAccuracy(allFilledTrades: TradeDocument[]): {
    accuracy: number;
    basis: string;
  } {
    const buys = allFilledTrades.filter((t) => t.side === "buy");
    const sells = allFilledTrades.filter((t) => t.side === "sell");

    let profitable = 0;
    let closed = 0;

    for (const buy of buys) {
      const matchingSell = sells.find(
        (s) =>
          s.symbol === buy.symbol &&
          s.tradedOn >= buy.tradedOn
      );
      if (!matchingSell) continue;

      closed++;
      const pnl = (matchingSell.price - buy.price) * buy.quantity;
      if (pnl > 0) profitable++;
    }

    const accuracy = closed > 0 ? profitable / closed : 0;
    return {
      accuracy: parseFloat(accuracy.toFixed(4)),
      basis:
        closed === 0
          ? "No closed BUY trades yet"
          : `${profitable} of ${closed} closed BUY trades profitable`
    };
  }

  // ── Closed P&L builder ─────────────────────────────────────────────────────

  private buildClosedTradeSummaries(trades: TradeDocument[]): {
    summaries: TradeSummaryEntry[];
    realisedPnL: number;
  } {
    const buys = trades.filter((t) => t.side === "buy" && t.status === "filled");
    const sells = trades.filter((t) => t.side === "sell" && t.status === "filled");
    const summaries: TradeSummaryEntry[] = [];
    let realisedPnL = 0;

    for (const sell of sells) {
      const matchBuy = buys.find((b) => b.symbol === sell.symbol);
      const entryPrice = matchBuy?.price ?? sell.price;
      const pnl = (sell.price - entryPrice) * sell.quantity;
      realisedPnL += pnl;
      summaries.push({
        symbol: sell.symbol,
        side: "sell",
        quantity: sell.quantity,
        entryPrice,
        exitPrice: sell.price,
        pnl: parseFloat(pnl.toFixed(2)),
        tradedOn: sell.tradedOn
      });
    }

    return { summaries, realisedPnL: parseFloat(realisedPnL.toFixed(2)) };
  }

  // ── Best Missed Trade ──────────────────────────────────────────────────────

  /**
   * Computes the best missed trade from missed trade documents.
   * Fetches current price from yahoo-finance2 as a proxy for peak price.
   * In production, peak price would come from historical data — here we use
   * the latest quote as the best available approximation.
   */
  private async computeBestMissedTrade(
    missedTrades: MissedTradeDocument[],
    userId: string
  ): Promise<BestMissedTrade | undefined> {
    if (missedTrades.length === 0) return undefined;

    const candidates: BestMissedTrade[] = [];

    for (const missed of missedTrades) {
      // Fetch recommendation to get original entry price and confidence
      let entryPrice = 0;
      let confidence = 0;
      let recId = missed.recommendationId ?? "";
      let stockName = missed.symbol;

      if (missed.recommendationId) {
        const recSnap = await this.db.client
          .collection(collectionNames.recommendations)
          .doc(missed.recommendationId)
          .get();

        if (recSnap.exists) {
          const rec = recSnap.data() as RecommendationDocument;
          confidence = rec.confidence ?? 0;
          const meta = rec.metadata as Record<string, unknown> | undefined;
          if (typeof meta?.["price"] === "number") entryPrice = meta["price"];
          if (typeof meta?.["name"] === "string") stockName = meta["name"];
        }
      }

      if (entryPrice === 0) continue;

      // Fetch current price as peak price proxy
      const marketResult = await this.marketData.fetchSymbol(missed.symbol);
      if (!marketResult) continue;

      const peakPrice = marketResult.quote.price;
      if (peakPrice <= entryPrice) continue;

      // Determine suggested quantity using monthly setup's maxTradeCapital
      const month = toYearMonth(new Date());
      const setup = await this.monthlySetup.getSetup(userId, month);
      const maxTradeCapital = setup?.maxTradeCapital ?? 0;
      const suggestedQuantity =
        entryPrice > 0 ? Math.floor(maxTradeCapital / entryPrice) : 0;

      const potentialProfit = parseFloat(
        ((peakPrice - entryPrice) * suggestedQuantity).toFixed(2)
      );

      const reasonForMissing: BestMissedTrade["reasonForMissing"] =
        missed.reason === "insufficient_funds" ? "insufficient_capital" : "skipped";

      candidates.push({
        symbol: missed.symbol,
        stockName,
        entryPrice,
        peakPriceAchieved: peakPrice,
        suggestedQuantity,
        potentialProfit,
        confidenceScore: confidence,
        reasonForMissing,
        recommendationId: recId,
        signalDate: missed.observedOn
      });
    }

    if (candidates.length === 0) return undefined;

    // Return the one with highest potential profit
    return candidates.reduce((best, c) =>
      c.potentialProfit > best.potentialProfit ? c : best
    );
  }

  // ── generateDailyReport ────────────────────────────────────────────────────

  async generateDailyReport(userId: string, date?: string): Promise<DailyReportDocument> {
    const reportDate = date ?? toISTDateString(new Date());
    const month = reportDate.slice(0, 7);

    logger.info("Generating daily report", { userId, reportDate });

    // Fetch all data in parallel
    const [
      tradesForDay,
      openPositions,
      recommendationsForDay,
      missedTradesForDay,
      allFilledTrades,
      monthlySetup
    ] = await Promise.all([
      this.getTradesForPeriod(userId, reportDate, reportDate),
      this.getOpenPositions(userId),
      this.getRecommendationsForDate(userId, reportDate),
      this.getMissedTradesForPeriod(userId, reportDate, reportDate),
      this.getAllFilledTrades(userId),
      this.monthlySetup.getSetup(userId, month)
    ]);

    // Closed positions P&L
    const { summaries: closedPositions, realisedPnL } =
      this.buildClosedTradeSummaries(tradesForDay);

    // Fetch current prices for open positions to compute unrealised P&L
    const openPositionSummaries: OpenPositionSummary[] = [];
    let unrealisedPnL = 0;

    for (const pos of openPositions) {
      const marketResult = await this.marketData.fetchSymbol(pos.symbol);
      const currentPrice = marketResult?.quote.price ?? pos.averagePrice;
      const unrealised = (currentPrice - pos.averagePrice) * pos.quantity;
      unrealisedPnL += unrealised;
      openPositionSummaries.push({
        symbol: pos.symbol,
        quantity: pos.quantity,
        averagePrice: pos.averagePrice,
        currentPrice,
        unrealisedPnL: parseFloat(unrealised.toFixed(2))
      });
    }

    unrealisedPnL = parseFloat(unrealisedPnL.toFixed(2));
    const totalPnL = parseFloat((realisedPnL + unrealisedPnL).toFixed(2));

    // Best / Worst trade by realised P&L
    const sortedClosed = [...closedPositions].sort(
      (a, b) => (b.pnl ?? 0) - (a.pnl ?? 0)
    );
    const bestTrade = sortedClosed[0];
    const worstTrade = sortedClosed[sortedClosed.length - 1];

    // AI accuracy
    const { accuracy: aiAccuracy, basis: aiAccuracyBasis } =
      this.computeAIAccuracy(allFilledTrades);

    // Best missed trade
    const bestMissedTrade = await this.computeBestMissedTrade(
      missedTradesForDay,
      userId
    );

    // Recommendation counts
    const buySignalsToday = recommendationsForDay.filter(
      (r) => r.action === "buy"
    ).length;
    const exitSignalsToday = recommendationsForDay.filter(
      (r) => r.action === "sell"
    ).length;

    // Win rate for portfolio health
    const closedBuys = allFilledTrades.filter((t) => t.side === "buy");
    const closedSells = allFilledTrades.filter((t) => t.side === "sell");
    let wins = 0;
    for (const sell of closedSells) {
      const buy = closedBuys.find((b) => b.symbol === sell.symbol);
      if (buy && sell.price > buy.price) wins++;
    }
    const winRate =
      closedSells.length > 0 ? wins / closedSells.length : 0;

    // Portfolio health
    const { score: portfolioHealth, label: portfolioHealthLabel } =
      computePortfolioHealth(totalPnL, winRate, openPositions.length);

    const data: DailyReportData = {
      realisedPnL,
      unrealisedPnL,
      totalPnL,
      remainingCapital: monthlySetup?.remainingCapital ?? 0,
      openPositions: openPositionSummaries,
      openPositionCount: openPositionSummaries.length,
      closedPositions,
      closedPositionCount: closedPositions.length,
      ...(bestTrade ? { bestTrade } : {}),
      ...(worstTrade && worstTrade !== bestTrade ? { worstTrade } : {}),
      ...(bestMissedTrade ? { bestMissedTrade } : {}),
      aiAccuracy,
      aiAccuracyBasis,
      portfolioHealth,
      portfolioHealthLabel,
      totalRecommendationsToday: recommendationsForDay.length,
      buySignalsToday,
      exitSignalsToday
    };

    const title = `Daily Report — ${reportDate}`;
    const summary = [
      `P&L: ₹${totalPnL} (Realised: ₹${realisedPnL} | Unrealised: ₹${unrealisedPnL})`,
      `Capital Remaining: ₹${data.remainingCapital}`,
      `Open: ${data.openPositionCount} | Closed: ${data.closedPositionCount}`,
      `AI Accuracy: ${Math.round(aiAccuracy * 100)}% (${aiAccuracyBasis})`,
      `Portfolio Health: ${portfolioHealthLabel} (${portfolioHealth}/100)`,
      `Signals Today: ${buySignalsToday} BUY | ${exitSignalsToday} EXIT`
    ].join(" | ");

    // Write to Firestore
    const ref = this.db.client.collection(collectionNames.dailyReports).doc();
    const now = Timestamp.now();
    const doc: DailyReportDocument = {
      id: ref.id,
      userId,
      reportType: "daily",
      reportDate,
      periodStart: reportDate,
      periodEnd: reportDate,
      title,
      summary,
      data,
      createdAt: now,
      updatedAt: now
    };

    await ref.set(doc);
    logger.info("Daily report saved", { userId, reportDate, docId: ref.id });
    return doc;
  }

  // ── generateWeeklyReport ───────────────────────────────────────────────────

  async generateWeeklyReport(
    userId: string,
    referenceDate?: string
  ): Promise<WeeklyReportDocument> {
    const ref = referenceDate
      ? new Date(referenceDate)
      : new Date();

    const weekStartDate = getWeekStart(ref);
    const weekEndDate = getWeekEnd(ref);
    const weekStart = toISTDateString(weekStartDate);
    const weekEnd = toISTDateString(weekEndDate);
    const month = weekStart.slice(0, 7);

    logger.info("Generating weekly report", { userId, weekStart, weekEnd });

    const [
      tradesForWeek,
      openPositions,
      missedTradesForWeek,
      allFilledTrades,
      monthlySetup
    ] = await Promise.all([
      this.getTradesForPeriod(userId, weekStart, weekEnd),
      this.getOpenPositions(userId),
      this.getMissedTradesForPeriod(userId, weekStart, weekEnd),
      this.getAllFilledTrades(userId),
      this.monthlySetup.getSetup(userId, month)
    ]);

    // Weekly P&L
    const { summaries: closedPositions, realisedPnL: weeklyPnL } =
      this.buildClosedTradeSummaries(tradesForWeek);

    // Unrealised P&L for portfolio value
    let unrealisedPnL = 0;
    for (const pos of openPositions) {
      const marketResult = await this.marketData.fetchSymbol(pos.symbol);
      const currentPrice = marketResult?.quote.price ?? pos.averagePrice;
      unrealisedPnL += (currentPrice - pos.averagePrice) * pos.quantity;
    }

    const remainingCapital = monthlySetup?.remainingCapital ?? 0;
    const portfolioValue = parseFloat(
      (remainingCapital + unrealisedPnL).toFixed(2)
    );

    // Win rate
    const buys = allFilledTrades.filter((t) => t.side === "buy");
    const sells = allFilledTrades.filter((t) => t.side === "sell");
    let wins = 0;
    for (const sell of sells) {
      const buy = buys.find((b) => b.symbol === sell.symbol);
      if (buy && sell.price > buy.price) wins++;
    }
    const winRate =
      sells.length > 0
        ? parseFloat((wins / sells.length).toFixed(4))
        : 0;
    const winRateBasis =
      sells.length === 0
        ? "No closed trades this week"
        : `${wins} of ${sells.length} trades profitable`;

    // Daily P&L breakdown
    const dailyPnL: Record<string, number> = {};
    for (const trade of closedPositions) {
      const day = trade.tradedOn;
      dailyPnL[day] = parseFloat(
        ((dailyPnL[day] ?? 0) + (trade.pnl ?? 0)).toFixed(2)
      );
    }

    // Best / worst trade
    const sortedClosed = [...closedPositions].sort(
      (a, b) => (b.pnl ?? 0) - (a.pnl ?? 0)
    );
    const bestTrade = sortedClosed[0];
    const worstTrade = sortedClosed[sortedClosed.length - 1];

    // Best missed trade
    const bestMissedTrade = await this.computeBestMissedTrade(
      missedTradesForWeek,
      userId
    );

    const data: WeeklyReportData = {
      weeklyPnL: parseFloat(weeklyPnL.toFixed(2)),
      winRate,
      winRateBasis,
      totalTrades: closedPositions.length,
      portfolioValue,
      remainingCapital,
      dailyPnL,
      ...(bestTrade ? { bestTrade } : {}),
      ...(worstTrade && worstTrade !== bestTrade ? { worstTrade } : {}),
      ...(bestMissedTrade ? { bestMissedTrade } : {})
    };

    const title = `Weekly Report — ${weekStart} to ${weekEnd}`;
    const summary = [
      `Weekly P&L: ₹${data.weeklyPnL}`,
      `Win Rate: ${Math.round(winRate * 100)}% (${winRateBasis})`,
      `Total Trades: ${data.totalTrades}`,
      `Portfolio Value: ₹${portfolioValue}`
    ].join(" | ");

    const docRef = this.db.client.collection(collectionNames.weeklyReports).doc();
    const now = Timestamp.now();
    const doc: WeeklyReportDocument = {
      id: docRef.id,
      userId,
      reportType: "weekly",
      weekStart,
      weekEnd,
      periodStart: weekStart,
      periodEnd: weekEnd,
      title,
      summary,
      data,
      createdAt: now,
      updatedAt: now
    };

    await docRef.set(doc);
    logger.info("Weekly report saved", { userId, weekStart, weekEnd, docId: docRef.id });
    return doc;
  }
}
