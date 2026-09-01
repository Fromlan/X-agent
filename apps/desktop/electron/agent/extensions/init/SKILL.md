# X-agent `/init` — Bootstrap AGENTS.md for the current project

X-agent 让你 `/init` 来 bootstrap 当前项目。**目标：在仓库根写一个 `AGENTS.md`，让 X-agent / 任何 AI agent 之后进来都能一眼读懂项目该怎么跑、约定是什么。**

> 一份文件、全 agent 通吃（X-agent / Claude Code / Codex / Cursor / Aider / Devin / Gemini CLI 等都消费 [agents.md](https://agents.md) 标准）。**最高杠杆。**

---

## When to use

- 用户在 composer 输入 `/init` 并回车。
- 系统 prompt 包含 `<bootstrap_check>` 冷启动标记。
- 用户明确说 "init agents.md" / "bootstrap project" / "set up agents for this repo"。

如果工作区不是有意义的 git 仓库、或者没有真实代码，**不要 bootstrap**。直接告诉用户原因。

---

## Bootstrap procedure

### 1. Identify the workspace shape

- 单仓 / monorepo / 父目录包含多个独立 git 仓库。第三种走最末段「多仓异常」。
- 当前 `cwd` 由 X-agent 的 `ExtensionContext.cwd` 给出（handler 已经在 user message 里拼好），**不要自己重新探测**。基于它往下走。

### 2. Inspect the codebase — evidence over guesses

通过 manifest 文件识别生态（**首匹配胜出**）：

| Ecosystem | Manifest | Install / Test / Build 命令 |
|---|---|---|
| Node.js | `package.json` | 读 `scripts.{dev,build,test,lint,typecheck}`；包管理器从 `packageManager` 字段或 `pnpm-lock.yaml` / `yarn.lock` / `package-lock.json` |
| Python | `pyproject.toml` | 读 `[tool.poetry.scripts]` / `[project.scripts]`；或回退 `pytest` / `ruff` / `mypy` |
| Rust | `Cargo.toml` | `cargo build` / `cargo test` / `cargo clippy` / `cargo fmt` |
| Go | `go.mod` | `go build ./...` / `go test ./...` / `go vet ./...` |

其他生态（Java/Maven、Ruby/Bundler、PHP/Composer、…）：用占位符写 AGENTS.md，提示用户填关键命令。

并查看：

- 顶层目录与各自用途
- `.github/workflows/` / `.gitlab-ci.yml` / `.circleci/config.yml` 里的 canonical test invocation
- `.eslintrc*` / `.prettierrc*` / `pyproject.toml [tool.ruff]` / `rustfmt.toml` 找代码风格
- 默认分支：`git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || git config init.defaultBranch || echo main`（offline + 跨 locale 都能跑）

### 3. Generate the root `AGENTS.md`

路径：`<repo-root>/AGENTS.md`。**不要子目录、不要 symlink。** 唯一权威源。

#### 3a. Pre-write check（**必做**）

- **文件不存在** → 直接跳到 3b 写完整模板。
- **文件已存在** → **必须停下，问用户选哪条路**：
  1. **Skip**（默认）—— 保持原样不动。
  2. **Overwrite (with backup)** —— 把当前内容复制到 `AGENTS.md.bak.<unix-ts>`，再写新模板。
  3. **Show diff** —— 打印现有文件 vs 新模板的 unified diff，让用户手挑要保留的部分。

  在用户明确选 1 / 2 / 3 之前，**绝对不要**写或改任何文件。「用户沉默 = 跳过」是兜底，**前提**是真的问过、且用户在同一回合持续沉默 —— 不是你懒得问就默认。

不要发明第 4 条路。不要写「X-agent-managed」块 —— 这文件属于用户。

#### 3b. Template

按 step 2 检测结果填占位符；不适用的章节直接删（如无 TypeScript 就删 `Typecheck`）。**目标 < 80 行。**

```md
# AGENTS.md

<one-line project description — 取自 package.json `description` / Cargo.toml `description` / pyproject `description`，或 README.md 首句>

## Setup commands

- Install deps: `<pnpm install | npm install | poetry install | cargo build | go mod download>`
- Start dev:    `<pnpm dev | npm run dev | uvicorn ... | cargo run | go run ./...>`
- Build:        `<pnpm build | cargo build --release | go build ./...>`
- Test:         `<pnpm test | pytest | cargo test | go test ./...>`
- Lint:         `<pnpm lint | ruff check | cargo clippy | go vet ./...>`
- Typecheck:    `<pnpm typecheck | mypy . | …>`           # 没有就删

## Project layout

<auto-detected 顶层目录，每行一个 + 简短用途>
- `packages/` — workspace packages
- `apps/` — deployable apps
- `scripts/` — repo utility scripts
- `docs/` — long-form documentation

## Code style

<3-5 行总结推断出的约定>
- TypeScript strict mode (`tsconfig.json: strict: true`)
- Prettier: single quotes, 100-char width
- ESLint config: `.eslintrc.js`
- Run `<lint:fix command>` before committing

## Testing instructions

- Unit tests: `<test command>` (<framework, e.g. Vitest / pytest / cargo test>)
- E2E tests:  `<e2e command>` (<Playwright / Cypress / …>)         # 没有就删
- Add tests for every new behavior — see existing `*.test.<ext>` files in the same package
- All tests must pass before opening a PR

## PR & commit conventions

- Branch from `<default-branch>`; never push to it directly
- Commit message: conventional commits (`feat:` / `fix:` / `docs:` / `refactor:`)
- Open PR via `<gh pr create | glab mr create>` once CI is green

## Security

- Never commit secrets — `.env` is in `.gitignore`
- <add any security-policy hints inferred from `SECURITY.md`, `package.json` engines, etc.>
```

### 4. Tell the user

在完成时打印：

1. `AGENTS.md` 是创建、覆盖（附备份路径）、还是跳过。
2. 提醒：**把 AGENTS.md commit 进去** —— 这份文件就是 agent 看到的项目定义。
3. 后续怎么维护：约定 / 命令变更时同步更新；想加独立 helper agent 时用 `create-agent`。

---

## Multi-repo exception

如果工作区是父目录，里面装多个独立 git 仓库：

- 在父目录写一个 `AGENTS.md`，解释每个 repo 是什么、相互关系。
- 每个真实子 repo 单独再 bootstrap 一份自己的本地 `AGENTS.md`。

---

## Guardrails

- AGENTS.md 内容必须**基于项目实际需要**，不是泛模板。
- **不要在 bootstrap 流程里硬塞 `git commit`** —— 提交由用户自己决定时机。
- **不要注入 X-agent-branded 章节**。这文件给所有 agent 看，X-agent 只是其中之一。
- 用 `read` 工具读现有文件、用 `write` 工具写 AGENTS.md / 备份；**不要**用 `bash` 的 `cat > file` / `tee` 等命令直写（重定向在 Plan / Ask 模式会被守卫拦截，且容易误覆盖）。
- 在 Plan / Ask / Goal 模式收到 `/init`：命令本身会触发（extension command 绕开 mode gate），但 `write` 工具会被 Plan guard 拒绝 —— 此时要明确告诉用户「当前模式不允许写文件，请先切到 Agent 模式，或把 `AGENTS.md` 写到允许的目录」。
