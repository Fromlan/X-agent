/** Gate DeepSeek application APIs by the exact documented model and official protocol endpoint. */
export interface DeepSeekModelTarget {
  id: string;
  api: string;
  baseUrl: string;
}

/** Fail closed for proxies, lookalike hosts, legacy aliases and unsupported protocol paths. */
export function supportsDeepSeekChatbot(model?: DeepSeekModelTarget | null): boolean {
  if (!model || model.id !== "deepseek-flash") return false;
  try {
    const url = new URL(model.baseUrl);
    if (url.origin !== "https://api.deepseek.com" || url.username || url.password || url.search || url.hash) return false;
    const path = url.pathname.replace(/\/+$/, "");
    return model.api === "openai-completions"
      ? ["", "/v1"].includes(path)
      : model.api === "anthropic-messages" && ["/anthropic", "/anthropic/v1"].includes(path);
  } catch {
    return false;
  }
}
