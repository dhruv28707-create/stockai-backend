/**
 * Curated watchlist of liquid Indian stocks.
 * Sources: Nifty 50, Nifty Next 50, and select liquid midcaps.
 *
 * NSE symbols use the ".NS" suffix (yahoo-finance2).
 * BSE symbols use the ".BO" suffix (yahoo-finance2).
 *
 * Both exchanges are listed where available so the scanner
 * can fall back to BSE if NSE data is stale.
 *
 * Total: ~150 symbols across both exchanges.
 */

export interface WatchlistEntry {
  symbol: string;       // yahoo-finance2 ticker (e.g. "RELIANCE.NS")
  name: string;         // human-readable name
  exchange: "NSE" | "BSE";
  sector: string;
}

// ─── Nifty 50 ─────────────────────────────────────────────────────────────────

const NIFTY_50: WatchlistEntry[] = [
  { symbol: "RELIANCE.NS",    name: "Reliance Industries",       exchange: "NSE", sector: "Energy" },
  { symbol: "TCS.NS",         name: "Tata Consultancy Services", exchange: "NSE", sector: "IT" },
  { symbol: "HDFCBANK.NS",    name: "HDFC Bank",                 exchange: "NSE", sector: "Banking" },
  { symbol: "INFY.NS",        name: "Infosys",                   exchange: "NSE", sector: "IT" },
  { symbol: "ICICIBANK.NS",   name: "ICICI Bank",                exchange: "NSE", sector: "Banking" },
  { symbol: "HINDUNILVR.NS",  name: "Hindustan Unilever",        exchange: "NSE", sector: "FMCG" },
  { symbol: "ITC.NS",         name: "ITC",                       exchange: "NSE", sector: "FMCG" },
  { symbol: "SBIN.NS",        name: "State Bank of India",       exchange: "NSE", sector: "Banking" },
  { symbol: "BHARTIARTL.NS",  name: "Bharti Airtel",             exchange: "NSE", sector: "Telecom" },
  { symbol: "KOTAKBANK.NS",   name: "Kotak Mahindra Bank",       exchange: "NSE", sector: "Banking" },
  { symbol: "LT.NS",          name: "Larsen & Toubro",           exchange: "NSE", sector: "Infrastructure" },
  { symbol: "HCLTECH.NS",     name: "HCL Technologies",          exchange: "NSE", sector: "IT" },
  { symbol: "AXISBANK.NS",    name: "Axis Bank",                 exchange: "NSE", sector: "Banking" },
  { symbol: "ASIANPAINT.NS",  name: "Asian Paints",              exchange: "NSE", sector: "Paints" },
  { symbol: "MARUTI.NS",      name: "Maruti Suzuki",             exchange: "NSE", sector: "Auto" },
  { symbol: "SUNPHARMA.NS",   name: "Sun Pharmaceutical",        exchange: "NSE", sector: "Pharma" },
  { symbol: "TITAN.NS",       name: "Titan Company",             exchange: "NSE", sector: "Consumer" },
  { symbol: "ULTRACEMCO.NS",  name: "UltraTech Cement",          exchange: "NSE", sector: "Cement" },
  { symbol: "BAJFINANCE.NS",  name: "Bajaj Finance",             exchange: "NSE", sector: "NBFC" },
  { symbol: "WIPRO.NS",       name: "Wipro",                     exchange: "NSE", sector: "IT" },
  { symbol: "NESTLEIND.NS",   name: "Nestle India",              exchange: "NSE", sector: "FMCG" },
  { symbol: "POWERGRID.NS",   name: "Power Grid Corp",           exchange: "NSE", sector: "Utilities" },
  { symbol: "NTPC.NS",        name: "NTPC",                      exchange: "NSE", sector: "Utilities" },
  { symbol: "TECHM.NS",       name: "Tech Mahindra",             exchange: "NSE", sector: "IT" },
  { symbol: "ONGC.NS",        name: "ONGC",                      exchange: "NSE", sector: "Energy" },
  { symbol: "TATAMOTORS.NS",  name: "Tata Motors",               exchange: "NSE", sector: "Auto" },
  { symbol: "TATASTEEL.NS",   name: "Tata Steel",                exchange: "NSE", sector: "Metals" },
  { symbol: "JSWSTEEL.NS",    name: "JSW Steel",                 exchange: "NSE", sector: "Metals" },
  { symbol: "ADANIENT.NS",    name: "Adani Enterprises",         exchange: "NSE", sector: "Conglomerate" },
  { symbol: "ADANIPORTS.NS",  name: "Adani Ports",               exchange: "NSE", sector: "Infrastructure" },
  { symbol: "GRASIM.NS",      name: "Grasim Industries",         exchange: "NSE", sector: "Diversified" },
  { symbol: "BAJAJFINSV.NS",  name: "Bajaj Finserv",             exchange: "NSE", sector: "NBFC" },
  { symbol: "CIPLA.NS",       name: "Cipla",                     exchange: "NSE", sector: "Pharma" },
  { symbol: "DRREDDY.NS",     name: "Dr Reddy's Labs",           exchange: "NSE", sector: "Pharma" },
  { symbol: "EICHERMOT.NS",   name: "Eicher Motors",             exchange: "NSE", sector: "Auto" },
  { symbol: "HEROMOTOCO.NS",  name: "Hero MotoCorp",             exchange: "NSE", sector: "Auto" },
  { symbol: "HINDALCO.NS",    name: "Hindalco Industries",       exchange: "NSE", sector: "Metals" },
  { symbol: "INDUSINDBK.NS",  name: "IndusInd Bank",             exchange: "NSE", sector: "Banking" },
  { symbol: "M&M.NS",         name: "Mahindra & Mahindra",       exchange: "NSE", sector: "Auto" },
  { symbol: "SBILIFE.NS",     name: "SBI Life Insurance",        exchange: "NSE", sector: "Insurance" },
  { symbol: "HDFCLIFE.NS",    name: "HDFC Life Insurance",       exchange: "NSE", sector: "Insurance" },
  { symbol: "APOLLOHOSP.NS",  name: "Apollo Hospitals",          exchange: "NSE", sector: "Healthcare" },
  { symbol: "TATACONSUM.NS",  name: "Tata Consumer Products",    exchange: "NSE", sector: "FMCG" },
  { symbol: "COALINDIA.NS",   name: "Coal India",                exchange: "NSE", sector: "Mining" },
  { symbol: "BPCL.NS",        name: "BPCL",                      exchange: "NSE", sector: "Energy" },
  { symbol: "DIVISLAB.NS",    name: "Divi's Laboratories",       exchange: "NSE", sector: "Pharma" },
  { symbol: "BRITANNIA.NS",   name: "Britannia Industries",      exchange: "NSE", sector: "FMCG" },
  { symbol: "SHRIRAMFIN.NS",  name: "Shriram Finance",           exchange: "NSE", sector: "NBFC" },
  { symbol: "BEL.NS",         name: "Bharat Electronics",        exchange: "NSE", sector: "Defence" },
  { symbol: "TRENT.NS",       name: "Trent",                     exchange: "NSE", sector: "Retail" }
];

// ─── Nifty Next 50 ────────────────────────────────────────────────────────────

const NIFTY_NEXT_50: WatchlistEntry[] = [
  { symbol: "ABB.NS",          name: "ABB India",                exchange: "NSE", sector: "Engineering" },
  { symbol: "AMBUJACEM.NS",    name: "Ambuja Cements",           exchange: "NSE", sector: "Cement" },
  { symbol: "BAJAJ-AUTO.NS",   name: "Bajaj Auto",               exchange: "NSE", sector: "Auto" },
  { symbol: "BANKBARODA.NS",   name: "Bank of Baroda",           exchange: "NSE", sector: "Banking" },
  { symbol: "BERGEPAINT.NS",   name: "Berger Paints",            exchange: "NSE", sector: "Paints" },
  { symbol: "BOSCHLTD.NS",     name: "Bosch",                    exchange: "NSE", sector: "Auto Ancillary" },
  { symbol: "CHOLAFIN.NS",     name: "Cholamandalam Finance",    exchange: "NSE", sector: "NBFC" },
  { symbol: "COLPAL.NS",       name: "Colgate-Palmolive",        exchange: "NSE", sector: "FMCG" },
  { symbol: "DABUR.NS",        name: "Dabur India",              exchange: "NSE", sector: "FMCG" },
  { symbol: "DLF.NS",          name: "DLF",                      exchange: "NSE", sector: "Real Estate" },
  { symbol: "FEDERALBNK.NS",   name: "Federal Bank",             exchange: "NSE", sector: "Banking" },
  { symbol: "GAIL.NS",         name: "GAIL India",               exchange: "NSE", sector: "Energy" },
  { symbol: "GODREJCP.NS",     name: "Godrej Consumer Products", exchange: "NSE", sector: "FMCG" },
  { symbol: "HAVELLS.NS",      name: "Havells India",            exchange: "NSE", sector: "Electricals" },
  { symbol: "ICICIPRULI.NS",   name: "ICICI Prudential Life",    exchange: "NSE", sector: "Insurance" },
  { symbol: "INDUSTOWER.NS",   name: "Indus Towers",             exchange: "NSE", sector: "Telecom" },
  { symbol: "IRCTC.NS",        name: "IRCTC",                    exchange: "NSE", sector: "Travel" },
  { symbol: "JIOFIN.NS",       name: "Jio Financial Services",   exchange: "NSE", sector: "NBFC" },
  { symbol: "JUBLFOOD.NS",     name: "Jubilant FoodWorks",       exchange: "NSE", sector: "QSR" },
  { symbol: "LICI.NS",         name: "LIC India",                exchange: "NSE", sector: "Insurance" },
  { symbol: "LODHA.NS",        name: "Macrotech Developers",     exchange: "NSE", sector: "Real Estate" },
  { symbol: "LUPIN.NS",        name: "Lupin",                    exchange: "NSE", sector: "Pharma" },
  { symbol: "MCDOWELL-N.NS",   name: "United Spirits",           exchange: "NSE", sector: "Beverages" },
  { symbol: "MUTHOOTFIN.NS",   name: "Muthoot Finance",          exchange: "NSE", sector: "NBFC" },
  { symbol: "NAUKRI.NS",       name: "Info Edge (Naukri)",       exchange: "NSE", sector: "Internet" },
  { symbol: "NMDC.NS",         name: "NMDC",                     exchange: "NSE", sector: "Mining" },
  { symbol: "OBEROIRLTY.NS",   name: "Oberoi Realty",            exchange: "NSE", sector: "Real Estate" },
  { symbol: "OFSS.NS",         name: "Oracle Financial Services",exchange: "NSE", sector: "IT" },
  { symbol: "PAGEIND.NS",      name: "Page Industries",          exchange: "NSE", sector: "Apparel" },
  { symbol: "PIDILITIND.NS",   name: "Pidilite Industries",      exchange: "NSE", sector: "Chemicals" },
  { symbol: "PNB.NS",          name: "Punjab National Bank",     exchange: "NSE", sector: "Banking" },
  { symbol: "RECLTD.NS",       name: "REC",                      exchange: "NSE", sector: "Finance" },
  { symbol: "SAIL.NS",         name: "SAIL",                     exchange: "NSE", sector: "Metals" },
  { symbol: "SIEMENS.NS",      name: "Siemens India",            exchange: "NSE", sector: "Engineering" },
  { symbol: "SRF.NS",          name: "SRF",                      exchange: "NSE", sector: "Chemicals" },
  { symbol: "TORNTPHARM.NS",   name: "Torrent Pharmaceuticals",  exchange: "NSE", sector: "Pharma" },
  { symbol: "TVSMOTOR.NS",     name: "TVS Motor",                exchange: "NSE", sector: "Auto" },
  { symbol: "UNIONBANK.NS",    name: "Union Bank of India",      exchange: "NSE", sector: "Banking" },
  { symbol: "VBL.NS",          name: "Varun Beverages",          exchange: "NSE", sector: "Beverages" },
  { symbol: "VEDL.NS",         name: "Vedanta",                  exchange: "NSE", sector: "Metals" },
  { symbol: "WHIRLPOOL.NS",    name: "Whirlpool India",          exchange: "NSE", sector: "Consumer Durables" },
  { symbol: "ZOMATO.NS",       name: "Zomato",                   exchange: "NSE", sector: "Internet" },
  { symbol: "ZYDUSLIFE.NS",    name: "Zydus Lifesciences",       exchange: "NSE", sector: "Pharma" }
];

// ─── Liquid Midcaps ───────────────────────────────────────────────────────────

const LIQUID_MIDCAPS: WatchlistEntry[] = [
  { symbol: "ABCAPITAL.NS",    name: "Aditya Birla Capital",     exchange: "NSE", sector: "NBFC" },
  { symbol: "ALKEM.NS",        name: "Alkem Laboratories",       exchange: "NSE", sector: "Pharma" },
  { symbol: "APLLTD.NS",       name: "Alembic Pharma",           exchange: "NSE", sector: "Pharma" },
  { symbol: "ASTRAL.NS",       name: "Astral",                   exchange: "NSE", sector: "Pipes" },
  { symbol: "AUROPHARMA.NS",   name: "Aurobindo Pharma",         exchange: "NSE", sector: "Pharma" },
  { symbol: "BALKRISIND.NS",   name: "Balkrishna Industries",    exchange: "NSE", sector: "Tyres" },
  { symbol: "BANDHANBNK.NS",   name: "Bandhan Bank",             exchange: "NSE", sector: "Banking" },
  { symbol: "CANBK.NS",        name: "Canara Bank",              exchange: "NSE", sector: "Banking" },
  { symbol: "CONCOR.NS",       name: "Container Corp",           exchange: "NSE", sector: "Logistics" },
  { symbol: "CROMPTON.NS",     name: "Crompton Greaves Consumer",exchange: "NSE", sector: "Consumer Durables" },
  { symbol: "CUMMINSIND.NS",   name: "Cummins India",            exchange: "NSE", sector: "Engineering" },
  { symbol: "DEEPAKNTR.NS",    name: "Deepak Nitrite",           exchange: "NSE", sector: "Chemicals" },
  { symbol: "DIXON.NS",        name: "Dixon Technologies",       exchange: "NSE", sector: "Electronics" },
  { symbol: "ESCORTS.NS",      name: "Escorts Kubota",           exchange: "NSE", sector: "Agri" },
  { symbol: "FLUOROCHEM.NS",   name: "Gujarat Fluorochemicals",  exchange: "NSE", sector: "Chemicals" },
  { symbol: "FORTIS.NS",       name: "Fortis Healthcare",        exchange: "NSE", sector: "Healthcare" },
  { symbol: "GLENMARK.NS",     name: "Glenmark Pharma",          exchange: "NSE", sector: "Pharma" },
  { symbol: "GNFC.NS",         name: "GNFC",                     exchange: "NSE", sector: "Chemicals" },
  { symbol: "GODREJPROP.NS",   name: "Godrej Properties",        exchange: "NSE", sector: "Real Estate" },
  { symbol: "IDFCFIRSTB.NS",   name: "IDFC First Bank",          exchange: "NSE", sector: "Banking" },
  { symbol: "INDHOTEL.NS",     name: "Indian Hotels (Taj)",      exchange: "NSE", sector: "Hotels" },
  { symbol: "IPCA.NS",         name: "IPCA Laboratories",        exchange: "NSE", sector: "Pharma" },
  { symbol: "KANSAINER.NS",    name: "Kansai Nerolac",           exchange: "NSE", sector: "Paints" },
  { symbol: "LICHSGFIN.NS",    name: "LIC Housing Finance",      exchange: "NSE", sector: "NBFC" },
  { symbol: "LTIM.NS",         name: "LTIMindtree",              exchange: "NSE", sector: "IT" },
  { symbol: "LTTS.NS",         name: "L&T Technology Services",  exchange: "NSE", sector: "IT" },
  { symbol: "MANAPPURAM.NS",   name: "Manappuram Finance",       exchange: "NSE", sector: "NBFC" },
  { symbol: "MARICO.NS",       name: "Marico",                   exchange: "NSE", sector: "FMCG" },
  { symbol: "MAXHEALTH.NS",    name: "Max Healthcare",           exchange: "NSE", sector: "Healthcare" },
  { symbol: "METROPOLIS.NS",   name: "Metropolis Healthcare",    exchange: "NSE", sector: "Healthcare" },
  { symbol: "MGL.NS",          name: "Mahanagar Gas",            exchange: "NSE", sector: "Utilities" },
  { symbol: "MOTHERSON.NS",    name: "Samvardhana Motherson",    exchange: "NSE", sector: "Auto Ancillary" },
  { symbol: "MPHASIS.NS",      name: "Mphasis",                  exchange: "NSE", sector: "IT" },
  { symbol: "NATCOPHARM.NS",   name: "Natco Pharma",             exchange: "NSE", sector: "Pharma" },
  { symbol: "NIACL.NS",        name: "New India Assurance",      exchange: "NSE", sector: "Insurance" },
  { symbol: "PERSISTENT.NS",   name: "Persistent Systems",       exchange: "NSE", sector: "IT" },
  { symbol: "POLYCAB.NS",      name: "Polycab India",            exchange: "NSE", sector: "Cables" },
  { symbol: "PRESTIGE.NS",     name: "Prestige Estates",         exchange: "NSE", sector: "Real Estate" },
  { symbol: "PVRINOX.NS",      name: "PVR INOX",                 exchange: "NSE", sector: "Entertainment" },
  { symbol: "RAMCOCEM.NS",     name: "Ramco Cements",            exchange: "NSE", sector: "Cement" },
  { symbol: "SOLARINDS.NS",    name: "Solar Industries",         exchange: "NSE", sector: "Defence" },
  { symbol: "SONACOMS.NS",     name: "Sona BLW Precision",       exchange: "NSE", sector: "Auto Ancillary" },
  { symbol: "STARHEALTH.NS",   name: "Star Health Insurance",    exchange: "NSE", sector: "Insurance" },
  { symbol: "SUPREMEIND.NS",   name: "Supreme Industries",       exchange: "NSE", sector: "Plastics" },
  { symbol: "SYNGENE.NS",      name: "Syngene International",    exchange: "NSE", sector: "Pharma" },
  { symbol: "TORNTPOWER.NS",   name: "Torrent Power",            exchange: "NSE", sector: "Utilities" },
  { symbol: "TATAPOWER.NS",    name: "Tata Power",               exchange: "NSE", sector: "Utilities" },
  { symbol: "TATACOMM.NS",     name: "Tata Communications",      exchange: "NSE", sector: "Telecom" },
  { symbol: "TATACHEM.NS",     name: "Tata Chemicals",           exchange: "NSE", sector: "Chemicals" },
  { symbol: "TRIDENT.NS",      name: "Trident",                  exchange: "NSE", sector: "Textiles" },
  { symbol: "UBL.NS",          name: "United Breweries",         exchange: "NSE", sector: "Beverages" },
  { symbol: "VOLTAS.NS",       name: "Voltas",                   exchange: "NSE", sector: "Consumer Durables" },
  { symbol: "YESBANK.NS",      name: "Yes Bank",                 exchange: "NSE", sector: "Banking" }
];

// ─── Full Watchlist ───────────────────────────────────────────────────────────

export const WATCHLIST: WatchlistEntry[] = [
  ...NIFTY_50,
  ...NIFTY_NEXT_50,
  ...LIQUID_MIDCAPS
];

export const WATCHLIST_SYMBOLS: string[] = WATCHLIST.map((e) => e.symbol);

/** Batch size: how many stocks to scan per cron invocation */
export const SCAN_BATCH_SIZE = 30;

/** Total number of batches needed to cover the full watchlist */
export const TOTAL_BATCHES = Math.ceil(WATCHLIST_SYMBOLS.length / SCAN_BATCH_SIZE);

/**
 * Returns the slice of symbols for a given batch index (0-based).
 * Rotates automatically once all batches are exhausted.
 */
export const getBatch = (batchIndex: number): WatchlistEntry[] => {
  const normalised = batchIndex % TOTAL_BATCHES;
  const start = normalised * SCAN_BATCH_SIZE;
  return WATCHLIST.slice(start, start + SCAN_BATCH_SIZE);
};

/** Look up a watchlist entry by ticker symbol */
export const findBySymbol = (symbol: string): WatchlistEntry | undefined =>
  WATCHLIST.find((e) => e.symbol === symbol);
