import { z } from "zod";

import {
  isoDateSchema,
  optionalMetadataSchema,
  symbolSchema,
  userScopedSchema,
  type FirestoreDocument,
  type JsonValue
} from "./firestore";

export type RecommendationAction = "buy" | "sell" | "hold" | "watch";
export type RecommendationStatus = "pending" | "reviewed" | "accepted" | "dismissed";

export interface RecommendationDocument extends FirestoreDocument {
  symbol: string;
  action: RecommendationAction;
  status: RecommendationStatus;
  confidence?: number;
  rationale?: string;
  expiresOn?: string;
  metadata?: Record<string, JsonValue>;
}

export const createRecommendationSchema = userScopedSchema
  .extend({
    symbol: symbolSchema,
    action: z.enum(["buy", "sell", "hold", "watch"]),
    status: z.enum(["pending", "reviewed", "accepted", "dismissed"]).default("pending"),
    confidence: z.number().finite().min(0).max(1).optional(),
    rationale: z.string().trim().max(5000).optional(),
    expiresOn: isoDateSchema.optional(),
    metadata: optionalMetadataSchema
  })
  .strict();

export const updateRecommendationSchema = createRecommendationSchema
  .omit({ userId: true })
  .partial()
  .strict();

export type RecommendationCreateInput = z.input<typeof createRecommendationSchema>;
export type RecommendationUpdateInput = z.input<typeof updateRecommendationSchema>;
