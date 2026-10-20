/** Declare opt-in web tools and eligible credentials so every process uses the same policy. */
export const WEB_TOOLS = ["web_search", "web_fetch"] as const;
export type WebToolName = (typeof WEB_TOOLS)[number];

/** Only official DeepSeek profiles can supply a key to the fixed Search/Fetch endpoints. */
export function isDeepSeekWebProvider(profile: { baseUrl: string }): boolean {
  try {
    const url = new URL(profile.baseUrl);
    return url.origin === "https://api.deepseek.com" && !url.username && !url.password &&
      !url.search && !url.hash && ["", "/v1", "/anthropic", "/anthropic/v1"].includes(url.pathname.replace(/\/+$/, ""));
  } catch {
    return false;
  }
}
