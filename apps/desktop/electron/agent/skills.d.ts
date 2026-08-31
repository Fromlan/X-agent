// Vite `?raw` 导入的类型声明 — 用于 build-time 把 .md 文件内联进 bundle。
// 见 `electron/agent/design-builtin-skills.ts` 的 5 条 `SKILL_*_BODY` 导入。
// 同一目录的 `tsconfig.node.json` 会自动 include `electron/**/*.d.ts`。
declare module "*?raw" {
  const content: string;
  export default content;
}
