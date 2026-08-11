# Android AI Stock Assistant Backend

Single-user backend for a personal Indian stock-market AI assistant.

## What It Does

- Stores monthly capital in Firebase Firestore.
- Stores the Android FCM device token in Firebase Firestore.
- Sends push notifications through Firebase Admin SDK.
- Exposes portfolio, recommendation, notification, capital, and market summary APIs.
- Defines weekday cron jobs for:
  - 12:00 PM IST buy scan: `/api/cron/scan?batch=all` (scans all batches and pushes buy signals)
  - 2:00 PM IST portfolio/sell scan: `/api/cron/check-positions` (stop-loss / profit alerts)

## Stack

- Node.js
- TypeScript
- Express
- Firebase Admin SDK
- Firestore
- Firebase Cloud Messaging
- Vercel serverless deployment

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` from `.env.example`.

3. Add Firebase service-account values:

   ```text
   FIREBASE_PROJECT_ID
   FIREBASE_CLIENT_EMAIL
   FIREBASE_PRIVATE_KEY
   FIRESTORE_DATABASE_ID=default
   ```

4. Run locally:

   ```bash
   npm run dev
   ```

The local API listens at:

```text
http://localhost:3000/api
```

## Troubleshooting notifications

1. `GET /api/notifications/status` — shows whether a device token is registered and the last notification attempt.
2. `GET /api/notifications/test` — sends a test push through FCM. If it fails with a token error, the stored token is cleared automatically so the app can re-register.
3. `GET /api/cron/scan?batch=all` — runs the buy scan immediately and returns a per-batch result summary.
4. Check the `cronRuns` collection in Firestore for `buy_scan` entries (status: completed/failed/skipped) to see what the scan decided.

## Main API Endpoints

- `GET /api/health`
- `GET /api/market/summary`
- `GET /api/portfolio`
- `GET /api/recommendations?status=pending&action=buy`
- `GET /api/notifications`
- `POST /api/notifications/register` with `{ "token": "FCM_TOKEN" }`
- `POST /api/register-device` with `{ "token": "FCM_TOKEN" }`
- `POST /api/notifications/test`
- `GET /api/capital/current`
- `POST /api/capital/budget` with `{ "capital": 50000, "riskLevel": "medium", "tradingStyle": "swing" }`
- `POST /api/capital/profit` with `{ "amount": 2500 }`

## Vercel Cron

`vercel.json` schedules weekday jobs in UTC (both fit on the Hobby plan's daily limit):

- `30 6 * * 1-5` → `/api/cron/scan?batch=all` = 12:00 PM IST buy scan
- `30 8 * * 1-5` → `/api/cron/check-positions` = 2:00 PM IST sell scan

Set `CRON_SECRET` in Vercel — cron invocations then arrive with `Authorization: Bearer <CRON_SECRET>` and are auto-validated.

You can also trigger the buy scan manually at any time: `GET /api/cron/scan?batch=all` (or a single batch: `?batch=3`).

## Buy-scan tuning (optional env vars)

- `BUY_SCAN_MIN_CHANGE_PERCENT` (default `1`) — minimum intraday % gain for a candidate.
- `BUY_SCAN_MIN_VOLUME` (default `30000`) — minimum volume for a candidate.
- `GEMINI_MODEL` (default `gemini-3.6-flash`) — AI model used to pick the best signal; falls back to `gemini-2.5-flash` on failure.
