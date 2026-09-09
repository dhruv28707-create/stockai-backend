# Android AI Stock Assistant Backend

Single-user backend for a personal Indian stock-market AI assistant.

## What It Does

- Stores monthly capital in Firebase Firestore.
- Stores the Android FCM device token in Firebase Firestore.
- Sends push notifications through Firebase Admin SDK.
- Exposes portfolio, recommendation, notification, capital, and market summary APIs.
- Defines weekday cron jobs for:
  - 12:00 PM IST buy scan: `/api/cron/scan?batch=all` (scans all batches, picks the strongest candidates in the ₹40–₹150 band, and pushes buy signals; when no stock qualifies, it pushes a "⛔ No buy signal today — don't invest" advisory instead of staying silent)
  - 1:30 PM IST portfolio/sell scan: `/api/cron/check-positions` (scans the Trade tab: sell signal when a position drops, hold signal when it gains)
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
5. `GET /api/cron/runs?job=buy_scan` (with `Authorization: Bearer <CRON_SECRET>`) — read-only view of the same `cronRuns` history without opening the Firebase console. Each entry records the date, status, and message (e.g. "No candidates found"), so you can confirm the cron actually fired and what it decided.

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
- `GET /api/cron/runs?job=buy_scan` — read-only cron run history (requires `Authorization: Bearer <CRON_SECRET>`)
- `GET /api/capital/current`
- `POST /api/capital/budget` with `{ "capital": 50000, "riskLevel": "medium", "tradingStyle": "swing" }`
- `POST /api/capital/profit` with `{ "amount": 2500 }`

## Vercel Cron

`vercel.json` schedules weekday jobs in UTC (both fit on the Hobby plan's daily limit):

- `30 6 * * 1-5` → `/api/cron/scan?batch=all` = 12:00 PM IST buy scan (up to 5 strong picks, ₹40–₹150 band)
- `0 8 * * 1-5` → `/api/cron/check-positions` = 1:30 PM IST sell scan (scans open positions: sell signal on down moves, hold signal on up moves)

Set `CRON_SECRET` in Vercel — cron invocations then arrive with `Authorization: Bearer <CRON_SECRET>` and are auto-validated.

You can also trigger the buy scan manually at any time: `GET /api/cron/scan?batch=all` (or a single batch: `?batch=3`).

## Buy-scan tuning (optional env vars)

- `SCAN_DATA_SOURCE` (default `yahoo`) — market data source for the scans.
  - `yahoo` — works from any host, including Vercel's serverless IPs. **Default.**
  - `angelone` — real-time NSE data, but Angel One's WAF blocks cloud/datacenter IPs, so this only works when the backend runs from a residential IP. If you see `Request Rejected` errors from Angel One, that's this.
- `BUY_SCAN_MIN_CHANGE_PERCENT` (default `1.5`) — minimum intraday % gain for a candidate.
- `BUY_SCAN_MIN_VOLUME` (default `100000`) — minimum volume for a candidate.
- `BUY_SCAN_MIN_INTRADAY_RANGE_PERCENT` (default `1`) — minimum high-to-low range, which avoids inactive shares.
- `BUY_SCAN_MAX_DISTANCE_FROM_HIGH_PERCENT` (default `1.5`) — candidate must be close to its intraday high, not fading after an early spike.
- `BUY_SCAN_MIN_PRICE` (default `40`) / `BUY_SCAN_MAX_PRICE` (default `150`) — price band for candidates.
- `BUY_SCAN_TOP_PICKS` (default `5`) — maximum number of strong picks the daily scan notifies; it can send fewer when conditions are weak.
- On days with no qualifying stock, the scan pushes a "no buy signal today" advisory (once per day) instead of staying silent — so you know the scan ran and it's safe to skip investing.
- `BUY_SCAN_MAX_PER_SECTOR` (default `2`) — maximum correlated picks from one sector per scan.
- `BUY_SCAN_STOP_LOSS_PERCENT` (default `3`) — stop loss as % below the entry price in buy notifications.
- `BUY_SCAN_TARGET_PERCENT` (default `7`) — target as % above the entry price in buy notifications.
- `BUY_SCAN_DEFAULT_CAPITAL` (default `10000`) — rupees per trade used to size quantity when no monthly setup exists (otherwise the setup's `maxTradeCapital` is used).
- `GEMINI_MODEL` (default `gemini-3.6-flash`) — AI model used to pick the best signal; falls back to `gemini-2.5-flash` on failure.

## Sell-scan tuning (optional env vars)

New sell-scan flow (profit-first, loss-avoiding):

- When an open position first reaches `SELL_SCAN_HOLD_AT_PERCENT` (default `+3%`) from entry, it receives a **hold alert** (`HOLD_ALERT`). Tapping the notification opens the position so you can choose to keep holding. While held, the backend keeps monitoring the position's peak PnL.
- While a position is held, no further alerts are sent as it keeps rising.
- If a held position then drops by `SELL_SCAN_SELL_AT_PERCENT` (default `2%`) from its recorded peak, it receives a **sell alert** (`SELL_ALERT`) so you can exit near break-even or with a small profit instead of waiting for a loss.
- A held position is automatically "unheld" once it falls back below `SELL_SCAN_RESET_BELOW_PERCENT` (default `+1%`) from entry, so the next time it climbs back to +3% it re-alerts.
- `SELL_SCAN_HOLD_AT_PERCENT` (default `3`)
- `SELL_SCAN_SELL_AT_PERCENT` (default `2`)
- `SELL_SCAN_RESET_BELOW_PERCENT` (default `1`)

The old single-threshold setup (`SELL_SCAN_DOWN_PERCENT` / `SELL_SCAN_UP_PERCENT`) is no longer used by the sell scan.
