import { MarketDataService } from "../../../services/marketDataService.js";
import type { ApiHandler } from "../../../types/api.js";
import { sendError, sendJson } from "../../../utils/http.js";
import { logger } from "../../../utils/logger.js";

// NSE index tickers on yahoo-finance2
const INDEX_SYMBOLS = [
  { ticker: "^NSEI", name: "NIFTY 50" },
  { ticker: "^NSEBANK", name: "BANK NIFTY" }
];

// Top liquid NSE stocks to scan for gainers/losers
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
  "KOTAKBANK.NS",
  "LT.NS",
  "HCLTECH.NS",
  "AXISBANK.NS",
  "MARUTI.NS",
  "SUNPHARMA.NS",
  "TITAN.NS",
  "BAJFINANCE.NS",
  "WIPRO.NS",
  "TATAMOTORS.NS",
  "ONGC.NS"
];

/**
 * GET /api/market/summary
 *
 * Returns:
 * - Market status (OPEN / CLOSED based on IST time)
 * - NIFTY 50 and BANK NIFTY index data
 * - Top 5 gainers and top 5 losers from liquid NSE stocks
 */
const handler: ApiHandler = async (request, response) => {
  if (request.method !== "GET") {
    sendError(response, 405, "method_not_allowed", "Method not allowed.");
    return;
  }

  try {
    const marketSvc = new MarketDataService();

    // Fetch indices and movers in parallel
    const [indexResults, moverResults] = await Promise.all([
      marketSvc.fetchBatch(INDEX_SYMBOLS.map((i) => i.ticker)),
      marketSvc.fetchBatch(MOVER_SYMBOLS)
    ]);

    // Build index objects
    const indices = indexResults.map((result) => {
      const label =
        INDEX_SYMBOLS.find((i) => i.ticker === result.symbol)?.name ?? result.symbol;
      const q = result.quote;
      const change = parseFloat((q.price - q.previousClose).toFixed(2));
      const changePercent = parseFloat(((change / q.previousClose) * 100).toFixed(2));
      return {
        name: label,
        value: q.price,
        change,
        changePercent,
        previousClose: q.previousClose,
        volume: q.volume,
        timestamp: new Date().toISOString()
      };
    });

    // Build movers list
    const movers = moverResults.map((result) => {
      const q = result.quote;
      const change = parseFloat((q.price - q.previousClose).toFixed(2));
      const changePercent = parseFloat(((change / q.previousClose) * 100).toFixed(2));
      // Strip ".NS" suffix for display
      const symbol = result.symbol.replace(".NS", "").replace(".BO", "");
      return { symbol, price: q.price, change, changePercent, volume: q.volume };
    });

    const topGainers = [...movers]
      .sort((a, b) => b.changePercent - a.changePercent)
      .slice(0, 5);

    const topLosers = [...movers]
      .sort((a, b) => a.changePercent - b.changePercent)
      .slice(0, 5);

    // Determine market status using IST (UTC+5:30)
    const now = new Date();
    const istHour = ((now.getUTCHours() + 5) % 24) + (now.getUTCMinutes() >= 30 ? 0 : 0);
    const istMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % (24 * 60);
    const marketOpen = istMinutes >= 555 && istMinutes < 930; // 9:15 AM to 3:30 PM IST
    const preOpen = istMinutes >= 540 && istMinutes < 555; // 9:00–9:15 AM
    const status = preOpen ? "PRE_OPEN" : marketOpen ? "OPEN" : "CLOSED";

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
    logger.error("GET /api/market/summary failed", {
      error: err instanceof Error ? err.message : String(err)
    });
    sendError(response, 500, "internal_error", "Failed to fetch market summary.");
  }
};

export default handler;
