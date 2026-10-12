/** Verify Gemini model discovery uses Google's REST contract without exposing keys. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchProviderModels, parseModelsJson } from "./model-fetch";
import { validateOutboundHttpUrl } from "./external-url";
import { publicHttpGet } from "./public-http";

vi.mock("./external-url", () => ({ validateOutboundHttpUrl: vi.fn() }));
vi.mock("./public-http", () => ({ publicHttpGet: vi.fn() }));

const googleModel = {
  name: "models/gemini-2.5-flash",
  inputTokenLimit: 1048576,
  outputTokenLimit: 65536,
  supportedGenerationMethods: ["generateContent", "countTokens"],
};
const input = {
  api: "google-generative-ai" as const,
  baseUrl: "https://generativelanguage.googleapis.com",
  apiKey: " test-google-key ",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(validateOutboundHttpUrl).mockResolvedValue({ ok: true, href: input.baseUrl });
  vi.mocked(publicHttpGet).mockResolvedValue({
    ok: true, status: 200, body: JSON.stringify({ models: [googleModel] }),
  });
});

describe("Gemini model discovery", () => {
  it.each([
    [input.baseUrl, `${input.baseUrl}/v1beta/models`],
    [`${input.baseUrl}/v1beta/`, `${input.baseUrl}/v1beta/models`],
    [`${input.baseUrl}/v1`, `${input.baseUrl}/v1/models`],
    ["https://gateway.example/google", "https://gateway.example/google/v1beta/models"],
  ])("uses the native endpoint and API-key header for %s", async (baseUrl, endpoint) => {
    const result = await fetchProviderModels({ ...input, baseUrl });
    expect(result.ok).toBe(true);
    expect(result.models).toEqual([{
      id: "gemini-2.5-flash", contextWindow: 1048576, maxOutputTokens: 65536,
    }]);
    expect(publicHttpGet).toHaveBeenCalledTimes(1);
    const [url, headers] = vi.mocked(publicHttpGet).mock.calls[0]!;
    expect(new URL(url).origin + new URL(url).pathname).toBe(endpoint);
    expect(headers["x-goog-api-key"]).toBe("test-google-key");
    expect(headers.Authorization).toBeUndefined();
    expect(url).not.toContain("test-google-key");
  });

  it("parses only content-generation models and preserves native token limits", () => {
    expect(parseModelsJson({ models: [
      googleModel,
      { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] },
      { name: "models/", supportedGenerationMethods: ["generateContent"] },
      { name: 7, supportedGenerationMethods: ["generateContent"] },
      null,
      { name: "models/custom-chat", inputTokenLimit: -1, outputTokenLimit: 0,
        supportedGenerationMethods: ["generateContent"] },
    ] }, input.api)).toEqual([
      { id: "custom-chat" },
      { id: "gemini-2.5-flash", contextWindow: 1048576, maxOutputTokens: 65536 },
    ]);
  });

  it("follows page tokens on the same endpoint and combines model lists", async () => {
    vi.mocked(publicHttpGet)
      .mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify({
        models: [googleModel], nextPageToken: "next/page?part=2",
      }) })
      .mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify({
        models: [{ ...googleModel, name: "models/gemini-2.5-pro" }],
      }) });
    const result = await fetchProviderModels(input);
    expect(result.models?.map((m) => m.id)).toEqual(["gemini-2.5-flash", "gemini-2.5-pro"]);
    const second = new URL(vi.mocked(publicHttpGet).mock.calls[1]![0]);
    expect(second.pathname).toBe("/v1beta/models");
    expect(second.searchParams.get("pageToken")).toBe("next/page?part=2");
    expect(second.searchParams.has("key")).toBe(false);
  });

  it("stops repeated page tokens with an explicit error", async () => {
    vi.mocked(publicHttpGet).mockResolvedValue({ ok: true, status: 200,
      body: JSON.stringify({ models: [googleModel], nextPageToken: "repeat" }),
    });
    expect((await fetchProviderModels(input)).error).toContain("分页");
    expect(publicHttpGet).toHaveBeenCalledTimes(2);
  });

  it("bounds pagination even when every page token is different", async () => {
    let page = 0;
    vi.mocked(publicHttpGet).mockImplementation(async () => ({ ok: true, status: 200,
      body: JSON.stringify({ models: [googleModel], nextPageToken: `page-${++page}` }),
    }));
    expect((await fetchProviderModels(input)).error).toContain("分页");
    expect(publicHttpGet).toHaveBeenCalledTimes(10);
  });

  it("reports a later-page error without returning a partial model list", async () => {
    vi.mocked(publicHttpGet)
      .mockResolvedValueOnce({ ok: true, status: 200,
        body: JSON.stringify({ models: [googleModel], nextPageToken: "next" }),
      })
      .mockResolvedValueOnce({ ok: false, status: 429,
        body: JSON.stringify({ error: { message: "Quota exceeded" } }),
      });
    const result = await fetchProviderModels(input);
    expect(result.ok).toBe(false);
    expect(result.models).toBeUndefined();
    expect(result.error).toContain("HTTP 429: Quota exceeded");
  });

  it.each([401, 403])("retains Google's error detail for HTTP %s and redacts the key", async (status) => {
    vi.mocked(publicHttpGet).mockResolvedValue({ ok: false, status,
      body: JSON.stringify({ error: { message: "API key test-google-key has been blocked" } }),
    });
    const result = await fetchProviderModels(input);
    expect(result.ok).toBe(false);
    expect(result.error).toContain(`HTTP ${status}`);
    expect(result.error).toContain("blocked");
    expect(JSON.stringify(result)).not.toContain("test-google-key");
  });

  it("rejects private base URLs before transmitting a Google key", async () => {
    vi.mocked(validateOutboundHttpUrl).mockResolvedValue({ ok: false, error: "仅支持公网地址" });
    expect((await fetchProviderModels({ ...input, baseUrl: "http://127.0.0.1" })).ok).toBe(false);
    expect(publicHttpGet).not.toHaveBeenCalled();
  });

  it("keeps Bearer authentication and OpenAI response parsing for other APIs", async () => {
    vi.mocked(publicHttpGet).mockResolvedValue({ ok: true, status: 200,
      body: JSON.stringify({ data: [{ id: "gpt-4o", owned_by: "openai" }] }),
    });
    const result = await fetchProviderModels({ baseUrl: "https://api.openai.com/v1", apiKey: "openai-key" });
    expect(result.models?.[0]?.id).toBe("gpt-4o");
    expect(publicHttpGet).toHaveBeenCalledWith("https://api.openai.com/v1/models", expect.objectContaining({
      Authorization: "Bearer openai-key",
    }), 8000);
  });
});
