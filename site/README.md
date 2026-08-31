# X-agent 站点

X-agent 项目的官方营销站。纯静态、零构建工具、零 npm 依赖。

## 部署状态

- 公网 URL: https://szxyo3odyfh6h.space.mcode.cn
- 部署工具: `website_deploy`
- 站点 node_id: `434928931172693`（in-place 更新必传）
- 最近一次部署: 2026-08-26

## 目录

```
site/
├── index.html           # 单页（5 大区块 + TopBar + Footer）
├── assets/
│   ├── css/
│   │   ├── tokens.css   # v1.1 design tokens（深/浅主题）
│   │   ├── base.css     # reset + 全局
│   │   └── components.css  # Hero / Card / Pill / FAQ / Footer
│   ├── js/
│   │   ├── i18n.js      # 中/英 dict + 切换
│   │   ├── theme.js     # 深/浅主题切换
│   │   └── release.js   # GitHub Releases 版本号 fetch（兜底 v0.5.5）
│   └── img/
│       ├── splash.webp  # 启动屏（来自 docs/screenshots/main-window.png）
│       ├── favicon.webp # 32×32
│       └── og.webp      # 1200×630（Open Graph）
└── README.md
```

## 技术栈

- 纯静态 HTML / CSS / JS，零构建步骤
- CSS 变量直接复用 `apps/desktop` 的 v1.1 design tokens（`--bg-app` / `--bg-card-elev` / `--radius-pill` 等）
- 字体：Google Fonts（Inter + JetBrains Mono），失败回退到 system-ui 栈
- 双语通过 `localStorage` 记忆，主题通过 `localStorage` 记忆（`prefers-color-scheme` 兜底）
- 版本号前端 fetch `https://api.github.com/repos/Fromlan/X-agent/releases/latest`，失败兜底 `v0.5.5`

## 本地预览

```bash
# 任意一种
python -m http.server 8000 --directory D:/UGit/X-agent/site
npx http-server D:/UGit/X-agent/site
```

## 重新部署

```bash
# 单步：传 site/ 到 website_deploy
# 站点 ID: 434928931172693（如要 in-place 更新，传 node_id）
```

## 内容来源

所有文案均从仓库已有 README / CHANGELOG 精选复用，**不写新文案**：

| 区块 | 来源 |
|---|---|
| Hero | `README.md` L8 / `README.en.md` L8 |
| 三大支柱 | `README.md` L62-84 / `README.en.md` L62-84 |
| 4 模式 × 2 类型 | `README.md` L75-84 / `README.en.md` L75-84 |
| 角色场景 | `README.md` L86-100 / `README.en.md` L86-100 |
| 关键能力时间线 | `CHANGELOG.md` 倒序 8 条 |
| FAQ | `README.md` L188-203 / `README.en.md` L188-203 |
| 联系 | `README.md` L250-256 / `README.en.md` L250-256 |

## 后续更新

每次内容/样式变化时：

1. 改 `site/` 下的源文件
2. 重跑 `website_deploy`（可复用 `node_id = 434928931172693` 做 in-place 更新）
3. 不需要构建步骤

## 非目标

- 不做完整文档站（文档仍在 `docs/*.md`，网站只做入口跳转）
- 不绑自定义域名
- 不做 SEO 深度优化（只补基础 meta / Open Graph）
- 不做分析 / 统计
- macOS / Linux 站点差异化（v0.5.5 仅 Windows）
