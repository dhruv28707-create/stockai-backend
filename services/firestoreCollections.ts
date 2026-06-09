import type { Firestore } from "firebase-admin/firestore";

import {
  collectionNames,
  createArchiveSchema,
  createDailyReportSchema,
  createMissedTradeSchema,
  createMonthlySetupSchema,
  createNotificationSchema,
  createPortfolioSchema,
  createPositionSchema,
  createRecommendationSchema,
  createSettingsSchema,
  createTradeSchema,
  createWeeklyReportSchema,
  updateArchiveSchema,
  updateDailyReportSchema,
  updateMissedTradeSchema,
  updateMonthlySetupSchema,
  updateNotificationSchema,
  updatePortfolioSchema,
  updatePositionSchema,
  updateRecommendationSchema,
  updateSettingsSchema,
  updateTradeSchema,
  updateWeeklyReportSchema,
  type ArchiveCreateInput,
  type ArchiveDocument,
  type ArchiveUpdateInput,
  type DailyReportCreateInput,
  type DailyReportDocument,
  type DailyReportUpdateInput,
  type MissedTradeCreateInput,
  type MissedTradeDocument,
  type MissedTradeUpdateInput,
  type MonthlySetupCreateInput,
  type MonthlySetupDocument,
  type MonthlySetupUpdateInput,
  type NotificationCreateInput,
  type NotificationDocument,
  type NotificationUpdateInput,
  type PortfolioCreateInput,
  type PortfolioDocument,
  type PortfolioUpdateInput,
  type PositionCreateInput,
  type PositionDocument,
  type PositionUpdateInput,
  type RecommendationCreateInput,
  type RecommendationDocument,
  type RecommendationUpdateInput,
  type SettingsCreateInput,
  type SettingsDocument,
  type SettingsUpdateInput,
  type TradeCreateInput,
  type TradeDocument,
  type TradeUpdateInput,
  type WeeklyReportCreateInput,
  type WeeklyReportDocument,
  type WeeklyReportUpdateInput
} from "../models";
import { getDb } from "../firebase/admin";
import { FirestoreCollectionService } from "./firestoreCollectionService";

export const createFirestoreCollections = (db: Firestore = getDb()) => ({
  settings: new FirestoreCollectionService<
    SettingsDocument,
    SettingsCreateInput,
    SettingsUpdateInput
  >({
    db,
    collectionName: collectionNames.settings,
    createSchema: createSettingsSchema,
    updateSchema: updateSettingsSchema
  }),
  portfolio: new FirestoreCollectionService<
    PortfolioDocument,
    PortfolioCreateInput,
    PortfolioUpdateInput
  >({
    db,
    collectionName: collectionNames.portfolio,
    createSchema: createPortfolioSchema,
    updateSchema: updatePortfolioSchema
  }),
  positions: new FirestoreCollectionService<
    PositionDocument,
    PositionCreateInput,
    PositionUpdateInput
  >({
    db,
    collectionName: collectionNames.positions,
    createSchema: createPositionSchema,
    updateSchema: updatePositionSchema
  }),
  recommendations: new FirestoreCollectionService<
    RecommendationDocument,
    RecommendationCreateInput,
    RecommendationUpdateInput
  >({
    db,
    collectionName: collectionNames.recommendations,
    createSchema: createRecommendationSchema,
    updateSchema: updateRecommendationSchema
  }),
  trades: new FirestoreCollectionService<
    TradeDocument,
    TradeCreateInput,
    TradeUpdateInput
  >({
    db,
    collectionName: collectionNames.trades,
    createSchema: createTradeSchema,
    updateSchema: updateTradeSchema
  }),
  missedTrades: new FirestoreCollectionService<
    MissedTradeDocument,
    MissedTradeCreateInput,
    MissedTradeUpdateInput
  >({
    db,
    collectionName: collectionNames.missedTrades,
    createSchema: createMissedTradeSchema,
    updateSchema: updateMissedTradeSchema
  }),
  dailyReports: new FirestoreCollectionService<
    DailyReportDocument,
    DailyReportCreateInput,
    DailyReportUpdateInput
  >({
    db,
    collectionName: collectionNames.dailyReports,
    createSchema: createDailyReportSchema,
    updateSchema: updateDailyReportSchema
  }),
  weeklyReports: new FirestoreCollectionService<
    WeeklyReportDocument,
    WeeklyReportCreateInput,
    WeeklyReportUpdateInput
  >({
    db,
    collectionName: collectionNames.weeklyReports,
    createSchema: createWeeklyReportSchema,
    updateSchema: updateWeeklyReportSchema
  }),
  archives: new FirestoreCollectionService<
    ArchiveDocument,
    ArchiveCreateInput,
    ArchiveUpdateInput
  >({
    db,
    collectionName: collectionNames.archives,
    createSchema: createArchiveSchema,
    updateSchema: updateArchiveSchema
  }),
  notifications: new FirestoreCollectionService<
    NotificationDocument,
    NotificationCreateInput,
    NotificationUpdateInput
  >({
    db,
    collectionName: collectionNames.notifications,
    createSchema: createNotificationSchema,
    updateSchema: updateNotificationSchema
  }),
  monthlySetup: new FirestoreCollectionService<
    MonthlySetupDocument,
    MonthlySetupCreateInput,
    MonthlySetupUpdateInput
  >({
    db,
    collectionName: collectionNames.monthlySetup,
    createSchema: createMonthlySetupSchema,
    updateSchema: updateMonthlySetupSchema
  })
});

export type FirestoreCollections = ReturnType<typeof createFirestoreCollections>;
