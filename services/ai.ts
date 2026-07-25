import { env } from "../config/env";
import { getErrorMessage } from "../utils/helpers";
import { logger } from "../utils/logger";

export interface Candidate {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
}

export interface AIPick {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  changePercent: number;
  reason: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

export async function analyzeWithAI(
  candidates: Candidate[],
  type: "buy" | "sell"
): Promise<AIPick | null> {
  const prompt = `You are a stock market analyst for NSE (India). Analyze these ${type === "buy" ? "bullish" : "bearish"} stock candidates and pick the SINGLE best ${type} opportunity. Reply ONLY with valid JSON, no markdown, no explanation.

Candidates:
${JSON.stringify(candidates, null, 2)}

Return this exact JSON shape:
{
  "symbol": "STOCK_SYMBOL",
  "name": "Stock Name",
  "sector": "Sector",
  "price": 0,
  "changePercent": 0,
  "reason": "One sentence explanation under 20 words",
  "confidence": "HIGH" | "MEDIUM" | "LOW"
}

If none of these stocks show a genuinely strong ${type} signal, return: null`;

  if (!env.GEMINI_API_KEY) {
    const top = candidates[0];
    return {
      symbol: top.symbol,
      name: top.name,
      sector: top.sector,
      price: top.price,
      changePercent: top.changePercent,
      reason: `Strong upward momentum of ${top.changePercent.toFixed(2)}%`,
      confidence: "MEDIUM"
    };
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 300
          }
        })
      }
    );

    const data = (await response.json()) as {
      candidates: Array<{
        content: { parts: Array<{ text: string }> };
      }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    const clean = text.replace(/```json|```/g, "").trim();

    if (clean === "null" || clean === "") return null;

    return JSON.parse(clean) as AIPick;
  } catch (err) {
    logger.error("[analyzeWithAI] Gemini failed", { error: getErrorMessage(err) });
    const top = candidates[0];
    return {
      symbol: top.symbol,
      name: top.name,
      sector: top.sector,
      price: top.price,
      changePercent: top.changePercent,
      reason: `Strong momentum: up ${top.changePercent.toFixed(2)}% today`,
      confidence: "LOW"
    };
  }
}
