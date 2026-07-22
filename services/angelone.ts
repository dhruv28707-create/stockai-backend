import { createHmac } from "node:crypto";
import { env } from "../config/env";
import {
  getAngelSymbols,
  getStockSymbols,
  BATCH_SIZE,
  TOTAL_BATCHES
} from "../config/stocks";

const BASE_URL = "https://apiconnect.angelbroking.com";

interface AngelOneTokens {
  authToken: string;
  refreshToken: string;
  feedToken: string;
  clientId: string;
}

let tokenCache: { tokens: AngelOneTokens; expiresAt: number } | null = null;

const NSE_INDICES = [
  { angelSymbol: "NIFTY 50", token: "99926000" },
  { angelSymbol: "BANKNIFTY", token: "99926009" }
];

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.replace(/[^A-Za-z2-7]/g, "").toUpperCase();
  const bytes: number[] = [];
  let buffer = 0;
  let bitsLeft = 0;
  for (const char of cleaned) {
    const val = BASE32_CHARS.indexOf(char);
    if (val === -1) continue;
    buffer = (buffer << 5) | val;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      bytes.push((buffer >> bitsLeft) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function generateTotp(secret: string): string {
  const key = base32Decode(secret);
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / 30);
  const counterBuf = Buffer.alloc(8);
  let remaining = counter;
  for (let i = 7; i >= 0; i--) {
    counterBuf[i] = remaining & 0xff;
    remaining >>= 8;
  }
  const hmac = createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, "0");
}

export function isAngelOneConfigured(): boolean {
  return !!(
    env.ANGEL_ONE_API_KEY &&
    env.ANGEL_ONE_CLIENT_ID &&
    env.ANGEL_ONE_MPIN &&
    env.ANGEL_ONE_TOTP_SECRET
  );
}

function buildHeaders(apiKey: string, authToken?: string): Record<string, string> {
  return {
    "X-PrivateKey": apiKey,
    "X-SourceID": "WEB",
    "X-ClientLocalIP": "192.168.1.100",
    "X-ClientPublicIP": "103.95.97.4",
    "X-MACAddress": "00:1A:2B:3C:4D:5E",
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
  };
}

interface LoginResponse {
  status?: boolean;
  errorCode?: string;
  message?: string;
  error?: string;
  data?: {
    jwtToken?: string;
    authToken?: string;
    refreshToken?: string;
    feedToken?: string;
  };
}

export async function login(): Promise<AngelOneTokens> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.tokens;
  }

  const totp = generateTotp(env.ANGEL_ONE_TOTP_SECRET!);

  const response = await fetch(`${BASE_URL}/rest/auth/angelbroking/user/login/v1`, {
    method: "POST",
    headers: buildHeaders(env.ANGEL_ONE_API_KEY!),
    body: JSON.stringify({
      clientcode: env.ANGEL_ONE_CLIENT_ID,
      password: env.ANGEL_ONE_MPIN,
      totp
    })
  });

  const loginText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Angel One login failed (${response.status}): ${loginText.slice(0, 300)}`
    );
  }

  let json: LoginResponse;
  try {
    json = JSON.parse(loginText);
  } catch {
    throw new Error(`Angel One login response not JSON: ${loginText.slice(0, 300)}`);
  }

  if (json.status !== true && json.errorCode) {
    throw new Error(
      `Angel One login error: ${json.message ?? json.error ?? JSON.stringify(json).slice(0, 300)}`
    );
  }

  const tokens: AngelOneTokens = {
    authToken: json.data?.jwtToken ?? json.data?.authToken ?? "",
    refreshToken: json.data?.refreshToken ?? "",
    feedToken: json.data?.feedToken ?? "",
    clientId: env.ANGEL_ONE_CLIENT_ID!
  };

  tokenCache = { tokens, expiresAt: Date.now() + 20 * 60 * 60 * 1000 };

  return tokens;
}

export async function refreshSession(): Promise<AngelOneTokens> {
  tokenCache = null;
  return login();
}

export interface AngelOneQuoteData {
  tradingSymbol: string;
  symbolToken: string;
  open: number;
  high: number;
  low: number;
  close: number;
  ltp: number;
  dayChange: number;
  dayChangePercentage: number;
  volume: number;
  totalBuyQty: number;
  totalSellQty: number;
  lowerCircuit: number;
  upperCircuit: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  lastTime: string;
}

interface AngelOneQuoteResponse {
  status: boolean;
  message?: string;
  error?: string;
  data: Record<string, AngelOneQuoteData>;
}

function fromAngelSymbol(angelSymbol: string): string {
  return angelSymbol.replace("-EQ", "");
}

// ← exported so index.ts can call it directly in the scan routes
export async function getQuotes(
  batchNumber?: number
): Promise<Record<string, AngelOneQuoteData>> {
  const tokens = await login();
  const symbols = [
    ...NSE_INDICES.map((i) => i.angelSymbol),
    ...getAngelSymbols(batchNumber)
  ];

  const response = await fetch(`${BASE_URL}/rest/secure/angelbroking/market/v1/quote`, {
    method: "POST",
    headers: buildHeaders(env.ANGEL_ONE_API_KEY!, tokens.authToken),
    body: JSON.stringify({
      mode: "FULL",
      tradingSymbols: symbols.map((s) => `NSE:${s.toUpperCase()}`)
    })
  });

  const text = await response.text();
  let json: AngelOneQuoteResponse;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Angel One quote response not JSON: ${text.slice(0, 500)}`);
  }

  if (!response.ok && json.status !== true) {
    throw new Error(
      `Angel One quote failed (${response.status}): ${json.message ?? JSON.stringify(json).slice(0, 300)}`
    );
  }

  const result: Record<string, AngelOneQuoteData> = {};
  for (const [, data] of Object.entries(json.data ?? {})) {
    const d = data as AngelOneQuoteData;
    const cleanSymbol = fromAngelSymbol(d.tradingSymbol);
    result[cleanSymbol] = d;
    result[d.tradingSymbol] = d;
  }

  return result;
}

export async function getAngelOneMarketSummary(batchNumber?: number): Promise<{
  source: string;
  status: string;
  marketStatus: string;
  marketState: string;
  isMarketOpen: boolean;
  isOpen: boolean;
  batch: number | null;
  totalBatches: number;
  batchSize: number;
  error?: string;
  indices: Array<{
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
  }>;
  topGainers: Array<{
    symbol: string;
    name: string;
    price: number;
    change: number;
    changePercent: number;
    volume: number;
    exchange: string;
  }>;
  topLosers: Array<{
    symbol: string;
    name: string;
    price: number;
    change: number;
    changePercent: number;
    volume: number;
    exchange: string;
  }>;
  advanceDeclineRatio: number;
  totalTradedVolume: number;
  updatedAt: string;
}> {
  // Return a clean closed-market response instead of crashing
  const closedResponse = (reason: string) => ({
    source: "angelone",
    status: "CLOSED",
    marketStatus: "CLOSED",
    marketState: "CLOSED",
    isMarketOpen: false,
    isOpen: false,
    batch: batchNumber ?? null,
    totalBatches: TOTAL_BATCHES,
    batchSize: BATCH_SIZE,
    error: reason,
    indices: [],
    topGainers: [],
    topLosers: [],
    advanceDeclineRatio: 1,
    totalTradedVolume: 0,
    updatedAt: new Date().toISOString()
  });

  let quotes: Record<string, AngelOneQuoteData>;
  try {
    quotes = await getQuotes(batchNumber);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Angel One returns errors like "Market is closed" or session errors outside hours
    console.warn("[angelone] getQuotes failed:", msg);
    return closedResponse(msg);
  }

  const indices = NSE_INDICES.map((index) => {
    const q = quotes[index.angelSymbol];
    const price = q?.ltp ?? 0;
    const prevClose = q?.close ?? price;
    const change = price - prevClose;
    return {
      name: index.angelSymbol,
      value: price,
      change: Math.round(change * 100) / 100,
      changePercent: prevClose ? Math.round((change / prevClose) * 10000) / 100 : 0,
      high: q?.high ?? price,
      low: q?.low ?? price,
      open: q?.open ?? prevClose,
      prevClose,
      volume: q?.volume ?? 0,
      timestamp: new Date().toISOString()
    };
  });

  const stockSymbols = getStockSymbols(batchNumber);
  const movers = stockSymbols
    .filter((s) => quotes[s])
    .map((s) => {
      const q = quotes[s];
      return {
        symbol: s,
        name: s,
        price: q.ltp,
        change: q.dayChange,
        changePercent: q.dayChangePercentage,
        volume: q.volume,
        exchange: "NSE"
      };
    });

  const sortedByChange = [...movers].sort((a, b) => b.changePercent - a.changePercent);
  const topGainers = sortedByChange.slice(0, 5);
  const topLosers = sortedByChange.slice(-5).reverse();

  const totalVolume = movers.reduce((sum, m) => sum + m.volume, 0);
  const advancers = movers.filter((m) => m.changePercent > 0).length;
  const decliners = movers.filter((m) => m.changePercent < 0).length;

  return {
    source: "angelone",
    status: "OPEN",
    marketStatus: "OPEN",
    marketState: "OPEN",
    isMarketOpen: true,
    isOpen: true,
    batch: batchNumber ?? null,
    totalBatches: TOTAL_BATCHES,
    batchSize: BATCH_SIZE,
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
}
