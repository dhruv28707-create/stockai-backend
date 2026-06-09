# Android AI Stock Assistant Backend

Production-ready scaffold for a single-user Android AI Stock Assistant backend.

## Stack

- Node.js
- TypeScript
- Firebase Firestore
- Firebase Cloud Messaging
- Vercel serverless deployment
- Modular project structure

## Project Structure

```text
api/        Vercel API route handlers
config/     Environment loading and typed app configuration
cron/       Scheduled job entry points
firebase/   Firebase Admin SDK initialization
models/     Firestore/domain model types
services/   Injectable service modules
types/      Shared TypeScript types
utils/      Logging, responses, and common helpers
```

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local environment file:

   ```bash
   cp .env.example .env
   ```

3. Fill in Firebase service account values and app settings.

4. Run locally with Vercel:

   ```bash
   npm run dev
   ```

5. Type-check the project:

   ```bash
   npm run typecheck
   ```

## Environment Variables

| Variable                   | Required | Description                                                        |
| -------------------------- | -------- | ------------------------------------------------------------------ |
| `NODE_ENV`                 | No       | Node runtime environment. Defaults to `development`.               |
| `APP_ENV`                  | No       | App environment label such as `local`, `preview`, or `production`. |
| `SINGLE_USER_ID`           | Yes      | Stable identifier for the single Android user.                     |
| `FIREBASE_PROJECT_ID`      | Yes      | Firebase project ID.                                               |
| `FIREBASE_CLIENT_EMAIL`    | Yes      | Firebase service account client email.                             |
| `FIREBASE_PRIVATE_KEY`     | Yes      | Firebase service account private key. Preserve newline escapes.    |
| `FCM_ANDROID_DEVICE_TOKEN` | No       | Android device token for FCM notifications.                        |
| `CRON_SECRET`              | Yes      | Shared secret used to protect cron API routes.                     |

## Vercel Deployment

Add the environment variables above in the Vercel project dashboard before deploying.

The scaffold includes a weekday cron placeholder at:

```text
/api/cron/daily
```

No business logic is implemented yet. Route handlers and services only establish structure, validation, and integration boundaries.

## Firestore Collections

The Firestore service layer includes typed CRUD helpers for:

```text
settings
portfolio
positions
recommendations
trades
missedTrades
dailyReports
weeklyReports
archives
notifications
```

Use `FirestoreService` to access collection helpers:

```ts
import { FirestoreService } from "./services";

const firestore = new FirestoreService();
const settings = await firestore.settings.list({ userId: "single-user-id" });
```

Each helper validates create and update payloads with Zod before writing to Firestore.
