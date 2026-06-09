import type { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface FirestoreDocument {
  id: string;
  userId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const collectionNames = {
  settings: "settings",
  portfolio: "portfolio",
  positions: "positions",
  recommendations: "recommendations",
  trades: "trades",
  missedTrades: "missedTrades",
  dailyReports: "dailyReports",
  weeklyReports: "weeklyReports",
  archives: "archives",
  notifications: "notifications",
  monthlySetup: "monthlySetup"
} as const;

export type CollectionName = (typeof collectionNames)[keyof typeof collectionNames];

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema)
  ])
);

export const nonEmptyStringSchema = z.string().trim().min(1);

export const userScopedSchema = z.strictObject({
  userId: nonEmptyStringSchema
});

export const symbolSchema = z.string().trim().min(1).max(16).toUpperCase();

export const isoDateSchema = z.string().trim().date();

export const optionalMetadataSchema = z.record(z.string(), jsonValueSchema).optional();

// YYYY-MM format, e.g. "2025-06"
export const yearMonthSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Must be in YYYY-MM format");
