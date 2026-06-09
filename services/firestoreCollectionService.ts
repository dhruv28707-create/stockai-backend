import {
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type Firestore,
  type Query
} from "firebase-admin/firestore";
import type { z } from "zod";

import type { CollectionName, FirestoreDocument } from "../models/firestore";

export type QueryDirection = "asc" | "desc";

export interface ListDocumentsOptions<TDocument extends FirestoreDocument> {
  userId?: string;
  limit?: number;
  orderBy?: keyof TDocument & string;
  direction?: QueryDirection;
}

export interface FirestoreCollectionServiceOptions {
  db: Firestore;
  collectionName: CollectionName;
  createSchema: z.ZodType;
  updateSchema: z.ZodType;
}

export class FirestoreCollectionService<
  TDocument extends FirestoreDocument,
  TCreateInput extends object,
  TUpdateInput extends object
> {
  constructor(private readonly options: FirestoreCollectionServiceOptions) {}

  get name(): CollectionName {
    return this.options.collectionName;
  }

  async create(input: TCreateInput, documentId?: string): Promise<TDocument> {
    const data = this.options.createSchema.parse(input) as Record<string, unknown>;
    const now = Timestamp.now();
    const documentRef = documentId
      ? this.collection.doc(documentId)
      : this.collection.doc();
    const document = {
      ...data,
      id: documentRef.id,
      createdAt: now,
      updatedAt: now
    } as unknown as TDocument;

    await documentRef.set(document);

    return document;
  }

  async getById(documentId: string): Promise<TDocument | null> {
    const snapshot = await this.collection.doc(documentId).get();

    if (!snapshot.exists) {
      return null;
    }

    return snapshot.data() as TDocument;
  }

  async update(documentId: string, input: TUpdateInput): Promise<TDocument | null> {
    const data = this.options.updateSchema.parse(input) as Record<string, unknown>;

    if (Object.keys(data).length === 0) {
      throw new Error("Update payload must include at least one field.");
    }

    const documentRef = this.collection.doc(documentId);
    const snapshot = await documentRef.get();

    if (!snapshot.exists) {
      return null;
    }

    await documentRef.update({
      ...data,
      updatedAt: Timestamp.now()
    });

    return this.getById(documentId);
  }

  async delete(documentId: string): Promise<boolean> {
    const documentRef = this.collection.doc(documentId);
    const snapshot = await documentRef.get();

    if (!snapshot.exists) {
      return false;
    }

    await documentRef.delete();

    return true;
  }

  async list(options: ListDocumentsOptions<TDocument> = {}): Promise<TDocument[]> {
    let query: Query<DocumentData> = this.collection;

    if (options.userId) {
      query = query.where("userId", "==", options.userId);
    }

    if (options.orderBy) {
      query = query.orderBy(options.orderBy, options.direction ?? "asc");
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const snapshot = await query.get();

    return snapshot.docs.map((documentSnapshot) => documentSnapshot.data() as TDocument);
  }

  async exists(documentId: string): Promise<boolean> {
    const snapshot = await this.collection.doc(documentId).get();

    return snapshot.exists;
  }

  private get collection(): CollectionReference<DocumentData> {
    return this.options.db.collection(this.options.collectionName);
  }
}
