# Android AI Stock Assistant Backend

Single-user backend for a personal Indian stock-market AI assistant.

## What It Does

- Stores monthly capital in Firebase Firestore.
- Stores the Android FCM device token in Firebase Firestore.
- Sends push notifications through Firebase Admin SDK.
- Exposes portfolio, recommendation, notification, capital, and market summary APIs.
- Defines weekday cron endpoints for:
  - 12:00 PM IST buy scan: `/api/cron/scan`
  - 2:00 PM IST portfolio/sell scan: `/api/cron/check-positions`

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

`vercel.json` schedules weekday jobs in UTC:

- `30 6 * * 1-5` = 12:00 PM IST
- `30 8 * * 1-5` = 2:00 PM IST

Set `CRON_SECRET` in Vercel if you want cron endpoints protected.
