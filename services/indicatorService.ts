import type { OHLCV } from "./marketDataService";

// ─── Output Types ─────────────────────────────────────────────────────────────

export interface IndicatorResult {
  rsi: number;           // 0–100
  macd: MACDResult;
  ema20: number;
  ema50: number;
  atr: number;           // Average True Range (absolute price units)
  volumeBreakout: VolumeBreakoutResult;
}

export interface MACDResult {
  macdLine: number;
  signalLine: number;
  histogram: number;
}

export interface VolumeBreakoutResult {
  currentVolume: number;
  avgVolume20: number;    // 20-day average volume
  ratio: number;          // currentVolume / avgVolume20
  isBreakout: boolean;    // ratio >= 1.5
}

// ─── Pure Math Helpers ────────────────────────────────────────────────────────

/**
 * Exponential Moving Average.
 * k = 2 / (period + 1)
 */
const calcEMA = (closes: number[], period: number): number[] => {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const emas: number[] = [];

  // Seed with SMA of first `period` values
  const seed =
    closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  emas.push(seed);

  for (let i = period; i < closes.length; i++) {
    const prev = emas[emas.length - 1] as number;
    emas.push((closes[i] as number) * k + prev * (1 - k));
  }

  return emas;
};

/**
 * Relative Strength Index (Wilder smoothing, 14-period).
 * Returns the most recent RSI value.
 */
const calcRSI = (closes: number[], period = 14): number => {
  if (closes.length < period + 1) return 50; // neutral fallback

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = (closes[i] as number) - (closes[i - 1] as number);
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Wilder smoothing for remaining candles
  for (let i = period + 1; i < closes.length; i++) {
    const diff = (closes[i] as number) - (closes[i - 1] as number);
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
};

/**
 * MACD: 12-EMA minus 26-EMA, signal = 9-EMA of MACD, histogram = MACD - signal.
 */
const calcMACD = (closes: number[]): MACDResult => {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);

  // Align: ema26 is shorter (starts 26 bars in, ema12 starts 12 bars in)
  // Both arrays start at their respective seed points relative to original array.
  // Offset: ema26[0] corresponds to closes[25], ema12[0] to closes[11]
  // So ema12 index that aligns with ema26[0] = ema12[25-11] = ema12[14]
  const offset = 26 - 12; // = 14
  const macdLine: number[] = [];

  for (let i = 0; i < ema26.length; i++) {
    macdLine.push((ema12[i + offset] as number) - (ema26[i] as number));
  }

  const signalEMA = calcEMA(macdLine, 9);
  const lastMACD = macdLine[macdLine.length - 1] ?? 0;
  const lastSignal = signalEMA[signalEMA.length - 1] ?? 0;

  return {
    macdLine: parseFloat(lastMACD.toFixed(4)),
    signalLine: parseFloat(lastSignal.toFixed(4)),
    histogram: parseFloat((lastMACD - lastSignal).toFixed(4))
  };
};

/**
 * Average True Range (14-period Wilder smoothing).
 * True Range = max(high-low, |high-prevClose|, |low-prevClose|)
 */
const calcATR = (candles: OHLCV[], period = 14): number => {
  if (candles.length < period + 1) return 0;

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i] as OHLCV;
    const prev = candles[i - 1] as OHLCV;
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    trs.push(tr);
  }

  // Seed ATR with simple average of first `period` TRs
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + (trs[i] as number)) / period;
  }

  return parseFloat(atr.toFixed(2));
};

/**
 * Volume Breakout: current volume vs. 20-day average.
 * Breakout = ratio >= 1.5 (50% above average).
 */
const calcVolumeBreakout = (candles: OHLCV[]): VolumeBreakoutResult => {
  const last = candles[candles.length - 1] as OHLCV;
  const lookback = candles.slice(-21, -1); // previous 20 days (excluding today)
  const avgVolume20 =
    lookback.length > 0
      ? lookback.reduce((a, b) => a + b.volume, 0) / lookback.length
      : last.volume;

  const ratio = avgVolume20 > 0 ? last.volume / avgVolume20 : 1;

  return {
    currentVolume: last.volume,
    avgVolume20: Math.round(avgVolume20),
    ratio: parseFloat(ratio.toFixed(2)),
    isBreakout: ratio >= 1.5
  };
};

// ─── Service ──────────────────────────────────────────────────────────────────

export class IndicatorService {
  /**
   * Compute all indicators from OHLCV candles.
   * Requires at least 60 candles (enforced upstream in MarketDataService).
   */
  compute(candles: OHLCV[]): IndicatorResult {
    const closes = candles.map((c) => c.close);

    const ema20Array = calcEMA(closes, 20);
    const ema50Array = calcEMA(closes, 50);

    return {
      rsi: calcRSI(closes),
      macd: calcMACD(closes),
      ema20: parseFloat((ema20Array[ema20Array.length - 1] ?? 0).toFixed(2)),
      ema50: parseFloat((ema50Array[ema50Array.length - 1] ?? 0).toFixed(2)),
      atr: calcATR(candles),
      volumeBreakout: calcVolumeBreakout(candles)
    };
  }
}
