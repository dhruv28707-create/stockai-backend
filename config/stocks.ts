export interface StockInfo {
  symbol: string;
  yahooTicker: string;
  angelSymbol: string;
  name: string;
  sector: string;
}

const RAW_STOCKS: { symbol: string; name: string; sector: string }[] = [
  { symbol: "HDFCBANK",    name: "HDFC Bank",               sector: "Banking & Financial Services" },
  { symbol: "ICICIBANK",   name: "ICICI Bank",              sector: "Banking & Financial Services" },
  { symbol: "SBIN",        name: "State Bank of India",     sector: "Banking & Financial Services" },
  { symbol: "AXISBANK",    name: "Axis Bank",               sector: "Banking & Financial Services" },
  { symbol: "KOTAKBANK",   name: "Kotak Mahindra Bank",     sector: "Banking & Financial Services" },
  { symbol: "INDUSINDBK",  name: "IndusInd Bank",           sector: "Banking & Financial Services" },
  { symbol: "BANKBARODA",  name: "Bank of Baroda",          sector: "Banking & Financial Services" },
  { symbol: "PNB",         name: "Punjab National Bank",    sector: "Banking & Financial Services" },
  { symbol: "CANBK",       name: "Canara Bank",             sector: "Banking & Financial Services" },
  { symbol: "UNIONBANK",   name: "Union Bank of India",     sector: "Banking & Financial Services" },
  { symbol: "INDIANB",     name: "Indian Bank",             sector: "Banking & Financial Services" },
  { symbol: "IDBI",        name: "IDBI Bank",               sector: "Banking & Financial Services" },
  { symbol: "AUBANK",      name: "AU Small Finance Bank",   sector: "Banking & Financial Services" },
  { symbol: "FEDERALBNK",  name: "Federal Bank",            sector: "Banking & Financial Services" },
  { symbol: "IDFCFIRSTB",  name: "IDFC First Bank",         sector: "Banking & Financial Services" },
  { symbol: "BANDHANBNK",  name: "Bandhan Bank",            sector: "Banking & Financial Services" },
  { symbol: "BAJFINANCE",  name: "Bajaj Finance",           sector: "Banking & Financial Services" },
  { symbol: "BAJAJFINSV",  name: "Bajaj Finserv",           sector: "Banking & Financial Services" },
  { symbol: "CHOLAFIN",    name: "Cholamandalam Investment", sector: "Banking & Financial Services" },
  { symbol: "LICHSGFIN",   name: "LIC Housing Finance",     sector: "Banking & Financial Services" },

  { symbol: "LICI",        name: "LIC",                     sector: "Insurance & Financial Institutions" },
  { symbol: "SBILIFE",     name: "SBI Life",                sector: "Insurance & Financial Institutions" },
  { symbol: "HDFCLIFE",    name: "HDFC Life",               sector: "Insurance & Financial Institutions" },
  { symbol: "ICICIPRULI",  name: "ICICI Prudential Life",   sector: "Insurance & Financial Institutions" },
  { symbol: "ICICIGI",     name: "ICICI Lombard",           sector: "Insurance & Financial Institutions" },
  { symbol: "GICRE",       name: "GIC RE",                  sector: "Insurance & Financial Institutions" },
  { symbol: "NIACL",       name: "New India Assurance",     sector: "Insurance & Financial Institutions" },
  { symbol: "RECLTD",      name: "REC Ltd",                 sector: "Insurance & Financial Institutions" },

  { symbol: "TCS",         name: "TCS",                     sector: "IT & Software" },
  { symbol: "INFY",        name: "Infosys",                 sector: "IT & Software" },
  { symbol: "HCLTECH",     name: "HCL Technologies",        sector: "IT & Software" },
  { symbol: "WIPRO",       name: "Wipro",                   sector: "IT & Software" },
  { symbol: "TECHM",       name: "Tech Mahindra",           sector: "IT & Software" },
  { symbol: "LTIM",        name: "LTIMindtree",             sector: "IT & Software" },
  { symbol: "PERSISTENT",  name: "Persistent Systems",      sector: "IT & Software" },
  { symbol: "MPHASIS",     name: "Mphasis",                 sector: "IT & Software" },
  { symbol: "COFORGE",     name: "Coforge",                 sector: "IT & Software" },
  { symbol: "OFSS",        name: "Oracle Financial Services", sector: "IT & Software" },
  { symbol: "TATAELXSI",   name: "Tata Elxsi",              sector: "IT & Software" },
  { symbol: "KPITTECH",    name: "KPIT Technologies",       sector: "IT & Software" },

  { symbol: "BHARTIARTL",  name: "Bharti Airtel",           sector: "Telecom" },
  { symbol: "IDEA",        name: "Vodafone Idea",           sector: "Telecom" },
  { symbol: "TATACOMM",    name: "Tata Communications",     sector: "Telecom" },
  { symbol: "INDUSTOWER",  name: "Indus Towers",            sector: "Telecom" },

  { symbol: "RELIANCE",    name: "Reliance Industries",     sector: "Oil, Gas & Energy" },
  { symbol: "ONGC",        name: "ONGC",                    sector: "Oil, Gas & Energy" },
  { symbol: "OIL",         name: "Oil India",               sector: "Oil, Gas & Energy" },
  { symbol: "GAIL",        name: "GAIL",                    sector: "Oil, Gas & Energy" },
  { symbol: "IOC",         name: "Indian Oil Corporation",  sector: "Oil, Gas & Energy" },
  { symbol: "BPCL",        name: "Bharat Petroleum",        sector: "Oil, Gas & Energy" },
  { symbol: "HINDPETRO",   name: "Hindustan Petroleum",     sector: "Oil, Gas & Energy" },
  { symbol: "PETRONET",    name: "Petronet LNG",            sector: "Oil, Gas & Energy" },
  { symbol: "GUJGASLTD",   name: "Gujarat Gas",             sector: "Oil, Gas & Energy" },
  { symbol: "MGL",         name: "Mahanagar Gas",           sector: "Oil, Gas & Energy" },
  { symbol: "ATGL",        name: "Adani Total Gas",         sector: "Oil, Gas & Energy" },
  { symbol: "IGL",         name: "IGL",                     sector: "Oil, Gas & Energy" },

  { symbol: "NTPC",        name: "NTPC",                    sector: "Power & Utilities" },
  { symbol: "POWERGRID",   name: "Power Grid",              sector: "Power & Utilities" },
  { symbol: "NHPC",        name: "NHPC",                    sector: "Power & Utilities" },
  { symbol: "SJVN",        name: "SJVN",                    sector: "Power & Utilities" },
  { symbol: "NLCINDIA",    name: "NLC India",               sector: "Power & Utilities" },
  { symbol: "TATAPOWER",   name: "Tata Power",              sector: "Power & Utilities" },
  { symbol: "ADANIPOWER",  name: "Adani Power",             sector: "Power & Utilities" },
  { symbol: "ADANIENSOL",  name: "Adani Energy Solutions",  sector: "Power & Utilities" },
  { symbol: "TORNTPOWER",  name: "Torrent Power",           sector: "Power & Utilities" },
  { symbol: "CESC",        name: "CESC",                    sector: "Power & Utilities" },
  { symbol: "JSWENERGY",   name: "JSW Energy",              sector: "Power & Utilities" },
  { symbol: "PFC",         name: "Power Finance Corporation", sector: "Power & Utilities" },

  { symbol: "HAL",         name: "HAL",                     sector: "Defence & Aerospace" },
  { symbol: "BEL",         name: "Bharat Electronics",      sector: "Defence & Aerospace" },
  { symbol: "BDL",         name: "Bharat Dynamics",         sector: "Defence & Aerospace" },
  { symbol: "COCHINSHIP",  name: "Cochin Shipyard",         sector: "Defence & Aerospace" },
  { symbol: "MAZDOCK",     name: "Mazagon Dock Shipbuilders", sector: "Defence & Aerospace" },
  { symbol: "GRSE",        name: "Garden Reach Shipbuilders", sector: "Defence & Aerospace" },
  { symbol: "DATAPATNS",   name: "Data Patterns",           sector: "Defence & Aerospace" },
  { symbol: "PARAS",       name: "Paras Defence",           sector: "Defence & Aerospace" },

  { symbol: "MARUTI",      name: "Maruti Suzuki",           sector: "Automobiles" },
  { symbol: "TATAMOTORS",  name: "Tata Motors",             sector: "Automobiles" },
  { symbol: "M&M",         name: "Mahindra & Mahindra",     sector: "Automobiles" },
  { symbol: "BAJAJ-AUTO",  name: "Bajaj Auto",              sector: "Automobiles" },
  { symbol: "HEROMOTOCO",  name: "Hero MotoCorp",           sector: "Automobiles" },
  { symbol: "TVSMOTOR",    name: "TVS Motor",               sector: "Automobiles" },
  { symbol: "EICHERMOT",   name: "Eicher Motors",           sector: "Automobiles" },
  { symbol: "ASHOKLEY",    name: "Ashok Leyland",           sector: "Automobiles" },
  { symbol: "BOSCHLTD",    name: "Bosch India",             sector: "Automobiles" },
  { symbol: "EXIDEIND",    name: "Exide Industries",        sector: "Automobiles" },
  { symbol: "AMARAJABAT",  name: "Amara Raja Energy & Mobility", sector: "Automobiles" },
  { symbol: "BHARATFORG",  name: "Bharat Forge",            sector: "Automobiles" },

  { symbol: "SUNPHARMA",   name: "Sun Pharma",              sector: "Pharma & Healthcare" },
  { symbol: "CIPLA",       name: "Cipla",                   sector: "Pharma & Healthcare" },
  { symbol: "DRREDDY",     name: "Dr. Reddy's Laboratories", sector: "Pharma & Healthcare" },
  { symbol: "DIVISLAB",    name: "Divi's Laboratories",     sector: "Pharma & Healthcare" },
  { symbol: "LUPIN",       name: "Lupin",                   sector: "Pharma & Healthcare" },
  { symbol: "AUROPHARMA",  name: "Aurobindo Pharma",        sector: "Pharma & Healthcare" },
  { symbol: "ALKEM",       name: "Alkem Laboratories",      sector: "Pharma & Healthcare" },
  { symbol: "ZYDUSLIFE",   name: "Zydus Lifesciences",      sector: "Pharma & Healthcare" },
  { symbol: "TORNTPHARM",  name: "Torrent Pharmaceuticals", sector: "Pharma & Healthcare" },
  { symbol: "ABBOTINDIA",  name: "Abbott India",            sector: "Pharma & Healthcare" },
  { symbol: "GLENMARK",    name: "Glenmark Pharmaceuticals", sector: "Pharma & Healthcare" },
  { symbol: "BIOCON",      name: "Biocon",                  sector: "Pharma & Healthcare" },

  { symbol: "HINDUNILVR",  name: "Hindustan Unilever",      sector: "FMCG & Consumer" },
  { symbol: "ITC",         name: "ITC",                     sector: "FMCG & Consumer" },
  { symbol: "NESTLEIND",   name: "Nestlé India",            sector: "FMCG & Consumer" },
  { symbol: "BRITANNIA",   name: "Britannia",               sector: "FMCG & Consumer" },
  { symbol: "DABUR",       name: "Dabur",                   sector: "FMCG & Consumer" },
  { symbol: "GODREJCP",    name: "Godrej Consumer Products", sector: "FMCG & Consumer" },
  { symbol: "COLPAL",      name: "Colgate-Palmolive India", sector: "FMCG & Consumer" },
  { symbol: "MARICO",      name: "Marico",                  sector: "FMCG & Consumer" },
  { symbol: "TATACONSUM",  name: "Tata Consumer Products",  sector: "FMCG & Consumer" },
  { symbol: "VBL",         name: "Varun Beverages",         sector: "FMCG & Consumer" },
  { symbol: "UNITDSPR",    name: "United Spirits",          sector: "FMCG & Consumer" },
  { symbol: "EMAMILTD",    name: "Emami",                   sector: "FMCG & Consumer" },

  { symbol: "ULTRACEMCO",  name: "UltraTech Cement",        sector: "Cement & Building Materials" },
  { symbol: "AMBUJACEM",   name: "Ambuja Cements",          sector: "Cement & Building Materials" },
  { symbol: "ACC",         name: "ACC",                     sector: "Cement & Building Materials" },
  { symbol: "SHREECEM",    name: "Shree Cement",            sector: "Cement & Building Materials" },
  { symbol: "DALBHARAT",   name: "Dalmia Bharat",           sector: "Cement & Building Materials" },
  { symbol: "JKCEMENT",    name: "JK Cement",               sector: "Cement & Building Materials" },
  { symbol: "RAMCOCEM",    name: "Ramco Cements",           sector: "Cement & Building Materials" },
  { symbol: "BIRLACORPN",  name: "Birla Corporation",       sector: "Cement & Building Materials" },

  { symbol: "TATASTEEL",   name: "Tata Steel",              sector: "Metals & Mining" },
  { symbol: "JSWSTEEL",    name: "JSW Steel",               sector: "Metals & Mining" },
  { symbol: "JINDALSTEL",  name: "Jindal Steel & Power",    sector: "Metals & Mining" },
  { symbol: "SAIL",        name: "SAIL",                    sector: "Metals & Mining" },
  { symbol: "HINDALCO",    name: "Hindalco",                sector: "Metals & Mining" },
  { symbol: "VEDL",        name: "Vedanta",                 sector: "Metals & Mining" },
  { symbol: "HINDZINC",    name: "Hindustan Zinc",          sector: "Metals & Mining" },
  { symbol: "NMDC",        name: "NMDC",                    sector: "Metals & Mining" },
  { symbol: "NATIONALUM",  name: "National Aluminium Company", sector: "Metals & Mining" },
  { symbol: "MOIL",        name: "MOIL",                    sector: "Metals & Mining" },

  { symbol: "LT",          name: "Larsen & Toubro",         sector: "Infrastructure, Engineering & Capital Goods" },
  { symbol: "SIEMENS",     name: "Siemens India",           sector: "Infrastructure, Engineering & Capital Goods" },
  { symbol: "ABB",         name: "ABB India",               sector: "Infrastructure, Engineering & Capital Goods" },
  { symbol: "CUMMINSIND",  name: "Cummins India",           sector: "Infrastructure, Engineering & Capital Goods" },
  { symbol: "BHEL",        name: "Bharat Heavy Electricals", sector: "Infrastructure, Engineering & Capital Goods" },
  { symbol: "THERMAX",     name: "Thermax",                 sector: "Infrastructure, Engineering & Capital Goods" },
  { symbol: "ENGINERSIN",  name: "Engineers India",         sector: "Infrastructure, Engineering & Capital Goods" },
  { symbol: "IRB",         name: "IRB Infrastructure",      sector: "Infrastructure, Engineering & Capital Goods" },
  { symbol: "RVNL",        name: "Rail Vikas Nigam",        sector: "Infrastructure, Engineering & Capital Goods" },
  { symbol: "IRCON",       name: "IRCON International",     sector: "Infrastructure, Engineering & Capital Goods" },

  { symbol: "CONCOR",      name: "Container Corporation of India", sector: "Railways, Logistics & Transport" },
  { symbol: "IRFC",        name: "Indian Railway Finance Corporation", sector: "Railways, Logistics & Transport" },
  { symbol: "RAILTEL",     name: "RailTel",                 sector: "Railways, Logistics & Transport" },
  { symbol: "SCI",         name: "Shipping Corporation of India", sector: "Railways, Logistics & Transport" },
  { symbol: "BLUEDART",    name: "Blue Dart Express",       sector: "Railways, Logistics & Transport" },
  { symbol: "ALLCARGO",    name: "Allcargo Logistics",      sector: "Railways, Logistics & Transport" },

  { symbol: "TRENT",       name: "Trent",                   sector: "Retail, Internet & Miscellaneous" },
  { symbol: "DMART",       name: "Avenue Supermarts",       sector: "Retail, Internet & Miscellaneous" },
  { symbol: "ZOMATO",      name: "Zomato",                  sector: "Retail, Internet & Miscellaneous" },
  { symbol: "NAUKRI",      name: "Info Edge",               sector: "Retail, Internet & Miscellaneous" },
];

export const ALL_STOCKS: StockInfo[] = RAW_STOCKS.map((s) => ({
  ...s,
  yahooTicker: `${s.symbol}.NS`,
  angelSymbol: `${s.symbol}-EQ`
}));

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
