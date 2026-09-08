export const collectionNames = {
  settings: "settings",
  portfolio: "portfolio",
  positions: "positions",
  recommendations: "recommendations",
  notifications: "notifications",
  monthlySetup: "monthlySetup",
  // Same-day notification dedup keys + daily scan run-guard markers.
  // Survives Vercel cold starts (unlike in-memory state).
  cronState: "cronState",
  wishlist: "wishlist",
  // Per-symbol "held position" monitoring state for the tiered sell flow:
  // once a position is flagged at +3% the backend keeps tracking its peak PnL
  // until it drops, so the next alert is a sell on the pullback, not a loss at
  // -3% from entry.
  perSymbolAlertState: "perSymbolAlertState"
} as const;

export type RiskLevel = "low" | "medium" | "high";

export const riskAllocation: Record<RiskLevel, number> = {
  low: 0.1,
  medium: 0.2,
  high: 0.3
};
