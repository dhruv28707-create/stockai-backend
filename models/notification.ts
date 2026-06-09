import type { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

import {
  optionalMetadataSchema,
  userScopedSchema,
  type FirestoreDocument,
  type JsonValue
} from "./firestore";

export type NotificationStatus = "pending" | "sent" | "failed";
export type NotificationChannel = "fcm";

export interface NotificationDocument extends FirestoreDocument {
  title: string;
  body: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  deviceToken?: string;
  sentAt?: Timestamp;
  errorMessage?: string;
  metadata?: Record<string, JsonValue>;
}

export const createNotificationSchema = userScopedSchema
  .extend({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(2000),
    channel: z.literal("fcm").default("fcm"),
    status: z.enum(["pending", "sent", "failed"]).default("pending"),
    deviceToken: z.string().trim().min(1).optional(),
    errorMessage: z.string().trim().max(2000).optional(),
    metadata: optionalMetadataSchema
  })
  .strict();

export const updateNotificationSchema = createNotificationSchema
  .omit({ userId: true })
  .partial()
  .strict();

export type NotificationCreateInput = z.input<typeof createNotificationSchema>;
export type NotificationUpdateInput = z.input<typeof updateNotificationSchema>;
