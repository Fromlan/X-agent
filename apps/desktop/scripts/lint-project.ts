/** Enforce syntax-based safety and process-boundary rules without adding a formatter or changing unrelated files. */
import { parse } from "@babel/parser";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";
const NODE_MODULES = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));

/** Check source AST, ignoring comments and string examples rather than relying on grep. */
export function lintSource(path: string, text: string): string[] {
  const source = parse(text, { sourceType: "module", plugins: ["typescript", ...(path.endsWith(".tsx") ? ["jsx" as const] : [])] });
  const violations: string[] = [];
  const renderer = path.replace(/\\/g, "/").startsWith("src/");
  const report = (node: Record<string, unknown>, rule: string) => {
    const loc = node.loc as { start?: { line: number; column: number } } | undefined;
    violations.push(`${path}:${loc?.start?.line ?? 1}:${(loc?.start?.column ?? 0) + 1} ${rule}`);
  };
  const checkModule = (node: Record<string, unknown>, module: string) => {
    if (renderer && (/^(node:|electron$|@earendil-works\/pi-)/.test(module) || NODE_MODULES.has(module))) report(node, "renderer-process-boundary: use window.xAgent instead of Node/Electron/Pi imports");
  };
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const node = value as Record<string, unknown>;
    if (node.type === "DebuggerStatement") report(node, "no-debugger: production source cannot pause execution");
    const callee = node.callee as { type?: string; name?: string } | undefined;
    if ((node.type === "CallExpression" || node.type === "NewExpression") && callee?.type === "Identifier" && ["eval", "Function"].includes(callee.name ?? "")) report(node, "no-dynamic-code: avoid eval/Function execution");
    const specifier = node.source as { value?: string } | undefined;
    if (node.type === "ImportDeclaration" && typeof specifier?.value === "string") checkModule(node, specifier.value);
    if (node.type === "CallExpression" && (callee?.type === "Import" || callee?.name === "require")) {
      const arg = (node.arguments as { type?: string; value?: string }[])[0];
      if (arg?.type === "StringLiteral" && typeof arg.value === "string") checkModule(node, arg.value);
    }
    for (const [key, child] of Object.entries(node)) if (!["loc", "comments", "tokens"].includes(key)) visit(child);
  };
  visit(source);
  return violations;
}

/** Recursively lint production TypeScript only; test fixtures may intentionally contain prohibited syntax. */
export function lintProject(root: string): string[] {
  const violations: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.tsx?$/.test(entry.name) && !/\.(test|d)\.tsx?$/.test(entry.name)) violations.push(...lintSource(relative(root, path), readFileSync(path, "utf8")));
    }
  };
  for (const directory of ["electron", "shared", "src"]) visit(join(root, directory));
  return violations;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = lintProject(process.cwd());
  if (violations.length) { console.error(violations.join("\n")); process.exitCode = 1; }
  else console.log("lint: AST safety and process-boundary rules passed");
}
