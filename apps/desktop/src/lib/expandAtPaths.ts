/**
 * Expand `@rel/path` tokens in a composer prompt the way Pi CLI does
 * (`<file name="…">…content…</file>`). Directories and failed reads keep
 * the original `@path` so the model can use tools.
 */

const AT_PATH_RE = /(?<![\w.])@([A-Za-z0-9_./\\-]+)/g;

export function appendAtPath(input: string, relPath: string): string {
  const token = `@${relPath.replace(/\\/g, "/")}`;
  if (!input) return token;
  if (/\s$/.test(input)) return `${input}${token}`;
  return `${input} ${token}`;
}

export async function expandAtPathsInPrompt(text: string): Promise<string> {
  const matches = [...text.matchAll(AT_PATH_RE)];
  if (matches.length === 0) return text;

  const unique = [
    ...new Set(matches.map((m) => m[1].replace(/\\/g, "/"))),
  ];
  const expansions = new Map<string, string | null>();

  await Promise.all(
    unique.map(async (rel) => {
      const res = await window.xAgent.readProjectFile(rel);
      if (res.ok && res.content != null) {
        expansions.set(
          rel,
          `<file name="${rel}">\n${res.content}\n</file>`,
        );
        return;
      }
      // Directory ("不是文件") or other failures: leave @path as-is.
      expansions.set(rel, null);
    }),
  );

  return text.replace(AT_PATH_RE, (full, rawPath: string) => {
    const rel = rawPath.replace(/\\/g, "/");
    return expansions.get(rel) ?? full;
  });
}
