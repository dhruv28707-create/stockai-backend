import yahooFinance from "yahoo-finance2";

import { logger } from "../utils/logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OHLCV {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketQuote {
  symbol: string;
  price: number;
  volume: number;
  previousClose: number;
  marketCap?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
}

export interface MarketDataResult {
  symbol: string;
  quote: MarketQuote;
  /** Last 60 trading-day OHLCV candles — enough for EMA50 + MACD */
  candles: OHLCV[];
}

// ─── Internal raw types from yahoo-finance2 ───────────────────────────────────

interface RawCandle {
  date: Date;
  open: number | null | undefined;
  high: number | null | undefined;
  low: number | null | undefined;
  close: number | null | undefined;
  volume: number | null | undefined;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class MarketDataService {
  /**
   * Fetch real-time quote + 60-day historical OHLCV for one symbol.
   * Returns null if yahoo-finance2 cannot find the symbol or data is sparse.
   */
  async fetchSymbol(symbol: string): Promise<MarketDataResult | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      const [quote, historical] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        yahooFinance.quote(symbol, {}, { validateResult: false }) as Promise<Record<string, unknown>>,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        yahooFinance.historical(symbol, {
          period1: this.daysAgo(90),
          period2: new Date(),
          interval: "1d"
        }, { validateResult: false }) as Promise<RawCandle[]>
      ]);

      const price = quote["regularMarketPrice"];
      if (!quote || typeof price !== "number") {
        logger.warn("No quote data", { symbol });
        return null;
      }

      const previousClose =
        typeof quote["regularMarketPreviousClose"] === "number"
          ? quote["regularMarketPreviousClose"]
          : price;

      // Filter invalid candles, sort oldest→newest, keep last 60
      const candles: OHLCV[] = (historical as RawCandle[])
        .filter(
          (d: RawCandle) =>
            d.open != null &&
            d.high != null &&
            d.low != null &&
            d.close != null &&
            d.volume != null
        )
        .sort((a: RawCandle, b: RawCandle) => a.date.getTime() - b.date.getTime())
        .slice(-60)
        .map((d: RawCandle) => ({
          date: d.date,
          open: d.open as number,
          high: d.high as number,
          low: d.low as number,
          close: d.close as number,
          volume: d.volume as number
        }));

      if (candles.length < 26) {
        logger.warn("Insufficient candles for analysis", {
          symbol,
          count: candles.length
        });
        return null;
      }

      return {
        symbol,
        quote: {
          symbol,
          price,
          volume:
            typeof quote["regularMarketVolume"] === "number"
              ? quote["regularMarketVolume"]
              : 0,
          previousClose,
          ...(typeof quote["marketCap"] === "number"
            ? { marketCap: quote["marketCap"] }
            : {}),
          ...(typeof quote["fiftyTwoWeekHigh"] === "number"
            ? { fiftyTwoWeekHigh: quote["fiftyTwoWeekHigh"] }
            : {}),
          ...(typeof quote["fiftyTwoWeekLow"] === "number"
            ? { fiftyTwoWeekLow: quote["fiftyTwoWeekLow"] }
            : {})
        },
        candles
      };
    } catch (err) {
      logger.warn("Failed to fetch symbol", {
        symbol,
        error: err instanceof Error ? err.message : String(err)
      });
      return null;
    }
  }

  /**
   * Fetch a batch of symbols concurrently.
   * Silently skips symbols that fail or return null.
   */
  async fetchBatch(symbols: string[]): Promise<MarketDataResult[]> {
    const results = await Promise.allSettled(
      symbols.map((s) => this.fetchSymbol(s))
    );

    return results
      .filter(
        (r): r is PromiseFulfilledResult<MarketDataResult> =>
          r.status === "fulfilled" && r.value !== null
      )
      .map((r) => r.value);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private daysAgo(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  }
}

