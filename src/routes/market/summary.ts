import { MarketDataService } from "../../../services/marketDataService.js";
import type { ApiHandler } from "../../../types/api.js";
import { sendError, sendJson } from "../../../utils/http.js";
import { logger, toErrorContext } from "../../../utils/logger.js";

// NSE index tickers
const INDEX_SYMBOLS = [
  { ticker: "^NSEI", name: "NIFTY 50" },
  { ticker: "^NSEBANK", name: "BANK NIFTY" }
];

// Small list — keeps cold-start fast, avoids timeouts
const MOVER_SYMBOLS = [
  "RELIANCE.NS",
  "TCS.NS",
  "HDFCBANK.NS",
  "INFY.NS",
  "ICICIBANK.NS",
  "HINDUNILVR.NS",
  "ITC.NS",
  "SBIN.NS",
  "BHARTIARTL.NS",
  "KOTAKBANK.NS"
];

/**
 * GET /api/market/summary
 * Returns market status, index values, top gainers and losers.
 * Uses fetchSymbol (quote only — no candles) to stay fast on serverless.
 */
const handler: ApiHandler = async (request, response) => {
  if (request.method !== "GET") {
    sendError(response, 405, "method_not_allowed", "Method not allowed.");
    return;
  }

  try {
    const svc = new MarketDataService();

    // Fetch all symbols in parallel — quote only, much faster than fetchBatch
    const allSymbols = [...INDEX_SYMBOLS.map((i) => i.ticker), ...MOVER_SYMBOLS];
    const results = await Promise.allSettled(
      allSymbols.map((ticker) => svc.fetchSymbol(ticker))
    );

    // Map results by ticker
    const byTicker: Record<
      string,
      { price: number; previousClose: number; volume: number }
    > = {};
    allSymbols.forEach((ticker, i) => {
      const r = results[i];
      if (r.status === "fulfilled" && r.value) {
        byTicker[ticker] = {
          price: r.value.quote.price,
          previousClose: r.value.quote.previousClose,
          volume: r.value.quote.volume
        };
      }
    });

    // Build indices
    const indices = INDEX_SYMBOLS.filter((i) => byTicker[i.ticker]).map((i) => {
      const q = byTicker[i.ticker];
      const change = parseFloat((q.price - q.previousClose).toFixed(2));
      const changePercent = parseFloat(((change / q.previousClose) * 100).toFixed(2));
      return {
        name: i.name,
        value: q.price,
        change,
        changePercent,
        previousClose: q.previousClose
      };
    });

    // Build movers
    const movers = MOVER_SYMBOLS.filter((ticker) => byTicker[ticker]).map((ticker) => {
      const q = byTicker[ticker];
      const change = parseFloat((q.price - q.previousClose).toFixed(2));
      const changePercent = parseFloat(((change / q.previousClose) * 100).toFixed(2));
      return { symbol: ticker.replace(".NS", ""), price: q.price, change, changePercent };
    });

    const topGainers = [...movers]
      .sort((a, b) => b.changePercent - a.changePercent)
      .slice(0, 5);
    const topLosers = [...movers]
      .sort((a, b) => a.changePercent - b.changePercent)
      .slice(0, 5);

    // Market status in IST
    const istMinutes =
      (new Date().getUTCHours() * 60 + new Date().getUTCMinutes() + 330) % 1440;
    const status =
      istMinutes >= 555 && istMinutes < 930
        ? "OPEN"
        : istMinutes >= 540 && istMinutes < 555
          ? "PRE_OPEN"
          : "CLOSED";

    sendJson(response, 200, {
      data: {
        status,
        indices,
        topGainers,
        topLosers,
        updatedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    logger.error("GET /api/market/summary failed", { ...toErrorContext(err) });
    sendError(response, 500, "internal_error", "Failed to fetch market summary.");
  }
};

export default handler;
