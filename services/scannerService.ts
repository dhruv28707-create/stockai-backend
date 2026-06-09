import { Timestamp } from "firebase-admin/firestore";

import { getBatch, findBySymbol, TOTAL_BATCHES } from "../data/watchlist.js";
import { collectionNames, type RecommendationDocument } from "../models/index.js";
import { logger } from "../utils/logger.js";
import { IndicatorService } from "./indicatorService.js";
import { MarketDataService } from "./marketDataService.js";
import { NotificationService } from "./notificationService.js";
import { ScoringService } from "./scoringService.js";
import { FirestoreService } from "./firestoreService.js";
import type { IndicatorResult } from "./indicatorService.js";
import type { PositionDocument } from "../models/position.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScanSummary {
  batchIndex: number;
  symbolsScanned: number;
  buySignals: number;
  exitSignals: number;
  skipped: number;
  durationMs: number;
}

const BATCH_POINTER_DOC = "scanner_batch_pointer";
const SETTINGS_COLLECTION = collectionNames.settings;

// ─── Service ──────────────────────────────────────────────────────────────────

export class ScannerService {
  private readonly marketData = new MarketDataService();
  private readonly indicators = new IndicatorService();
  private readonly scoring = new ScoringService();
  private readonly notifications = new NotificationService();
  private readonly db = new FirestoreService();

  // ── Batch pointer ──────────────────────────────────────────────────────────

  private async getCurrentBatchIndex(): Promise<number> {
    const snap = await this.db.client
      .collection(SETTINGS_COLLECTION)
      .doc(BATCH_POINTER_DOC)
      .get();
    if (!snap.exists) return 0;
    const data = snap.data() as { batchIndex?: number } | undefined;
    return data?.batchIndex ?? 0;
  }

  private async advanceBatchIndex(current: number): Promise<void> {
    const next = (current + 1) % TOTAL_BATCHES;
    await this.db.client
      .collection(SETTINGS_COLLECTION)
      .doc(BATCH_POINTER_DOC)
      .set({ batchIndex: next, updatedAt: Timestamp.now() });
  }

  // ── Open positions ─────────────────────────────────────────────────────────

  private async getOpenPositionSymbols(): Promise<string[]> {
    const snap = await this.db.client
      .collection(collectionNames.positions)
      .where("status", "==", "open")
      .get();
    return snap.docs.map((d) => (d.data() as PositionDocument).symbol);
  }

  // ── Write recommendation ───────────────────────────────────────────────────

  private async writeRecommendation(
    rec: Omit<RecommendationDocument, "id" | "createdAt" | "updatedAt">
  ): Promise<string> {
    const ref = this.db.client
      .collection(collectionNames.recommendations)
      .doc();
    const now = Timestamp.now();
    const doc: RecommendationDocument = { ...rec, id: ref.id, createdAt: now, updatedAt: now };
    await ref.set(doc);
    return ref.id;
  }

  // ── Main scan ──────────────────────────────────────────────────────────────

  async runScan(userId: string): Promise<ScanSummary> {
    const start = Date.now();
    const batchIndex = await this.getCurrentBatchIndex();
    const batch = getBatch(batchIndex);
    const openSymbols = await this.getOpenPositionSymbols();

    logger.info("Scanner: batch start", {
      batchIndex,
      symbols: batch.length,
      openPositions: openSymbols.length
    });

    // Merge batch + any open positions not already in the batch
    const batchSymbolSet = new Set(batch.map((e) => e.symbol));
    const extraSymbols = openSymbols.filter((s) => !batchSymbolSet.has(s));

    const allEntries = [
      ...batch,
      ...extraSymbols.map((s) => {
        const found = findBySymbol(s);
        return found ?? { symbol: s, name: s, exchange: "NSE" as const, sector: "Unknown" };
      })
    ];

    const marketResults = await this.marketData.fetchBatch(
      allEntries.map((e) => e.symbol)
    );

    let buySignals = 0;
    let exitSignals = 0;
    let skipped = 0;

    for (const data of marketResults) {
      const { symbol, quote, candles } = data;
      const entry = findBySymbol(symbol);
      const stockName = entry?.name ?? symbol;
      const isOpenPosition = openSymbols.includes(symbol);

      let indResult: IndicatorResult;
      try {
        indResult = this.indicators.compute(candles);
      } catch {
        logger.warn("Indicator compute failed", { symbol });
        skipped++;
        continue;
      }

      // ── EXIT check (open positions only) ────────────────────────────────
      if (isOpenPosition) {
        const exitScore = this.scoring.scoreExit(indResult, quote);

        if (exitScore.shouldAlert) {
          const rationale = this.buildRationale("EXIT", indResult, exitScore.confidence);

          await this.writeRecommendation({
            userId,
            symbol,
            action: "sell",
            status: "pending",
            confidence: exitScore.confidence,
            rationale,
            metadata: {
              signal: "EXIT",
              batchIndex,
              rsi: indResult.rsi,
              macdHistogram: indResult.macd.histogram,
              ema20: indResult.ema20,
              ema50: indResult.ema50,
              atr: indResult.atr,
              volumeRatio: indResult.volumeBreakout.ratio,
              breakdown: JSON.stringify(exitScore.breakdown),
              sector: entry?.sector ?? "Unknown"
            }
          });

          await this.notifications.sendExitNotification({
            userId,
            symbol,
            name: stockName,
            currentPrice: quote.price,
            exitReason: rationale,
            confidence: exitScore.confidence
          });

          exitSignals++;
          logger.info("EXIT signal fired", { symbol, confidence: exitScore.confidence });
        }
      }

      // ── BUY check (all batch symbols) ────────────────────────────────────
      const buyScore = this.scoring.scoreBuy(indResult, quote);

      if (buyScore.shouldAlert) {
        const rationale = this.buildRationale("BUY", indResult, buyScore.confidence);
        const entryPrice = quote.price;
        const atr = indResult.atr;

        await this.writeRecommendation({
          userId,
          symbol,
          action: "buy",
          status: "pending",
          confidence: buyScore.confidence,
          rationale,
          metadata: {
            signal: "BUY",
            batchIndex,
            rsi: indResult.rsi,
            macdHistogram: indResult.macd.histogram,
            ema20: indResult.ema20,
            ema50: indResult.ema50,
            atr,
            stoploss: parseFloat((entryPrice - atr).toFixed(2)),
            target: parseFloat((entryPrice + 2 * atr).toFixed(2)),
            volumeRatio: indResult.volumeBreakout.ratio,
            breakdown: JSON.stringify(buyScore.breakdown),
            price: entryPrice,
            sector: entry?.sector ?? "Unknown"
          }
        });

        await this.notifications.sendBuyNotification({
          userId,
          symbol,
          name: stockName,
          entry: entryPrice,
          stoploss: parseFloat((entryPrice - atr).toFixed(2)),
          target: parseFloat((entryPrice + 2 * atr).toFixed(2)),
          atr,
          confidence: buyScore.confidence,
          reason: rationale
        });

        buySignals++;
        logger.info("BUY signal fired", { symbol, confidence: buyScore.confidence });
      }
    }

    await this.advanceBatchIndex(batchIndex);

    const summary: ScanSummary = {
      batchIndex,
      symbolsScanned: marketResults.length,
      buySignals,
      exitSignals,
      skipped: allEntries.length - marketResults.length + skipped,
      durationMs: Date.now() - start
    };

    logger.info("Scanner: batch complete", summary as unknown as Record<string, unknown>);
    return summary;
  }

  // ── Rationale builder (pure text, no LLM) ─────────────────────────────────

  private buildRationale(
    signal: "BUY" | "EXIT",
    ind: IndicatorResult,
    confidence: number
  ): string {
    const pct = Math.round(confidence * 100);
    const parts: string[] = [];

    if (signal === "BUY") {
      parts.push(`BUY signal with ${pct}% confidence.`);
      if (ind.rsi >= 40 && ind.rsi <= 60) parts.push(`RSI ${ind.rsi} — momentum building.`);
      else if (ind.rsi < 30) parts.push(`RSI ${ind.rsi} — oversold, potential reversal.`);
      if (ind.macd.histogram > 0) parts.push(`MACD histogram positive (${ind.macd.histogram}) — bullish momentum.`);
      if (ind.ema20 > ind.ema50) parts.push(`EMA20 (${ind.ema20}) above EMA50 (${ind.ema50}) — uptrend confirmed.`);
      if (ind.volumeBreakout.isBreakout) parts.push(`Volume ${ind.volumeBreakout.ratio}x above average — strong participation.`);
    } else {
      parts.push(`EXIT signal with ${pct}% confidence.`);
      if (ind.rsi > 70) parts.push(`RSI ${ind.rsi} — overbought, take profit.`);
      else if (ind.rsi < 30) parts.push(`RSI ${ind.rsi} — falling sharply, stop loss territory.`);
      if (ind.macd.histogram < 0) parts.push(`MACD histogram negative (${ind.macd.histogram}) — bearish momentum.`);
      if (ind.ema20 < ind.ema50) parts.push(`EMA20 (${ind.ema20}) below EMA50 (${ind.ema50}) — downtrend forming.`);
      if (ind.volumeBreakout.isBreakout) parts.push(`Volume ${ind.volumeBreakout.ratio}x above average on down move — distribution signal.`);
    }

    return parts.join(" ");
  }
}
