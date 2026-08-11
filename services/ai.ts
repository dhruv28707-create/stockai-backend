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
const MAX_OUTPUT_TOKENS = 500;

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

/**
 * Extracts the first JSON value from a model response. Multi-pick replies are
 * arrays (`[ {...}, {...} ]`), single picks are objects — handle both, and
 * tolerate markdown fences and surrounding prose.
 */
function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();

  const arrayStart = cleaned.indexOf("[");
  const arrayEnd = cleaned.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    try {
      return JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1));
    } catch {
      // fall through to object parsing
    }
  }

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

/** Normalizes a parsed response (array or single object) into up to `count` picks. */
function toAIPicks(value: unknown, count: number): AIPick[] {
  if (Array.isArray(value)) {
    const seen = new Set<string>();
    const picks: AIPick[] = [];
    for (const item of value) {
      const pick = toAIPick(item);
      if (pick && !seen.has(pick.symbol)) {
        seen.add(pick.symbol);
        picks.push(pick);
        if (picks.length >= count) break;
      }
    }
    return picks;
  }

  const pick = toAIPick(value);
  return pick ? [pick] : [];
}

function ruleBasedPicks(
  candidates: Candidate[],
  type: "buy" | "sell",
  count: number
): AIPick[] {
  return [...candidates]
    .sort((a, b) => b.changePercent - a.changePercent)
    .slice(0, count)
    .map((top) => ({
      symbol: top.symbol,
      name: top.name,
      sector: top.sector,
      price: top.price,
      changePercent: top.changePercent,
      reason:
        type === "buy"
          ? `Strong upward momentum of ${top.changePercent.toFixed(2)}%`
          : `Weak momentum, down ${Math.abs(top.changePercent).toFixed(2)}%`,
      confidence: "MEDIUM" as const
    }));
}

/**
 * Ask the AI for the best `count` opportunities among `candidates`.
 * Returns an array (empty when nothing qualifies). Falls back to a rule-based
 * pick when Gemini is unavailable or misbehaves.
 */
export async function analyzeWithAI(
  candidates: Candidate[],
  type: "buy" | "sell",
  count = 1
): Promise<AIPick[]> {
  if (candidates.length === 0) return [];
  const safeCount = Math.max(1, Math.min(count, candidates.length));

  const direction = type === "buy" ? "BUY" : "SELL";
  const candidatesJson = JSON.stringify(candidates.slice(0, 10), null, 2);

  const pickShape = `{
  "symbol": "STOCK_SYMBOL",
  "name": "Stock Name",
  "sector": "Sector",
  "price": 0,
  "changePercent": 0,
  "reason": "One sentence explanation under 20 words",
  "confidence": "HIGH" | "MEDIUM" | "LOW"
}`;

  const responseInstruction =
    safeCount === 1
      ? `Reply with ONLY valid JSON, no markdown, no explanation:\n\n${pickShape}\n\nIf no candidate is worth buying, reply with exactly: null`
      : `Reply with ONLY valid JSON, no markdown, no explanation. Return up to ${safeCount} distinct picks, ranked best first, as a JSON array:\n\n[${pickShape}]\n\nIf fewer than ${safeCount} candidates are worth buying, return fewer. If none, reply with exactly: null`;

  const prompt = `You are a disciplined momentum analyst for NSE (India) stocks. These candidates have already been pre-filtered for movement, volume, and price band. Pick the best ${direction} opportunities for swing trades (2-10 days).

Candidates:
${candidatesJson}

Rules:
- Prefer stocks with strong momentum, healthy volume, and a solid reason (news, sector tailwind, breakout).
- Avoid stocks that are barely moving or have unusually low volume.
- ALWAYS pick the best available candidate. Return null ONLY if every single candidate is genuinely weak (e.g. all moves are negligible or volume has collapsed).
${responseInstruction}`;

  if (!env.GEMINI_API_KEY) {
    return ruleBasedPicks(candidates, type, safeCount);
  }

  const model = env.GEMINI_MODEL;

  const attempts = [model];
  if (model !== FALLBACK_MODEL) attempts.push(FALLBACK_MODEL);

  for (const attempt of attempts) {
    try {
      const text = await callGemini(attempt, prompt);
      if (!text || text === "null") return [];

      const picks = toAIPicks(extractJson(text), safeCount);
      if (picks.length > 0) return picks;

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

  return ruleBasedPicks(candidates, type, safeCount);
}
