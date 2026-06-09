import type { z } from "zod";

import {
  jsonValueSchema,
  nonEmptyStringSchema,
  optionalMetadataSchema,
  userScopedSchema,
  type FirestoreDocument,
  type JsonValue
} from "./firestore";

export interface SettingsDocument extends FirestoreDocument {
  key: string;
  value: JsonValue;
  metadata?: Record<string, JsonValue>;
}

export const createSettingsSchema = userScopedSchema
  .extend({
    key: nonEmptyStringSchema,
    value: jsonValueSchema,
    metadata: optionalMetadataSchema
  })
  .strict();

export const updateSettingsSchema = createSettingsSchema
  .omit({ userId: true })
  .partial()
  .strict();

export type SettingsCreateInput = z.infer<typeof createSettingsSchema>;
export type SettingsUpdateInput = z.infer<typeof updateSettingsSchema>;
