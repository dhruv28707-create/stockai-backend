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
  CRON_SECRET: z.string().min(1).optional()
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment variables: ${parsed.error.message}`);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
