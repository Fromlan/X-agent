# X-agent 静态站点

`site/` 是纯静态 HTML / CSS / JavaScript 页面，没有 npm 依赖或构建步骤。部署时保留整个目录结构。

## 源文件

| 位置 | 内容 |
|---|---|
| `index.html` | 页面结构、默认中文文案与入口链接 |
| `assets/css/` | 站点自己的主题 token、布局、组件和动效 |
| `assets/js/i18n.js` | 中英文文案与语言切换 |
| `assets/js/theme.js` | 深浅主题切换与本地偏好 |
| `assets/js/release.js` | 从 GitHub Releases 读取版本和下载地址 |
| `assets/js/reveal.js` | 页面滚动展示动效 |
| `assets/img/` | 图标、图片与站点素材 |

桌面应用与站点的 CSS 分别维护，修改桌面主题不会自动更新站点。

## 维护与预览

在仓库根目录通过任意静态 HTTP 服务器预览 `site/`，部署前检查中英文、主题切换、下载链接与窄窗口布局。

用户能力与操作说明以 [README.md](../README.md) / [README.en.md](../README.en.md) 为准，版本记录以 [CHANGELOG.md](../CHANGELOG.md) 为准。引用章节主题，不依赖会变化的 README 行号。

页面时间线、双语文案和静态图片不会随应用发版自动更新；`release.js` 只负责版本和下载信息，失败时使用源码中的兜底值。发布前核对静态内容，不能将其视为最新能力清单。

历史部署工具、站点编号和部署日期不作为当前部署契约。重新部署时在实际使用的托管平台核对目标，避免依据旧编号覆盖其他站点。
