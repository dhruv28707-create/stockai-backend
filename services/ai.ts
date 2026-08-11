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

// gemini-1.5-flash was shut down on 2025-09-29; use a current stable model
// and keep a fallback in case a project can't reach the newest one.
const FALLBACK_MODEL = "gemini-2.5-flash";
const AI_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_TOKENS = 300;

async function callGemini(model: string, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: MAX_OUTPUT_TOKENS
          }
        })
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Gemini ${model} returned ${response.status}: ${body.slice(0, 200)}`
      );
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function toAIPick(value: unknown): AIPick | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;

  const symbol = typeof v.symbol === "string" ? v.symbol.trim() : "";
  const name = typeof v.name === "string" ? v.name.trim() : "";
  const sector = typeof v.sector === "string" ? v.sector.trim() : "";
  const price = Number(v.price);
  const changePercent = Number(v.changePercent);
  const reason = typeof v.reason === "string" ? v.reason.trim() : "";
  const confidence =
    v.confidence === "HIGH" || v.confidence === "MEDIUM" || v.confidence === "LOW"
      ? v.confidence
      : "MEDIUM";

  if (!symbol || !reason || !Number.isFinite(price) || !Number.isFinite(changePercent)) {
    return null;
  }

  return { symbol, name, sector, price, changePercent, reason, confidence };
}

function ruleBasedPick(candidates: Candidate[], type: "buy" | "sell"): AIPick {
  const top = [...candidates].sort((a, b) => b.changePercent - a.changePercent)[0];

  return {
    symbol: top.symbol,
    name: top.name,
    sector: top.sector,
    price: top.price,
    changePercent: top.changePercent,
    reason:
      type === "buy"
        ? `Strong upward momentum of ${top.changePercent.toFixed(2)}%`
        : `Weak momentum, down ${Math.abs(top.changePercent).toFixed(2)}%`,
    confidence: "MEDIUM"
  };
}

export async function analyzeWithAI(
  candidates: Candidate[],
  type: "buy" | "sell"
): Promise<AIPick | null> {
  if (candidates.length === 0) return null;

  const direction = type === "buy" ? "BUY" : "SELL";

  const prompt = `You are a disciplined momentum analyst for NSE (India) stocks. These candidates have already been pre-filtered for movement and volume. Pick the SINGLE best ${direction} opportunity for a swing trade (2-10 days).

Candidates:
${JSON.stringify(candidates.slice(0, 10), null, 2)}

Rules:
- Prefer stocks with strong momentum, healthy volume, and a solid reason (news, sector tailwind, breakout).
- Avoid stocks that are barely moving or have unusually low volume.
- ALWAYS pick the best available candidate. Return null ONLY if every single candidate is genuinely weak (e.g. all moves are negligible or volume has collapsed).
- Reply with ONLY valid JSON, no markdown, no explanation:

{
  "symbol": "STOCK_SYMBOL",
  "name": "Stock Name",
  "sector": "Sector",
  "price": 0,
  "changePercent": 0,
  "reason": "One sentence explanation under 20 words",
  "confidence": "HIGH" | "MEDIUM" | "LOW"
}

If no candidate is worth buying, reply with exactly: null`;

  if (!env.GEMINI_API_KEY) {
    return ruleBasedPick(candidates, type);
  }

  const model = env.GEMINI_MODEL;

  const attempts = [model];
  if (model !== FALLBACK_MODEL) attempts.push(FALLBACK_MODEL);

  for (const attempt of attempts) {
    try {
      const text = await callGemini(attempt, prompt);
      if (!text || text === "null") return null;

      const pick = toAIPick(extractJson(text));
      if (pick) return pick;

      logger.warn(`[analyzeWithAI] Unparseable response from ${attempt}`, {
        text: text.slice(0, 300)
      });
      continue;
    } catch (err) {
      logger.error(`[analyzeWithAI] ${attempt} failed`, {
        error: getErrorMessage(err)
      });
    }
  }

  return ruleBasedPick(candidates, type);
}
