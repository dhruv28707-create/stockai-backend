# Android AI Stock Assistant Backend

Single-user backend for a personal Indian stock-market AI assistant.

## What It Does

- Stores monthly capital in Firebase Firestore.
- Stores the Android FCM device token in Firebase Firestore.
- Sends push notifications through Firebase Admin SDK.
- Exposes portfolio, recommendation, notification, capital, and market summary APIs.
- Defines weekday cron jobs for:
  - 12:00 PM IST buy scan: `/api/cron/scan?batch=all` (scans all batches, picks the top 5 in the ₹40–₹150 band, and pushes buy signals)
  - 2:00 PM IST portfolio/sell scan: `/api/cron/check-positions` (stop-loss / profit alerts)
- Serves live watchlist quotes (poll `/api/market/live` or stream `/api/market/stream`) so the app's digits update like Angel One's feed.

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
- `GET /api/market/live` — fresh watchlist + index quotes (cached ~5s); poll every few seconds for moving digits
- `GET /api/market/stream` — Server-Sent Events stream pushing the live snapshot every 5s
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

- `30 6 * * 1-5` → `/api/cron/scan?batch=all` = 12:00 PM IST buy scan (top 5 picks, ₹40–₹150 band)
- `30 8 * * 1-5` → `/api/cron/check-positions` = 2:00 PM IST sell scan

Set `CRON_SECRET` in Vercel — cron invocations then arrive with `Authorization: Bearer <CRON_SECRET>` and are auto-validated.

You can also trigger the buy scan manually at any time: `GET /api/cron/scan?batch=all` (or a single batch: `?batch=3`).

## Buy-scan tuning (optional env vars)

- `SCAN_DATA_SOURCE` (default `yahoo`) — market data source for the scans.
  - `yahoo` — works from any host, including Vercel's serverless IPs. **Default.**
  - `angelone` — real-time NSE data, but Angel One's WAF blocks cloud/datacenter IPs, so this only works when the backend runs from a residential IP. If you see `Request Rejected` errors from Angel One, that's this.
- `BUY_SCAN_MIN_CHANGE_PERCENT` (default `1`) — minimum intraday % gain for a candidate.
- `BUY_SCAN_MIN_VOLUME` (default `30000`) — minimum volume for a candidate.
- `BUY_SCAN_MIN_PRICE` (default `40`) / `BUY_SCAN_MAX_PRICE` (default `150`) — price band for candidates.
- `BUY_SCAN_TOP_PICKS` (default `5`) — how many best picks the daily 12:00 PM scan notifies.
- `BUY_SCAN_STOP_LOSS_PERCENT` (default `3`) — stop loss as % below the entry price in buy notifications.
- `BUY_SCAN_TARGET_PERCENT` (default `7`) — target as % above the entry price in buy notifications.
- `BUY_SCAN_DEFAULT_CAPITAL` (default `10000`) — rupees per trade used to size quantity when no monthly setup exists (otherwise the setup's `maxTradeCapital` is used).
- `GEMINI_MODEL` (default `gemini-3.6-flash`) — AI model used to pick the best signal; falls back to `gemini-2.5-flash` on failure.
