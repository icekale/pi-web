export const PROVIDER_USAGE_IDS = [
  "anthropic",
  "openai",
  "openai-codex",
  "github-copilot",
  "google-gemini-cli",
  "google-antigravity",
] as const;

export type ProviderUsageId = (typeof PROVIDER_USAGE_IDS)[number];

export function isProviderUsageId(value: string): value is ProviderUsageId {
  return (PROVIDER_USAGE_IDS as readonly string[]).includes(value);
}
