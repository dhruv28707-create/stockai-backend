import type { IndicatorResult } from "./indicatorService";
import type { MarketQuote } from "./marketDataService";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SignalType = "BUY" | "EXIT";

export interface ScoreBreakdown {
  rsiScore: number;       // 0–20
  macdScore: number;      // 0–25
  emaScore: number;       // 0–25
  atrScore: number;       // 0–10
  volumeScore: number;    // 0–20
  total: number;          // 0–100
}

export interface ScoringResult {
  signal: SignalType;
  confidence: number;       // 0.00 – 1.00
  breakdown: ScoreBreakdown;
  shouldAlert: boolean;     // confidence >= 0.80
}

// ─── BUY Scoring ─────────────────────────────────────────────────────────────
//
// Rule-based. NO LLM involved.
// Each indicator contributes a weighted sub-score.
// Total = sum of all sub-scores (max 100).
// Confidence = total / 100.
//
// RSI (20 pts):
//   RSI 40–60 = momentum building = 20 pts
//   RSI 30–40 or 60–70 = edge zones = 10 pts
//   RSI < 30 (oversold) = 15 pts (reversal possible but risky)
//   RSI > 70 (overbought) = 0 pts (bad entry)
//
// MACD (25 pts):
//   Histogram positive AND macd > signal = 25 pts (bullish momentum)
//   Histogram just crossed zero (prev neg, now pos) = 25 pts
//   Histogram positive but narrowing = 12 pts
//   Histogram negative = 0 pts
//
// EMA Trend (25 pts):
//   Price > EMA20 > EMA50 = strong uptrend = 25 pts
//   Price > EMA20, EMA20 < EMA50 = weak = 12 pts
//   Price < EMA20 = no trend = 0 pts
//
// ATR / Volatility (10 pts):
//   ATR between 0.5% and 3% of price = healthy vol = 10 pts
//   ATR > 3% of price = too volatile = 5 pts
//   ATR < 0.5% of price = too flat = 3 pts
//
// Volume Breakout (20 pts):
//   Volume ratio >= 2.0 = 20 pts
//   Volume ratio >= 1.5 = 15 pts
//   Volume ratio >= 1.0 = 8 pts
//   Volume ratio < 1.0 = 0 pts

const scoreBUY = (
  indicators: IndicatorResult,
  quote: MarketQuote
): ScoreBreakdown => {
  const { rsi, macd, ema20, ema50, atr, volumeBreakout } = indicators;
  const price = quote.price;

  // RSI
  let rsiScore = 0;
  if (rsi >= 40 && rsi <= 60) rsiScore = 20;
  else if ((rsi >= 30 && rsi < 40) || (rsi > 60 && rsi <= 70)) rsiScore = 10;
  else if (rsi < 30) rsiScore = 15;
  else rsiScore = 0; // > 70

  // MACD
  let macdScore = 0;
  if (macd.histogram > 0 && macd.macdLine > macd.signalLine) macdScore = 25;
  else if (macd.histogram > 0) macdScore = 12;
  else macdScore = 0;

  // EMA Trend
  let emaScore = 0;
  if (price > ema20 && ema20 > ema50) emaScore = 25;
  else if (price > ema20) emaScore = 12;
  else emaScore = 0;

  // ATR
  const atrPct = price > 0 ? (atr / price) * 100 : 0;
  let atrScore = 0;
  if (atrPct >= 0.5 && atrPct <= 3) atrScore = 10;
  else if (atrPct > 3) atrScore = 5;
  else atrScore = 3;

  // Volume Breakout
  let volumeScore = 0;
  if (volumeBreakout.ratio >= 2.0) volumeScore = 20;
  else if (volumeBreakout.ratio >= 1.5) volumeScore = 15;
  else if (volumeBreakout.ratio >= 1.0) volumeScore = 8;
  else volumeScore = 0;

  const total = rsiScore + macdScore + emaScore + atrScore + volumeScore;

  return {
    rsiScore,
    macdScore,
    emaScore,
    atrScore,
    volumeScore,
    total: Math.min(total, 100)
  };
};

// ─── EXIT Scoring ─────────────────────────────────────────────────────────────
//
// Exit signals are the inverse of buy signals.
// We alert when indicators suggest the trade is weakening.
//
// RSI (20 pts):
//   RSI > 70 (overbought) = 20 pts — take profit
//   RSI > 65 = 12 pts — getting hot
//   RSI < 30 (oversold further) = 15 pts — stop loss territory
//
// MACD (25 pts):
//   Histogram negative AND macd < signal = 25 pts (bearish)
//   Histogram just crossed zero (prev pos, now neg) = 25 pts
//   Histogram negative but narrowing = 12 pts
//   Histogram positive = 0 pts
//
// EMA Trend (25 pts):
//   Price < EMA20 < EMA50 = downtrend = 25 pts
//   Price < EMA20, EMA20 > EMA50 = 12 pts
//   Price > EMA20 = 0 pts (still bullish, hold)
//
// ATR (10 pts):
//   ATR > 3% of price = increased volatility (risk) = 10 pts
//   ATR > 2% = 6 pts
//   Otherwise = 0 pts
//
// Volume (20 pts):
//   High volume + price falling = distribution signal
//   ratio >= 2.0 on a down day = 20 pts
//   ratio >= 1.5 = 12 pts
//   Otherwise = 0 pts

const scoreEXIT = (
  indicators: IndicatorResult,
  quote: MarketQuote
): ScoreBreakdown => {
  const { rsi, macd, ema20, ema50, atr, volumeBreakout } = indicators;
  const price = quote.price;
  const isDownDay = price < quote.previousClose;

  // RSI
  let rsiScore = 0;
  if (rsi > 70) rsiScore = 20;
  else if (rsi > 65) rsiScore = 12;
  else if (rsi < 30) rsiScore = 15;

  // MACD
  let macdScore = 0;
  if (macd.histogram < 0 && macd.macdLine < macd.signalLine) macdScore = 25;
  else if (macd.histogram < 0) macdScore = 12;

  // EMA Trend
  let emaScore = 0;
  if (price < ema20 && ema20 < ema50) emaScore = 25;
  else if (price < ema20) emaScore = 12;

  // ATR
  const atrPct = price > 0 ? (atr / price) * 100 : 0;
  let atrScore = 0;
  if (atrPct > 3) atrScore = 10;
  else if (atrPct > 2) atrScore = 6;

  // Volume on down day
  let volumeScore = 0;
  if (isDownDay) {
    if (volumeBreakout.ratio >= 2.0) volumeScore = 20;
    else if (volumeBreakout.ratio >= 1.5) volumeScore = 12;
  }

  const total = rsiScore + macdScore + emaScore + atrScore + volumeScore;

  return {
    rsiScore,
    macdScore,
    emaScore,
    atrScore,
    volumeScore,
    total: Math.min(total, 100)
  };
};

// ─── Service ──────────────────────────────────────────────────────────────────

export const CONFIDENCE_THRESHOLD = 0.80;

export class ScoringService {
  /**
   * Score a symbol for BUY opportunity.
   * Returns confidence 0–1. shouldAlert = true if >= 0.80.
   */
  scoreBuy(
    indicators: IndicatorResult,
    quote: MarketQuote
  ): ScoringResult {
    const breakdown = scoreBUY(indicators, quote);
    const confidence = parseFloat((breakdown.total / 100).toFixed(4));
    return {
      signal: "BUY",
      confidence,
      breakdown,
      shouldAlert: confidence >= CONFIDENCE_THRESHOLD
    };
  }

  /**
   * Score an open position for EXIT signal.
   * Returns confidence 0–1. shouldAlert = true if >= 0.80.
   */
  scoreExit(
    indicators: IndicatorResult,
    quote: MarketQuote
  ): ScoringResult {
    const breakdown = scoreEXIT(indicators, quote);
    const confidence = parseFloat((breakdown.total / 100).toFixed(4));
    return {
      signal: "EXIT",
      confidence,
      breakdown,
      shouldAlert: confidence >= CONFIDENCE_THRESHOLD
    };
  }
}
