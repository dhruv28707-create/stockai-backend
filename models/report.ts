import { z } from "zod";

import {
  isoDateSchema,
  optionalMetadataSchema,
  userScopedSchema,
  type FirestoreDocument,
  type JsonValue
} from "./firestore";

// ─── Best Missed Trade ────────────────────────────────────────────────────────

export interface BestMissedTrade {
  symbol: string;
  stockName: string;
  entryPrice: number;
  peakPriceAchieved: number;
  suggestedQuantity: number;
  potentialProfit: number;        // (peakPrice - entryPrice) × quantity
  confidenceScore: number;        // 0–1
  reasonForMissing: "skipped" | "insufficient_capital";
  recommendationId: string;
  signalDate: string;             // ISO date
}

// ─── Trade Summary (used in both daily and weekly) ────────────────────────────

export interface TradeSummaryEntry {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  entryPrice: number;
  exitPrice?: number;
  pnl?: number;                   // (exitPrice - entryPrice) × quantity
  tradedOn: string;
}

// ─── Open Position Summary ────────────────────────────────────────────────────

export interface OpenPositionSummary {
  symbol: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  unrealisedPnL: number;          // (currentPrice - averagePrice) × quantity
}

// ─── Daily Report ─────────────────────────────────────────────────────────────

export interface DailyReportData {
  // P&L
  realisedPnL: number;            // sum of closed trade P&L for the day
  unrealisedPnL: number;          // sum of open position unrealised P&L
  totalPnL: number;               // realised + unrealised

  // Capital
  remainingCapital: number;       // from monthly setup

  // Positions
  openPositions: OpenPositionSummary[];
  openPositionCount: number;
  closedPositions: TradeSummaryEntry[];
  closedPositionCount: number;

  // Best / Worst trade of the day (by realised P&L)
  bestTrade?: TradeSummaryEntry;
  worstTrade?: TradeSummaryEntry;

  // Missed trade
  bestMissedTrade?: BestMissedTrade;

  // AI accuracy: closed profitable BUYs / total closed BUY trades (all time)
  aiAccuracy: number;             // 0–1
  aiAccuracyBasis: string;        // e.g. "3 of 5 closed BUY trades profitable"

  // Portfolio health score: 0–100
  portfolioHealth: number;
  portfolioHealthLabel: "Excellent" | "Good" | "Fair" | "Poor";

  // Counts
  totalRecommendationsToday: number;
  buySignalsToday: number;
  exitSignalsToday: number;
}

export interface DailyReportDocument extends FirestoreDocument {
  reportType: "daily";
  reportDate: string;             // YYYY-MM-DD
  periodStart: string;            // ISO date
  periodEnd: string;              // ISO date
  title: string;
  summary: string;
  data: DailyReportData;
  metadata?: Record<string, JsonValue>;
}

// ─── Weekly Report ────────────────────────────────────────────────────────────

export interface WeeklyReportData {
  // Core metrics
  weeklyPnL: number;
  winRate: number;                // closed profitable trades / total closed trades
  winRateBasis: string;           // e.g. "4 of 6 trades profitable"
  totalTrades: number;
  portfolioValue: number;         // remaining capital + unrealised P&L

  // Capital
  remainingCapital: number;

  // Best missed trade of the week
  bestMissedTrade?: BestMissedTrade;

  // Weekly breakdown
  dailyPnL: Record<string, number>;   // { "2025-06-02": 1200, ... }
  bestTrade?: TradeSummaryEntry;
  worstTrade?: TradeSummaryEntry;
}

export interface WeeklyReportDocument extends FirestoreDocument {
  reportType: "weekly";
  weekStart: string;              // YYYY-MM-DD (Monday)
  weekEnd: string;                // YYYY-MM-DD (Friday)
  periodStart: string;
  periodEnd: string;
  title: string;
  summary: string;
  data: WeeklyReportData;
  metadata?: Record<string, JsonValue>;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const createDailyReportSchema = userScopedSchema
  .extend({
    reportType: z.literal("daily").default("daily"),
    reportDate: isoDateSchema,
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
    title: z.string().trim().max(200),
    summary: z.string().trim().max(10000),
    data: z.record(z.string(), z.unknown()),
    metadata: optionalMetadataSchema
  })
  .strict();

export const updateDailyReportSchema = createDailyReportSchema
  .omit({ userId: true })
  .partial()
  .strict();

export const createWeeklyReportSchema = userScopedSchema
  .extend({
    reportType: z.literal("weekly").default("weekly"),
    weekStart: isoDateSchema,
    weekEnd: isoDateSchema,
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
    title: z.string().trim().max(200),
    summary: z.string().trim().max(10000),
    data: z.record(z.string(), z.unknown()),
    metadata: optionalMetadataSchema
  })
  .strict();

export const updateWeeklyReportSchema = createWeeklyReportSchema
  .omit({ userId: true })
  .partial()
  .strict();

export type DailyReportCreateInput = z.input<typeof createDailyReportSchema>;
export type DailyReportUpdateInput = z.input<typeof updateDailyReportSchema>;
export type WeeklyReportCreateInput = z.input<typeof createWeeklyReportSchema>;
export type WeeklyReportUpdateInput = z.input<typeof updateWeeklyReportSchema>;
