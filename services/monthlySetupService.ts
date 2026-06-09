import { FieldValue, type Firestore } from "firebase-admin/firestore";

import { getDb } from "../firebase/admin";
import {
  collectionNames,
  RISK_ALLOCATION,
  type MonthlySetupDocument,
  type RiskLevel
} from "../models";
import { logger } from "../utils/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateMonthlySetupInput {
  userId: string;
  month: string; // YYYY-MM
  capital: number;
  riskLevel: RiskLevel;
  tradingStyle: string;
}

export interface PurchaseTradeInput {
  userId: string;
  month: string;
  /** Amount to deduct from remainingCapital (must be ≤ maxTradeCapital) */
  tradeCapital: number;
}

export interface SkipTradeInput {
  userId: string;
  month: string;
  recommendationId: string;
  reason: string;
}

export interface ExitTradeInput {
  userId: string;
  month: string;
  /** Capital returned when position is closed (may differ from purchase amount) */
  returnedCapital: number;
}

export interface HoldTradeInput {
  userId: string;
  month: string;
  recommendationId: string;
}

export interface ArchiveMonthInput {
  userId: string;
  month: string;
}

// ─── Result types ─────────────────────────────────────────────────────────────

export type MonthlySetupResult =
  | { success: true; setup: MonthlySetupDocument }
  | { success: false; error: string };

// ─── Service ──────────────────────────────────────────────────────────────────

export class MonthlySetupService {
  constructor(private readonly db: Firestore = getDb()) {}

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Returns the Firestore document ID for a given user+month */
  private docId(userId: string, month: string): string {
    return `${userId}_${month}`;
  }

  private collection() {
    return this.db.collection(collectionNames.monthlySetup);
  }

  /** Fetches the setup document or returns null */
  async getSetup(
    userId: string,
    month: string
  ): Promise<MonthlySetupDocument | null> {
    const snap = await this.collection().doc(this.docId(userId, month)).get();
    if (!snap.exists) return null;
    return snap.data() as MonthlySetupDocument;
  }

  // ── createMonthlySetup ────────────────────────────────────────────────────

  /**
   * Creates a new monthly setup.
   * Rules:
   *  - One setup per YYYY-MM per user, locked after creation.
   *  - maxTradeCapital = capital × riskAllocation[riskLevel]
   *  - remainingCapital starts equal to capital
   */
  async createMonthlySetup(
    input: CreateMonthlySetupInput
  ): Promise<MonthlySetupResult> {
    const { userId, month, capital, riskLevel, tradingStyle } = input;
    const id = this.docId(userId, month);
    const ref = this.collection().doc(id);

    const existing = await ref.get();
    if (existing.exists) {
      return {
        success: false,
        error: `Monthly setup for ${month} already exists and is locked.`
      };
    }

    const maxTradeCapital = Math.floor(capital * RISK_ALLOCATION[riskLevel]);

    const now = new Date().toISOString();
    const { Timestamp } = await import("firebase-admin/firestore");
    const ts = Timestamp.now();

    const doc: MonthlySetupDocument = {
      id,
      userId,
      month,
      capital,
      riskLevel,
      tradingStyle,
      maxTradeCapital,
      remainingCapital: capital,
      archived: false,
      createdAt: ts,
      updatedAt: ts
    };

    await ref.set(doc);

    logger.info("Monthly setup created", { userId, month, capital, riskLevel });

    return { success: true, setup: doc };
  }

  // ── purchaseTrade ─────────────────────────────────────────────────────────

  /**
   * Called after the user manually confirms a purchase.
   * Deducts tradeCapital from remainingCapital.
   * Rules:
   *  - Month must not be archived.
   *  - tradeCapital must be ≤ maxTradeCapital.
   *  - tradeCapital must be ≤ remainingCapital.
   */
  async purchaseTrade(input: PurchaseTradeInput): Promise<MonthlySetupResult> {
    const { userId, month, tradeCapital } = input;
    const ref = this.collection().doc(this.docId(userId, month));

    const snap = await ref.get();
    if (!snap.exists) {
      return { success: false, error: `No monthly setup found for ${month}.` };
    }

    const setup = snap.data() as MonthlySetupDocument;

    if (setup.archived) {
      return {
        success: false,
        error: `Month ${month} is archived. No further purchases allowed.`
      };
    }

    if (tradeCapital > setup.maxTradeCapital) {
      return {
        success: false,
        error: `Trade capital ₹${tradeCapital} exceeds maxTradeCapital ₹${setup.maxTradeCapital}.`
      };
    }

    if (tradeCapital > setup.remainingCapital) {
      return {
        success: false,
        error: `Trade capital ₹${tradeCapital} exceeds remainingCapital ₹${setup.remainingCapital}.`
      };
    }

    const newRemaining = parseFloat(
      (setup.remainingCapital - tradeCapital).toFixed(2)
    );

    await ref.update({
      remainingCapital: newRemaining,
      updatedAt: FieldValue.serverTimestamp()
    });

    const updated = await ref.get();
    logger.info("Trade purchased — capital deducted", {
      userId,
      month,
      tradeCapital,
      remainingCapital: newRemaining
    });

    return { success: true, setup: updated.data() as MonthlySetupDocument };
  }

  // ── skipTrade ─────────────────────────────────────────────────────────────

  /**
   * User skips a recommendation.
   * No capital change. Logs the action.
   * The caller is responsible for creating a MissedTrade document.
   */
  async skipTrade(input: SkipTradeInput): Promise<MonthlySetupResult> {
    const { userId, month, recommendationId, reason } = input;

    const setup = await this.getSetup(userId, month);
    if (!setup) {
      return { success: false, error: `No monthly setup found for ${month}.` };
    }

    if (setup.archived) {
      return {
        success: false,
        error: `Month ${month} is archived.`
      };
    }

    logger.info("Trade skipped", { userId, month, recommendationId, reason });

    // No capital change — just confirm setup is alive and return it
    return { success: true, setup };
  }

  // ── exitTrade ─────────────────────────────────────────────────────────────

  /**
   * User exits a position. Returns capital back to remainingCapital.
   * Rules:
   *  - Month must not be archived.
   *  - returnedCapital must be ≥ 0.
   *  - remainingCapital after return must not exceed original capital
   *    (i.e. profit stays as capital until next month).
   */
  async exitTrade(input: ExitTradeInput): Promise<MonthlySetupResult> {
    const { userId, month, returnedCapital } = input;
    const ref = this.collection().doc(this.docId(userId, month));

    const snap = await ref.get();
    if (!snap.exists) {
      return { success: false, error: `No monthly setup found for ${month}.` };
    }

    const setup = snap.data() as MonthlySetupDocument;

    if (setup.archived) {
      return {
        success: false,
        error: `Month ${month} is archived.`
      };
    }

    if (returnedCapital < 0) {
      return { success: false, error: "Returned capital cannot be negative." };
    }

    // Add returned capital back; cap at original capital to avoid inflation
    const newRemaining = parseFloat(
      Math.min(
        setup.capital,
        setup.remainingCapital + returnedCapital
      ).toFixed(2)
    );

    await ref.update({
      remainingCapital: newRemaining,
      updatedAt: FieldValue.serverTimestamp()
    });

    const updated = await ref.get();
    logger.info("Trade exited — capital returned", {
      userId,
      month,
      returnedCapital,
      remainingCapital: newRemaining
    });

    return { success: true, setup: updated.data() as MonthlySetupDocument };
  }

  // ── holdTrade ─────────────────────────────────────────────────────────────

  /**
   * AI recommends holding an open position.
   * No capital change. Logs the action.
   */
  async holdTrade(input: HoldTradeInput): Promise<MonthlySetupResult> {
    const { userId, month, recommendationId } = input;

    const setup = await this.getSetup(userId, month);
    if (!setup) {
      return { success: false, error: `No monthly setup found for ${month}.` };
    }

    logger.info("Hold recommendation acknowledged", {
      userId,
      month,
      recommendationId
    });

    return { success: true, setup };
  }

  // ── archiveMonth ──────────────────────────────────────────────────────────

  /**
   * Closes out the month.
   * Rules:
   *  - Must not already be archived.
   *  - Open positions are carried forward (capital impact preserved, not reversed).
   *  - Sets archived = true and records archivedAt timestamp.
   */
  async archiveMonth(input: ArchiveMonthInput): Promise<MonthlySetupResult> {
    const { userId, month } = input;
    const ref = this.collection().doc(this.docId(userId, month));

    const snap = await ref.get();
    if (!snap.exists) {
      return { success: false, error: `No monthly setup found for ${month}.` };
    }

    const setup = snap.data() as MonthlySetupDocument;

    if (setup.archived) {
      return {
        success: false,
        error: `Month ${month} is already archived.`
      };
    }

    const archivedAt = new Date().toISOString();

    await ref.update({
      archived: true,
      archivedAt,
      updatedAt: FieldValue.serverTimestamp()
    });

    const updated = await ref.get();
    logger.info("Month archived", {
      userId,
      month,
      remainingCapital: setup.remainingCapital,
      archivedAt
    });

    return { success: true, setup: updated.data() as MonthlySetupDocument };
  }
}
