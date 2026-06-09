import { z } from "zod";

import {
  nonEmptyStringSchema,
  optionalMetadataSchema,
  userScopedSchema,
  type FirestoreDocument,
  type JsonValue
} from "./firestore";

export interface PortfolioDocument extends FirestoreDocument {
  name: string;
  currency: string;
  description?: string;
  metadata?: Record<string, JsonValue>;
}

export const createPortfolioSchema = userScopedSchema
  .extend({
    name: nonEmptyStringSchema,
    currency: z.string().trim().length(3).toUpperCase().default("USD"),
    description: z.string().trim().max(500).optional(),
    metadata: optionalMetadataSchema
  })
  .strict();

export const updatePortfolioSchema = createPortfolioSchema
  .omit({ userId: true })
  .partial()
  .strict();

export type PortfolioCreateInput = z.input<typeof createPortfolioSchema>;
export type PortfolioUpdateInput = z.input<typeof updatePortfolioSchema>;
