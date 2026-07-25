import "dotenv/config";
import { z } from "zod";

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
