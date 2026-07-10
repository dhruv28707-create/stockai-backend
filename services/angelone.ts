import { createHmac } from "node:crypto";
import { env } from "../config/env";
import { getAngelSymbols, getStockSymbols, BATCH_SIZE, TOTAL_BATCHES } from "../config/stocks";

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
  return !!(env.ANGEL_ONE_API_KEY && env.ANGEL_ONE_CLIENT_ID && env.ANGEL_ONE_MPIN && env.ANGEL_ONE_TOTP_SECRET);
}

function buildHeaders(apiKey: string, authToken?: string): Record<string, string> {
  return {
    "X-PrivateKey": apiKey,
    "X-SourceID": "WEB",
    "X-ClientLocalIP": "127.0.0.1",
    "X-ClientPublicIP": "127.0.0.1",
    "X-MACAddress": "00:00:00:00:00:00",
    "Content-Type": "application/json",
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

  if (!response.ok) {
    throw new Error(`Angel One login failed (${response.status}): ${response.statusText}`);
  }

  const json = (await response.json()) as LoginResponse;

  if (json.status !== true && json.errorCode) {
    throw new Error(`Angel One login error: ${json.message ?? json.error ?? "unknown"}`);
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

interface AngelOneQuoteData {
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
  data: Record<string, AngelOneQuoteData>;
}

function fromAngelSymbol(angelSymbol: string): string {
  return angelSymbol.replace("-EQ", "");
}

export async function getQuotes(batchNumber?: number): Promise<Record<string, AngelOneQuoteData>> {
  const tokens = await login();
  const symbols = [...NSE_INDICES.map((i) => i.angelSymbol), ...getAngelSymbols(batchNumber)];

  const response = await fetch(`${BASE_URL}/rest/secure/angelbroking/market/v1/quote`, {
    method: "POST",
    headers: buildHeaders(env.ANGEL_ONE_API_KEY!, tokens.authToken),
    body: JSON.stringify({
      mode: "FULL",
      exchangeTokens: {
        NSE: symbols.map((s) => s.toUpperCase())
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Angel One quote fetch failed (${response.status})`);
  }

  const json = (await response.json()) as AngelOneQuoteResponse;

  if (json.status !== true) {
    throw new Error("Angel One quote fetch returned error status");
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
  const quotes = await getQuotes(batchNumber);

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
    advanceDeclineRatio: decliners > 0
      ? Math.round((advancers / decliners) * 100) / 100
      : advancers > 0 ? 99 : 1,
    totalTradedVolume: totalVolume,
    updatedAt: new Date().toISOString()
  };
}
