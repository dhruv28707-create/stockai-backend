import { z } from "zod";

import {
  collectionNames,
  jsonValueSchema,
  nonEmptyStringSchema,
  optionalMetadataSchema,
  userScopedSchema,
  type CollectionName,
  type FirestoreDocument,
  type JsonValue
} from "./firestore";

export interface ArchiveDocument extends FirestoreDocument {
  sourceCollection: CollectionName;
  sourceId: string;
  payload: JsonValue;
  archivedBy?: string;
  metadata?: Record<string, JsonValue>;
}

export const createArchiveSchema = userScopedSchema
  .extend({
    sourceCollection: z.enum([
      collectionNames.settings,
      collectionNames.portfolio,
      collectionNames.positions,
      collectionNames.recommendations,
      collectionNames.trades,
      collectionNames.missedTrades,
      collectionNames.dailyReports,
      collectionNames.weeklyReports,
      collectionNames.notifications
    ]),
    sourceId: nonEmptyStringSchema,
    payload: jsonValueSchema,
    archivedBy: z.string().trim().min(1).optional(),
    metadata: optionalMetadataSchema
  })
  .strict();

export const updateArchiveSchema = createArchiveSchema
  .omit({ userId: true })
  .partial()
  .strict();

export type ArchiveCreateInput = z.input<typeof createArchiveSchema>;
export type ArchiveUpdateInput = z.input<typeof updateArchiveSchema>;
