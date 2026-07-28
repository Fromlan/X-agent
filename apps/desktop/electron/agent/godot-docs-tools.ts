/**
 * Pi custom tools for searching local Godot documentation.
 */
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  getDocsStatus,
  normalizeGodotDocsBranch,
} from "./godot-docs-cache";
import { searchGodotDocs } from "./godot-docs-search";
import { loadPrefs } from "./prefs";

function textResult(text: string, details: unknown = {}) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function formatHits(result: Awaited<ReturnType<typeof searchGodotDocs>>): string {
  if (!result.ok) {
    return `Godot docs search failed (branch=${result.branch}): ${result.error ?? "unknown error"}`;
  }
  if (result.hits.length === 0) {
    return [
      `No matches in godot-docs@${result.branch}.`,
      "Search tip: use short keywords (1–2 words), not full sentences.",
      'Example: query "AnimationPlayer" or "play", not "how to play an animation".',
      "Retry with class/method names, or check Settings → Godot for branch/import.",
    ].join(" ");
  }
  const lines: string[] = [
    `Godot docs search (branch=${result.branch}${result.truncated ? ", truncated" : ""}):`,
    "How to use results:",
    "- Overview / comparison questions: you may answer from summary/snippet; read only if you need more detail.",
    "- API / method / property details: call `read` on the best `classes/class_*.rst` absPath (prefer limit=80–120 for class pages). Do NOT prefer best_practices comparison pages for API facts.",
    "- Paths are under the godot-docs cache — never invent project cwd or node_modules paths.",
  ];
  for (let i = 0; i < result.hits.length; i++) {
    const h = result.hits[i]!;
    lines.push("");
    lines.push(`${i + 1}. ${h.title}`);
    lines.push(`   absPath: ${h.absPath}`);
    lines.push(`   relPath: ${h.relPath}`);
    lines.push(`   url: ${h.docsUrl}`);
    lines.push(`   score: ${h.score}`);
    if (h.summary) {
      lines.push(`   summary: ${h.summary}`);
    }
    lines.push("   ---");
    lines.push(
      h.snippet
        .split("\n")
        .map((l) => `   ${l}`)
        .join("\n"),
    );
  }
  return lines.join("\n");
}

const searchParams = Type.Object({
  query: Type.String({
    description:
      "Short keyword(s) to search in Godot docs (.rst). Prefer 1–2 words: class/method names (e.g. AnimationPlayer, play, signal). Do NOT pass full sentences or natural-language questions.",
  }),
  limit: Type.Optional(
    Type.Number({
      description: "Max results (default 6, max 12).",
    }),
  ),
  path_glob: Type.Optional(
    Type.String({
      description:
        'Optional path filter, e.g. "classes/**" or "tutorials/animation/**".',
    }),
  ),
});

const emptyParams = Type.Object({});

export function createGodotDocsTools(): ToolDefinition[] {
  return [
    defineTool({
      name: "godot_docs_search",
      label: "Godot docs search",
      description:
        "Search locally imported official Godot documentation (godot-docs .rst). Returns title, summary, snippet, and absPath per hit. For overview questions, summaries often suffice; for API details, read the best classes/class_*.rst with a line limit. Docs must be imported via Settings → Godot. Query with short keywords, not sentences.",
      promptSnippet:
        "godot_docs_search: keyword search docs; use summary for overview, read(class absPath, limit) for API",
      promptGuidelines: [
        "When unsure about Godot APIs, node methods, signals, or editor workflows, call godot_docs_search before answering.",
        "Search tip: query with short keywords / class / method names (1–2 words). Prefer multiple searches over one long sentence.",
        'Good: "AnimationPlayer", "play", "Tween", "signal". Bad: "how to play an animation in Godot".',
        "Overview / which-node questions: prefer hit summaries and class pages; do not skip a top-ranked classes/class_*.rst in favor of best_practices comparison pages.",
        "API / method / property details: call `read` on the best classes/class_*.rst absPath with limit=80–120 (class pages have huge property tables). Do not invent paths under the project cwd or node_modules.",
        "If the first query returns no hits, retry with a single class or method name. Use path_glob (e.g. classes/**) to narrow when needed.",
        "Cite the returned docs URL (or absPath) in your answer.",
        "If search reports docs not imported, tell the user to open Settings → Godot, download the zip, and import it.",
      ],
      parameters: searchParams,
      async execute(_id, params) {
        const prefs = loadPrefs();
        const branch = normalizeGodotDocsBranch(prefs.godotDocsBranch);
        const result = await searchGodotDocs({
          query: params.query,
          branch,
          limit: params.limit,
          pathGlob: params.path_glob,
        });
        return textResult(formatHits(result), result);
      },
    }),
    defineTool({
      name: "godot_docs_status",
      label: "Godot docs status",
      description:
        "Report which Godot docs branch is selected, whether it is imported locally, and the download zip URL.",
      promptSnippet: "godot_docs_status: current docs branch + import state",
      parameters: emptyParams,
      async execute() {
        const prefs = loadPrefs();
        const branch = normalizeGodotDocsBranch(prefs.godotDocsBranch);
        const status = getDocsStatus(branch);
        const text = [
          `Selected branch: ${status.branch}`,
          `Status: ${status.status}`,
          `Cache: ${status.root}`,
          `Download zip: ${status.downloadUrl}`,
          `Site version: ${status.docsSiteVersion}`,
          `Local branches: ${status.localBranches.length ? status.localBranches.join(", ") : "(none)"}`,
        ].join("\n");
        return textResult(text, status);
      },
    }),
  ];
}
