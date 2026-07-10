import YahooFinance from "yahoo-finance2";
import { getYahooTickers } from "../config/stocks";

const yahooFinance = new YahooFinance();

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data as T;
  cache.delete(key);
  return null;
}

function setCache<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

const CACHE_TTL = 60_000;

const NSE_INDICES = [
  { ticker: "^NSEI", name: "NIFTY 50" },
  { ticker: "^NSEBANK", name: "BANK NIFTY" }
];

const NSE_STOCKS = getYahooTickers();

interface IndexData {
  name: string;
  value: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  prevClose: number;
  volume: number;
  timestamp: string;
}

interface MoverData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  exchange: string;
}

interface MarketSummary {
  source: string;
  status: string;
  marketStatus: string;
  marketState: string;
  isMarketOpen: boolean;
  isOpen: boolean;
  indices: IndexData[];
  topGainers: MoverData[];
  topLosers: MoverData[];
  advanceDeclineRatio: number;
  totalTradedVolume: number;
  updatedAt: string;
}

function getFallbackMarketStatus(): "OPEN" | "PRE_OPEN" | "CLOSED" {
  const now = new Date();
  const istDate = new Date(now.getTime() + 330 * 60 * 1000);
  const day = istDate.getUTCDay();
  if (day === 0 || day === 6) return "CLOSED";

  const istMin = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440;
  if (istMin >= 555 && istMin < 930) return "OPEN";
  if (istMin >= 540 && istMin < 555) return "PRE_OPEN";
  return "CLOSED";
}

function getMarketStatus(indexQuote?: Record<string, unknown>): "OPEN" | "PRE_OPEN" | "CLOSED" {
  const exchangeState = String(
    indexQuote?.marketState ?? indexQuote?.fullExchangeName ?? ""
  ).toUpperCase();

  if (exchangeState === "REGULAR" || exchangeState === "OPEN") return "OPEN";
  if (exchangeState === "PRE" || exchangeState === "PREPRE") return "PRE_OPEN";
  if (
    exchangeState === "CLOSED" ||
    exchangeState === "POST" ||
    exchangeState === "POSTPOST"
  ) {
    return "CLOSED";
  }

  return getFallbackMarketStatus();
}

const YAHOO_BATCH = 30;

async function fetchYahooQuotes(tickers: string[]): Promise<Record<string, Record<string, unknown>>> {
  const quotes: Record<string, Record<string, unknown>> = {};
  for (let i = 0; i < tickers.length; i += YAHOO_BATCH) {
    const batch = tickers.slice(i, i + YAHOO_BATCH);
    let results: (Record<string, unknown> | null)[];
    try {
      results = (await yahooFinance.quote(batch, {}, { validateResult: false })) as (Record<string, unknown> | null)[];
    } catch {
      continue;
    }
    if (Array.isArray(results)) {
      results.forEach((result, j) => {
        if (result) quotes[batch[j]] = result;
      });
    }
  }
  return quotes;
}

export async function getMarketSummary(): Promise<MarketSummary> {
  const cached = getCached<MarketSummary>("market_summary");
  if (cached) return cached;

  const allTickers = [...NSE_INDICES.map((i) => i.ticker), ...NSE_STOCKS];
  const quotes = await fetchYahooQuotes(allTickers);

  const indices: IndexData[] = NSE_INDICES.filter((i) => quotes[i.ticker]).map((i) => {
    const q = quotes[i.ticker];
    const price = (q.regularMarketPrice as number) ?? 0;
    const prevClose = (q.regularMarketPreviousClose as number) ?? price;
    const change = price - prevClose;
    return {
      name: i.name,
      value: price,
      change: Math.round(change * 100) / 100,
      changePercent: prevClose ? Math.round((change / prevClose) * 10000) / 100 : 0,
      high: (q.regularMarketDayHigh as number) ?? price,
      low: (q.regularMarketDayLow as number) ?? price,
      open: (q.regularMarketOpen as number) ?? prevClose,
      prevClose,
      volume: (q.regularMarketVolume as number) ?? 0,
      timestamp: new Date().toISOString()
    };
  });

  const movers = NSE_STOCKS.filter((t) => quotes[t]).map((t) => {
    const q = quotes[t];
    const price = (q.regularMarketPrice as number) ?? 0;
    const prevClose = (q.regularMarketPreviousClose as number) ?? price;
    const change = price - prevClose;
    return {
      symbol: t.replace(".NS", ""),
      name: (q.shortName as string) ?? (q.longName as string) ?? t.replace(".NS", ""),
      price,
      change: Math.round(change * 100) / 100,
      changePercent: prevClose ? Math.round((change / prevClose) * 10000) / 100 : 0,
      volume: (q.regularMarketVolume as number) ?? 0,
      exchange: "NSE"
    };
  });

  const sortedByChange = [...movers].sort((a, b) => b.changePercent - a.changePercent);
  const topGainers = sortedByChange.slice(0, 5);
  const topLosers = sortedByChange.slice(-5).reverse();

  const totalVolume = movers.reduce((sum, m) => sum + m.volume, 0);
  const advancers = movers.filter((m) => m.changePercent > 0).length;
  const decliners = movers.filter((m) => m.changePercent < 0).length;
  const status = getMarketStatus(quotes["^NSEI"]);

  const result: MarketSummary = {
    source: "yahoo",
    status,
    marketStatus: status,
    marketState: status,
    isMarketOpen: status === "OPEN",
    isOpen: status === "OPEN",
    indices,
    topGainers,
    topLosers,
    advanceDeclineRatio:
      decliners > 0
        ? Math.round((advancers / decliners) * 100) / 100
        : advancers > 0
          ? 99
          : 1,
    totalTradedVolume: totalVolume,
    updatedAt: new Date().toISOString()
  };

  setCache("market_summary", result, CACHE_TTL);
  return result;
}
