import type { AssistantContentBlock } from "@/lib/types";

const CJK_PATTERN = /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}\uac00-\ud7af]/u;

export interface TokenEstimateCacheEntry {
  text: string;
  tokens: number;
}

export function estimateTokens(text: string): number {
  let cjk = 0;
  let rest = 0;
  for (const ch of text) {
    if (CJK_PATTERN.test(ch)) cjk++;
    else rest++;
  }
  return cjk + rest / 4;
}

export function getTokenEstimateText(block: AssistantContentBlock): string | null {
  if (block.type === "text") return block.text;
  if (block.type === "thinking") return block.thinking;
  if (block.type === "toolCall") return block.rawInput ?? JSON.stringify(block.input ?? {}) ?? "";
  return null;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

export function estimateUpdatedTokens(previous: TokenEstimateCacheEntry | undefined, text: string): number {
  if (!previous || !text.startsWith(previous.text)) return estimateTokens(text);

  let baseTokens = previous.tokens;
  let suffixStart = previous.text.length;
  if (
    suffixStart > 0
    && suffixStart < text.length
    && isHighSurrogate(previous.text.charCodeAt(suffixStart - 1))
    && isLowSurrogate(text.charCodeAt(suffixStart))
  ) {
    baseTokens -= 1 / 4;
    suffixStart--;
  }
  return baseTokens + estimateTokens(text.slice(suffixStart));
}

export function estimateStreamingTokens(
  items: { block: AssistantContentBlock; originalIndex: number }[],
  previousCache: Map<number, TokenEstimateCacheEntry>,
): { tokens: number; cache: Map<number, TokenEstimateCacheEntry> } {
  const cache = new Map<number, TokenEstimateCacheEntry>();
  let tokens = 0;
  for (const { block, originalIndex } of items) {
    const text = getTokenEstimateText(block);
    if (text === null) continue;
    const estimated = estimateUpdatedTokens(previousCache.get(originalIndex), text);
    cache.set(originalIndex, { text, tokens: estimated });
    tokens += estimated;
  }
  return { tokens, cache };
}

export function computeStreamingTps(
  tokens: number,
  firstTokenAt: number | null,
  now: number,
  minElapsedSec = 0.5,
): number | null {
  if (tokens <= 0 || firstTokenAt === null) return null;
  const elapsed = (now - firstTokenAt) / 1000;
  if (elapsed <= minElapsedSec) return null;
  return tokens / elapsed;
}
