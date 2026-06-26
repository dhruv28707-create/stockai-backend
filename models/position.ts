import { z } from "zod";

import {
  nonEmptyStringSchema,
  optionalMetadataSchema,
  symbolSchema,
  userScopedSchema,
  type FirestoreDocument,
  type JsonValue
} from "./firestore";

export type PositionStatus = "open" | "closed" | "target_hit" | "stop_loss_hit";

export interface PositionDocument extends FirestoreDocument {
  portfolioId: string;
  symbol: string;
  quantity: number;
  averagePrice: number;
  currency: string;
  // KEY FIX: this field was already being written (status: "open") and
  // queried (.where("status", "==", "open")) elsewhere in the codebase,
  // but was missing from the type definition entirely.
  status: PositionStatus;
  // KEY ADDITION: carried over from the originating recommendation at
  // purchase time, so the position-check cron has a stable target/stop
  // to compare the live price against, without re-reading the original
  // recommendation's loose metadata bag every time.
  targetPrice?: number;
  stopLoss?: number;
  metadata?: Record<string, JsonValue>;
}

export const createPositionSchema = userScopedSchema
  .extend({
    portfolioId: nonEmptyStringSchema,
    symbol: symbolSchema,
    quantity: z.number().finite(),
    averagePrice: z.number().finite().nonnegative(),
    currency: z.string().trim().length(3).toUpperCase().default("USD"),
    targetPrice: z.number().finite().positive().optional(),
    stopLoss: z.number().finite().positive().optional(),
    metadata: optionalMetadataSchema
  })
  .strict();

export const updatePositionSchema = createPositionSchema
  .omit({ userId: true })
  .partial()
  .strict();

export type PositionCreateInput = z.input<typeof createPositionSchema>;
export type PositionUpdateInput = z.input<typeof updatePositionSchema>;
