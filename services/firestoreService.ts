import type { Firestore } from "firebase-admin/firestore";

import { getDb } from "../firebase/admin";
import {
  createFirestoreCollections,
  type FirestoreCollections
} from "./firestoreCollections";

export class FirestoreService {
  readonly collections: FirestoreCollections;

  constructor(private readonly db: Firestore = getDb()) {
    this.collections = this.initializeCollections();
  }

  get client(): Firestore {
    return this.db;
  }

  get settings(): FirestoreCollections["settings"] {
    return this.collections.settings;
  }

  get portfolio(): FirestoreCollections["portfolio"] {
    return this.collections.portfolio;
  }

  get positions(): FirestoreCollections["positions"] {
    return this.collections.positions;
  }

  get recommendations(): FirestoreCollections["recommendations"] {
    return this.collections.recommendations;
  }

  get trades(): FirestoreCollections["trades"] {
    return this.collections.trades;
  }

  get missedTrades(): FirestoreCollections["missedTrades"] {
    return this.collections.missedTrades;
  }

  get dailyReports(): FirestoreCollections["dailyReports"] {
    return this.collections.dailyReports;
  }

  get weeklyReports(): FirestoreCollections["weeklyReports"] {
    return this.collections.weeklyReports;
  }

  get archives(): FirestoreCollections["archives"] {
    return this.collections.archives;
  }

  get notifications(): FirestoreCollections["notifications"] {
    return this.collections.notifications;
  }

  get monthlySetup(): FirestoreCollections["monthlySetup"] {
    return this.collections.monthlySetup;
  }

  initializeCollections(): FirestoreCollections {
    return createFirestoreCollections(this.db);
  }
}
