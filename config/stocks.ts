export interface StockInfo {
  symbol: string;
  yahooTicker: string;
  angelSymbol: string;
  name: string;
  sector: string;
}

// ─── Watchlist: liquid NSE stocks in the ₹40–₹150 band ───────────────────────
//
// Replaces the old 150-stock large-cap universe (which had only 9 names under
// ₹100 and never matched this account's trading style).
//
// Built by screening a pool of NSE tickers against live Yahoo quotes on
// 2026-08-16 and keeping names with:
//   - price in the ₹40–₹150 band
//   - day volume ≥ ~50k shares (real liquidity)
// Prices drift — the scan itself enforces BUY_SCAN_MIN_PRICE/MAX_PRICE, so a
// stock that crosses out of the band is simply skipped that day (see
// buildBuyCandidates in api/index.ts). To rebuild the list from live data,
// re-run the same screening approach and update this file.

const RAW_STOCKS: { symbol: string; name: string; sector: string }[] = [
  // Banking & Financial Services
  { symbol: "PNB", name: "Punjab National Bank", sector: "Banking & Financial Services" },
  { symbol: "CANBK", name: "Canara Bank", sector: "Banking & Financial Services" },
  { symbol: "BANKINDIA", name: "Bank of India", sector: "Banking & Financial Services" },
  {
    symbol: "MAHABANK",
    name: "Bank of Maharashtra",
    sector: "Banking & Financial Services"
  },
  {
    symbol: "IDFCFIRSTB",
    name: "IDFC First Bank",
    sector: "Banking & Financial Services"
  },
  { symbol: "IDBI", name: "IDBI Bank", sector: "Banking & Financial Services" },
  { symbol: "JMFINANCIL", name: "JM Financial", sector: "Banking & Financial Services" },

  // Power & Utilities
  { symbol: "NHPC", name: "NHPC", sector: "Power & Utilities" },
  { symbol: "SJVN", name: "SJVN", sector: "Power & Utilities" },
  { symbol: "IEX", name: "Indian Energy Exchange", sector: "Power & Utilities" },

  // Oil, Gas & Energy
  { symbol: "IOC", name: "Indian Oil Corporation", sector: "Oil, Gas & Energy" },

  // Metals & Mining
  { symbol: "NMDC", name: "NMDC", sector: "Metals & Mining" },
  { symbol: "MMTC", name: "MMTC", sector: "Metals & Mining" },

  // Infrastructure, Engineering & Capital Goods
  {
    symbol: "NBCC",
    name: "NBCC (India)",
    sector: "Infrastructure, Engineering & Capital Goods"
  },
  {
    symbol: "IRCON",
    name: "IRCON International",
    sector: "Infrastructure, Engineering & Capital Goods"
  },
  { symbol: "NCC", name: "NCC", sector: "Infrastructure, Engineering & Capital Goods" },

  // Railways, Logistics & Transport
  {
    symbol: "IRFC",
    name: "Indian Railway Finance Corp",
    sector: "Railways, Logistics & Transport"
  },

  // Automobiles
  { symbol: "JAMNAAUTO", name: "Jamna Auto Industries", sector: "Automobiles" },

  // Pharma & Healthcare
  { symbol: "MOREPENLAB", name: "Morepen Laboratories", sector: "Pharma & Healthcare" },
  { symbol: "ALEMBICLTD", name: "Alembic", sector: "Pharma & Healthcare" },

  // Cement & Building Materials
  { symbol: "ORIENTCEM", name: "Orient Cement", sector: "Cement & Building Materials" },

  // Chemicals & Fertilizers
  {
    symbol: "CAMLINFINE",
    name: "Camlin Fine Sciences",
    sector: "Chemicals & Fertilizers"
  },
  {
    symbol: "RCF",
    name: "Rashtriya Chemicals & Fertilizers",
    sector: "Chemicals & Fertilizers"
  },
  { symbol: "NFL", name: "National Fertilizers", sector: "Chemicals & Fertilizers" },

  // Media & Broadcasting
  { symbol: "GTPL", name: "GTPL Hathway", sector: "Media & Broadcasting" },
  {
    symbol: "ZEEL",
    name: "Zee Entertainment Enterprises",
    sector: "Media & Broadcasting"
  },
  { symbol: "INOXWIND", name: "Inox Wind", sector: "Power & Utilities" },
  {
    symbol: "UJJIVANSFB",
    name: "Ujjivan Small Finance Bank",
    sector: "Banking & Financial Services"
  },
  {
    symbol: "EQUITASBNK",
    name: "Equitas Small Finance Bank",
    sector: "Banking & Financial Services"
  },
  {
    symbol: "SOUTHBANK",
    name: "The South Indian Bank",
    sector: "Banking & Financial Services"
  },
  {
    symbol: "SANGHIIND",
    name: "Sanghi Industries",
    sector: "Cement & Building Materials"
  },

  // Real Estate
  { symbol: "SHRIRAMPPS", name: "Shriram Properties", sector: "Real Estate" }
];

export const ALL_STOCKS: StockInfo[] = RAW_STOCKS.map((s) => ({
  ...s,
  yahooTicker: `${s.symbol}.NS`,
  angelSymbol: `${s.symbol}-EQ`
}));

// ─── Broad market movers (display only) ───────────────────────────────────────
//
// Used only by the market summary (/api/market/summary) so its gainers/losers
// and volume stats reflect the broad NSE market — NOT the ₹40–₹150 watchlist
// above, which is exclusively for the buy/sell scans.

export const MARKET_MOVERS_TICKERS: string[] = [
  "RELIANCE.NS",
  "TCS.NS",
  "HDFCBANK.NS",
  "ICICIBANK.NS",
  "SBIN.NS",
  "INFY.NS",
  "BHARTIARTL.NS",
  "LT.NS",
  "ITC.NS",
  "HINDUNILVR.NS",
  "AXISBANK.NS",
  "KOTAKBANK.NS",
  "BAJFINANCE.NS",
  "BAJAJFINSV.NS",
  "MARUTI.NS",
  "TATAMOTORS.NS",
  "M&M.NS",
  "SUNPHARMA.NS",
  "CIPLA.NS",
  "DRREDDY.NS",
  "DIVISLAB.NS",
  "LUPIN.NS",
  "ZYDUSLIFE.NS",
  "TATASTEEL.NS",
  "JSWSTEEL.NS",
  "HINDALCO.NS",
  "JINDALSTEL.NS",
  "VEDL.NS",
  "NTPC.NS",
  "POWERGRID.NS",
  "TATAPOWER.NS",
  "ADANIPOWER.NS",
  "JSWENERGY.NS",
  "ONGC.NS",
  "OIL.NS",
  "GAIL.NS",
  "BPCL.NS",
  "HINDPETRO.NS",
  "IOC.NS",
  "COALINDIA.NS",
  "HCLTECH.NS",
  "WIPRO.NS",
  "TECHM.NS",
  "LTIM.NS",
  "PERSISTENT.NS",
  "MPHASIS.NS",
  "ULTRACEMCO.NS",
  "AMBUJACEM.NS",
  "ACC.NS",
  "SHREECEM.NS",
  "HAL.NS",
  "BEL.NS",
  "BDL.NS",
  "MAZDOCK.NS",
  "GRSE.NS",
  "TRENT.NS",
  "DMART.NS",
  "ZOMATO.NS",
  "NAUKRI.NS",
  "VBL.NS",
  "LICI.NS",
  "SBILIFE.NS",
  "HDFCLIFE.NS",
  "ICICIPRULI.NS",
  "ICICIGI.NS",
  "RECLTD.NS",
  "PFC.NS",
  "IRFC.NS",
  "LICHSGFIN.NS",
  "CHOLAFIN.NS",
  "INDIGO.NS",
  "ADANIENT.NS",
  "ADANIPORTS.NS",
  "SIEMENS.NS",
  "ABB.NS",
  "BHEL.NS",
  "DLF.NS",
  "OBEROIRLTY.NS",
  "PRESTIGE.NS",
  "MUTHOOTFIN.NS",
  "SHRIRAMFIN.NS",
  "BAJAJ-AUTO.NS",
  "HEROMOTOCO.NS",
  "EICHERMOT.NS",
  "TVSMOTOR.NS",
  "ASHOKLEY.NS",
  "EXIDEIND.NS",
  "AMARAJABAT.NS",
  "APOLLOTYRE.NS",
  "CEAT.NS",
  "DABUR.NS",
  "MARICO.NS",
  "GODREJCP.NS",
  "COLPAL.NS",
  "BRITANNIA.NS",
  "NESTLEIND.NS",
  "TATACONSUM.NS",
  "EMAMILTD.NS",
  "SRF.NS",
  "AARTIIND.NS",
  "PIIND.NS",
  "COROMANDEL.NS",
  "CHAMBALFERT.NS",
  "GNFC.NS",
  "LALPATHLAB.NS",
  "METROPOLIS.NS",
  "MAXHEALTH.NS",
  "APOLLOHOSP.NS",
  "FORTIS.NS"
];

export const TOTAL_STOCKS = ALL_STOCKS.length;
export const BATCH_SIZE = 30;
export const TOTAL_BATCHES = Math.ceil(TOTAL_STOCKS / BATCH_SIZE);

export function getBatch(batchNumber: number): StockInfo[] {
  const index = Math.max(0, Math.min(batchNumber - 1, TOTAL_BATCHES - 1));
  const start = index * BATCH_SIZE;
  return ALL_STOCKS.slice(start, start + BATCH_SIZE);
}

export function getStockSymbols(batchNumber?: number): string[] {
  const stocks = batchNumber ? getBatch(batchNumber) : ALL_STOCKS;
  return stocks.map((s) => s.symbol);
}

export function getYahooTickers(batchNumber?: number): string[] {
  const stocks = batchNumber ? getBatch(batchNumber) : ALL_STOCKS;
  return stocks.map((s) => s.yahooTicker);
}

export function getAngelSymbols(batchNumber?: number): string[] {
  const stocks = batchNumber ? getBatch(batchNumber) : ALL_STOCKS;
  return stocks.map((s) => s.angelSymbol);
}
