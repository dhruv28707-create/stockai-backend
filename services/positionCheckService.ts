import { Timestamp } from "firebase-admin/firestore";

import { collectionNames } from "../models/index.js";
import { logger } from "../utils/logger.js";
import { MarketDataService } from "./marketDataService.js";
import { NotificationService } from "./notificationService.js";
import { FirestoreService } from "./firestoreService.js";
import type { PositionDocument } from "../models/position.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PositionCheckSummary {
  positionsChecked: number;
  targetsHit: number;
  stopLossesHit: number;
  skipped: number;
  durationMs: number;
}

/**
 * Checks every open position's live price against its stored
 * targetPrice / stopLoss and fires a sell notification the moment
 * either is hit. This is intentionally separate from ScannerService —
 * it only touches your handful of open positions, not the full ~150
 * stock watchlist, so it's fast enough to run as its own lightweight
 * cron job later in the day, within Vercel Hobby's per-job daily
 * trigger limit.
 */
export class PositionCheckService {
  private readonly marketData = new MarketDataService();
  private readonly notifications = new NotificationService();
  private readonly db = new FirestoreService();

  private async getOpenPositions(userId: string): Promise<PositionDocument[]> {
    const snap = await this.db.client
      .collection(collectionNames.positions)
      .where("userId", "==", userId)
      .where("status", "==", "open")
      .get();
    return snap.docs.map((d) => d.data() as PositionDocument);
  }

  private async markPositionStatus(
    positionId: string,
    status: "target_hit" | "stop_loss_hit"
  ): Promise<void> {
    await this.db.client
      .collection(collectionNames.positions)
      .doc(positionId)
      .update({ status, updatedAt: Timestamp.now() });
  }

  async checkPositions(userId: string): Promise<PositionCheckSummary> {
    const start = Date.now();
    const positions = await this.getOpenPositions(userId);

    logger.info("PositionCheck: starting", { openPositions: positions.length });

    if (positions.length === 0) {
      return {
        positionsChecked: 0,
        targetsHit: 0,
        stopLossesHit: 0,
        skipped: 0,
        durationMs: Date.now() - start
      };
    }

    const symbols = positions.map((p) => p.symbol);
    const marketResults = await this.marketData.fetchBatch(symbols);
    const priceBySymbol = new Map(marketResults.map((r) => [r.symbol, r.quote.price]));

    let targetsHit = 0;
    let stopLossesHit = 0;
    let skipped = 0;

    for (const position of positions) {
      const currentPrice = priceBySymbol.get(position.symbol);

      if (currentPrice === undefined) {
        logger.warn("PositionCheck: no live price for symbol, skipping", {
          symbol: position.symbol
        });
        skipped++;
        continue;
      }

      // A position created before this feature existed may not have a
      // target/stoploss — skip those gracefully rather than erroring.
      if (position.targetPrice === undefined && position.stopLoss === undefined) {
        skipped++;
        continue;
      }

      const hitTarget =
        position.targetPrice !== undefined && currentPrice >= position.targetPrice;
      const hitStopLoss =
        position.stopLoss !== undefined && currentPrice <= position.stopLoss;

      if (hitTarget) {
        await this.markPositionStatus(position.id, "target_hit");
        await this.notifications.sendExitNotification({
          userId,
          symbol: position.symbol,
          name: position.symbol,
          currentPrice,
          exitReason: `Target price ₹${position.targetPrice} hit. Current price ₹${currentPrice}.`,
          confidence: 1
        });
        targetsHit++;
        logger.info("PositionCheck: target hit", {
          symbol: position.symbol,
          target: position.targetPrice,
          currentPrice
        });
      } else if (hitStopLoss) {
        await this.markPositionStatus(position.id, "stop_loss_hit");
        await this.notifications.sendExitNotification({
          userId,
          symbol: position.symbol,
          name: position.symbol,
          currentPrice,
          exitReason: `Stop loss ₹${position.stopLoss} hit. Current price ₹${currentPrice}.`,
          confidence: 1
        });
        stopLossesHit++;
        logger.info("PositionCheck: stop loss hit", {
          symbol: position.symbol,
          stopLoss: position.stopLoss,
          currentPrice
        });
      }
    }

    const summary: PositionCheckSummary = {
      positionsChecked: positions.length,
      targetsHit,
      stopLossesHit,
      skipped,
      durationMs: Date.now() - start
    };

    logger.info("PositionCheck: complete", summary as unknown as Record<string, unknown>);
    return summary;
  }
}
