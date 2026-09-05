import { config } from "dotenv";
import { z } from "zod";

// Load ".env" first, then ".env.local" (Vercel CLI convention) as an override,
// so `npm run dev` works whether secrets live in ".env" or were pulled from
// Vercel into ".env.local".
config();
config({ path: ".env.local", override: true });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  APP_ENV: z.string().default("local"),
  SINGLE_USER_ID: z.string().min(1).default("single-user"),
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().email(),
  FIREBASE_PRIVATE_KEY: z.string().min(1),
  FIRESTORE_DATABASE_ID: z.string().min(1).default("default"),
  FCM_ANDROID_DEVICE_TOKEN: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(1).optional(),
  ANGEL_ONE_TOTP_SECRET: z.string().min(1).optional(),
  ANGEL_ONE_MPIN: z.string().min(1).optional(),
  ANGEL_ONE_CLIENT_ID: z.string().min(1).optional(),
  ANGEL_ONE_API_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).default("gemini-2.5-flash"),
  // Emergency AI fallback: when every Gemini attempt fails, Qwen (via
  // OpenRouter's OpenAI-compatible API) is tried before rule-based picks.
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  QWEN_MODEL: z.string().min(1).default("qwen/qwen-2.5-3b-instruct"),
  // Quality gates for liquid, sub-₹150 momentum trades. A scan is allowed to
  // produce fewer than the top-N cap when the market does not meet them.
  BUY_SCAN_MIN_CHANGE_PERCENT: z.coerce.number().min(0).default(1.5),
  BUY_SCAN_MIN_VOLUME: z.coerce.number().min(0).default(100_000),
  BUY_SCAN_MIN_INTRADAY_RANGE_PERCENT: z.coerce.number().min(0).default(1),
  BUY_SCAN_MAX_DISTANCE_FROM_HIGH_PERCENT: z.coerce.number().min(0).max(100).default(1.5),
  // Price band for buy-scan candidates (this account trades ₹40–₹150 stocks).
  BUY_SCAN_MIN_PRICE: z.coerce.number().min(0).default(40),
  BUY_SCAN_MAX_PRICE: z.coerce.number().min(0).default(150),
  // Maximum number of best picks the daily scan notifies (top-N across the
  // watchlist). This is a cap, never a promise to create weak signals.
  BUY_SCAN_TOP_PICKS: z.coerce.number().min(1).max(10).default(5),
  // Avoid concentrating every signal in one correlated sector (for example,
  // five banking stocks responding to the same news).
  BUY_SCAN_MAX_PER_SECTOR: z.coerce.number().min(1).max(5).default(2),
  // Number of trades per month to divide the maxTradeCapital across, ensuring
  // the monthly budget sustains multiple opportunities instead of one large bet.
  BUY_SCAN_TRADES_PER_MONTH: z.coerce.number().min(1).max(30).default(5),
  // Trade-plan defaults used to enrich buy notifications: stop loss and
  // target as % from the entry price, and the max rupees to deploy per trade
  // when no monthly capital setup exists (otherwise maxTradeCapital is used).
  BUY_SCAN_STOP_LOSS_PERCENT: z.coerce.number().min(0).default(3),
  BUY_SCAN_TARGET_PERCENT: z.coerce.number().min(0).default(7),
  BUY_SCAN_DEFAULT_CAPITAL: z.coerce.number().min(0).default(10_000),
  // "yahoo" works from any host (Vercel included); "angelone" is real-time
  // but its WAF blocks cloud/datacenter IPs, so it only works from a
  // residential IP.
  SCAN_DATA_SOURCE: z.enum(["yahoo", "angelone"]).default("yahoo"),
  CORS_ORIGIN: z.string().optional().default("*"),
  ANGEL_ONE_CLIENT_LOCAL_IP: z.string().optional().default("192.168.1.100"),
  ANGEL_ONE_CLIENT_PUBLIC_IP: z.string().optional().default("103.95.97.4"),
  ANGEL_ONE_MAC_ADDRESS: z.string().optional().default("00:1A:2B:3C:4D:5E")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment variables: ${parsed.error.message}`);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
