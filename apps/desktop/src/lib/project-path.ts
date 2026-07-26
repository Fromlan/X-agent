/** Join project cwd + relative path into an OS-style absolute path (renderer). */
export function joinProjectAbs(cwd: string, relPath: string): string {
  const root = cwd.replace(/[/\\]+$/, "");
  const sep = cwd.includes("\\") ? "\\" : "/";
  if (!relPath) return root;
  return `${root}${sep}${relPath.replace(/\//g, sep)}`;
}
