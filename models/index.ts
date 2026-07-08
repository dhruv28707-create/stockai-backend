export const collectionNames = {
  settings: "settings",
  portfolio: "portfolio",
  positions: "positions",
  recommendations: "recommendations",
  notifications: "notifications",
  monthlySetup: "monthlySetup"
} as const;

export type RiskLevel = "low" | "medium" | "high";

export const riskAllocation: Record<RiskLevel, number> = {
  low: 0.1,
  medium: 0.2,
  high: 0.3
};
