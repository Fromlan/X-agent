/**
 * Wrap `/prompt-name args` as a `<prompt>` block so the transcript can show a
 * compact chip (same idea as Pi's `<skill>` expansion).
 */

export type PromptTemplateSeed = {
  name: string;
  content: string;
};

/** Bash-style args (quoted strings). Mirrors Pi `parseCommandArgs`. */
export function parsePromptArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote: '"' | "'" | null = null;
  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i]!;
    if (inQuote) {
      if (char === inQuote) inQuote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) args.push(current);
  return args;
}

/** Substitute $1 / $@ / ${1:-default} placeholders. Mirrors Pi `substituteArgs`. */
export function substitutePromptArgs(content: string, args: string[]): string {
  const allArgs = args.join(" ");
  return content.replace(
    /\$\{(\d+):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
    (
      _match,
      defaultNum: string | undefined,
      defaultValue: string | undefined,
      sliceStart: string | undefined,
      sliceLength: string | undefined,
      simple: string | undefined,
    ) => {
      if (defaultNum) {
        const index = parseInt(defaultNum, 10) - 1;
        const value = args[index];
        return value ? value : (defaultValue ?? "");
      }
      if (sliceStart) {
        let start = parseInt(sliceStart, 10) - 1;
        if (start < 0) start = 0;
        if (sliceLength) {
          const length = parseInt(sliceLength, 10);
          return args.slice(start, start + length).join(" ");
        }
        return args.slice(start).join(" ");
      }
      if (simple === "ARGUMENTS" || simple === "@") return allArgs;
      const index = parseInt(simple ?? "", 10) - 1;
      return args[index] ?? "";
    },
  );
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * If `text` is `/templateName [args]` matching a known prompt template,
 * return `<prompt name="…">…expanded…</prompt>`. Otherwise null.
 */
export function wrapPromptSlashAsBlock(
  text: string,
  templates: ReadonlyArray<PromptTemplateSeed>,
): string | null {
  if (!text.startsWith("/") || text.startsWith("/skill:")) return null;
  const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const name = match[1] ?? "";
  if (!name) return null;
  const template = templates.find((t) => t.name === name);
  if (!template) return null;

  const argsString = match[2] ?? "";
  const args = parsePromptArgs(argsString);
  const body = substitutePromptArgs(template.content, args).trimEnd();
  const argsTrim = argsString.trim();
  if (argsTrim) {
    return `<prompt name="${name}" args="${escapeAttr(argsTrim)}">\n${body}\n</prompt>`;
  }
  return `<prompt name="${name}">\n${body}\n</prompt>`;
}
