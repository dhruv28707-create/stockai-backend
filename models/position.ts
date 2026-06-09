import { z } from "zod";

import {
  nonEmptyStringSchema,
  optionalMetadataSchema,
  symbolSchema,
  userScopedSchema,
  type FirestoreDocument,
  type JsonValue
} from "./firestore";

export interface PositionDocument extends FirestoreDocument {
  portfolioId: string;
  symbol: string;
  quantity: number;
  averagePrice: number;
  currency: string;
  metadata?: Record<string, JsonValue>;
}

export const createPositionSchema = userScopedSchema
  .extend({
    portfolioId: nonEmptyStringSchema,
    symbol: symbolSchema,
    quantity: z.number().finite(),
    averagePrice: z.number().finite().nonnegative(),
    currency: z.string().trim().length(3).toUpperCase().default("USD"),
    metadata: optionalMetadataSchema
  })
  .strict();

export const updatePositionSchema = createPositionSchema
  .omit({ userId: true })
  .partial()
  .strict();

export type PositionCreateInput = z.input<typeof createPositionSchema>;
export type PositionUpdateInput = z.input<typeof updatePositionSchema>;
