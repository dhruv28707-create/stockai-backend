import { z } from "zod";

import {
  nonEmptyStringSchema,
  optionalMetadataSchema,
  userScopedSchema,
  yearMonthSchema,
  type FirestoreDocument,
  type JsonValue
} from "./firestore";

// ─── Risk Level ───────────────────────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high";

/**
 * Fraction of total capital that may be allocated to a single trade.
 * low = 10%, medium = 20%, high = 30%
 */
export const RISK_ALLOCATION: Record<RiskLevel, number> = {
  low: 0.1,
  medium: 0.2,
  high: 0.3
};

// ─── Document Interface ───────────────────────────────────────────────────────

export interface MonthlySetupDocument extends FirestoreDocument {
  /** YYYY-MM — unique per user per month, locked after creation */
  month: string;
  /** Total capital the user enters at the start of the month (INR) */
  capital: number;
  /** Risk appetite for this month */
  riskLevel: RiskLevel;
  /** Free-text trading style the user provides each month (e.g. "Swing") */
  tradingStyle: string;
  /** capital × riskAllocation — computed on creation, never changes */
  maxTradeCapital: number;
  /** Starts equal to capital. Decremented on purchaseTrade(), never below 0 */
  remainingCapital: number;
  /** Set to true by archiveMonth(). Prevents further purchases */
  archived: boolean;
  /** ISO timestamp when archiveMonth() was called */
  archivedAt?: string;
  metadata?: Record<string, JsonValue>;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const createMonthlySetupSchema = userScopedSchema
  .extend({
    month: yearMonthSchema,
    capital: z.number().finite().positive(),
    riskLevel: z.enum(["low", "medium", "high"]),
    tradingStyle: nonEmptyStringSchema,
    maxTradeCapital: z.number().finite().positive(),
    remainingCapital: z.number().finite().nonnegative(),
    archived: z.boolean().default(false),
    archivedAt: z.string().optional(),
    metadata: optionalMetadataSchema
  })
  .strict();

export const updateMonthlySetupSchema = createMonthlySetupSchema
  .omit({ userId: true })
  .partial()
  .strict();

export type MonthlySetupCreateInput = z.input<typeof createMonthlySetupSchema>;
export type MonthlySetupUpdateInput = z.input<typeof updateMonthlySetupSchema>;
