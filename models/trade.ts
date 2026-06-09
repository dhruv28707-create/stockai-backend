import { z } from "zod";

import {
  isoDateSchema,
  optionalMetadataSchema,
  symbolSchema,
  userScopedSchema,
  type FirestoreDocument,
  type JsonValue
} from "./firestore";

export type TradeSide = "buy" | "sell";
export type TradeStatus = "planned" | "placed" | "filled" | "cancelled";

export interface TradeDocument extends FirestoreDocument {
  symbol: string;
  side: TradeSide;
  status: TradeStatus;
  quantity: number;
  price: number;
  currency: string;
  tradedOn: string;
  recommendationId?: string;
  metadata?: Record<string, JsonValue>;
}

export const createTradeSchema = userScopedSchema
  .extend({
    symbol: symbolSchema,
    side: z.enum(["buy", "sell"]),
    status: z.enum(["planned", "placed", "filled", "cancelled"]).default("planned"),
    quantity: z.number().finite().positive(),
    price: z.number().finite().nonnegative(),
    currency: z.string().trim().length(3).toUpperCase().default("USD"),
    tradedOn: isoDateSchema,
    recommendationId: z.string().trim().min(1).optional(),
    metadata: optionalMetadataSchema
  })
  .strict();

export const updateTradeSchema = createTradeSchema
  .omit({ userId: true })
  .partial()
  .strict();

export type TradeCreateInput = z.input<typeof createTradeSchema>;
export type TradeUpdateInput = z.input<typeof updateTradeSchema>;
