import { z } from "zod";

import {
  isoDateSchema,
  optionalMetadataSchema,
  symbolSchema,
  userScopedSchema,
  type FirestoreDocument,
  type JsonValue
} from "./firestore";

export type MissedTradeReason =
  | "price_moved"
  | "notification_missed"
  | "manual_skip"
  | "insufficient_funds"
  | "other";

export interface MissedTradeDocument extends FirestoreDocument {
  symbol: string;
  side: "buy" | "sell";
  reason: MissedTradeReason;
  observedOn: string;
  notes?: string;
  recommendationId?: string;
  metadata?: Record<string, JsonValue>;
}

export const createMissedTradeSchema = userScopedSchema
  .extend({
    symbol: symbolSchema,
    side: z.enum(["buy", "sell"]),
    reason: z.enum([
      "price_moved",
      "notification_missed",
      "manual_skip",
      "insufficient_funds",
      "other"
    ]),
    observedOn: isoDateSchema,
    notes: z.string().trim().max(2000).optional(),
    recommendationId: z.string().trim().min(1).optional(),
    metadata: optionalMetadataSchema
  })
  .strict();

export const updateMissedTradeSchema = createMissedTradeSchema
  .omit({ userId: true })
  .partial()
  .strict();

export type MissedTradeCreateInput = z.input<typeof createMissedTradeSchema>;
export type MissedTradeUpdateInput = z.input<typeof updateMissedTradeSchema>;
