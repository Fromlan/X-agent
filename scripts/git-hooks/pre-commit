#!/usr/bin/env bash
# 提交前硬闸：拦截任何会把 author/committer 写成 Claude Fable / noreply@anthropic.com
# 的 commit。是 AI 工具（旧版本/opencode/Copilot CLI 偶发）会改 .git/config 的
# user.name，造成污染。即使污染一次，重写历史代价也大；这里在 commit 阶段拦。
set -euo pipefail

PROTECTED_NAME="fromlan"
PROTECTED_EMAIL="fromlan@qq.com"
FORBIDDEN_NAME_PATTERN="Claude Fable"
FORBIDDEN_EMAIL_PATTERN="noreply@anthropic.com"

# 1. 检查 git config 是否被污染；如有污染，自动修复到 fromlan（不让失败毁掉流程）。
current_name=$(git config --get user.name || true)
current_email=$(git config --get user.email || true)
need_fix=0
if [ -n "$current_name" ] && echo "$current_name" | grep -q "$FORBIDDEN_NAME_PATTERN"; then
  need_fix=1
fi
if [ -n "$current_email" ] && echo "$current_email" | grep -q "$FORBIDDEN_EMAIL_PATTERN"; then
  need_fix=1
fi
if [ "$need_fix" -eq 1 ]; then
  echo "[commit-author-guard] 检测到 user.name / user.email 被外部工具污染（$current_name <$current_email>），已恢复为 $PROTECTED_NAME <$PROTECTED_EMAIL>。" >&2
  git config --local user.name "$PROTECTED_NAME"
  git config --local user.email "$PROTECTED_EMAIL"
fi

# 2. 校验导出的 author / committer 环境变量（git 在 commit 时读取）。
#    这些变量由 git config --get user.* 解析，config 修好后这里自然就对了。
author_name="${GIT_AUTHOR_NAME:-}"
author_email="${GIT_AUTHOR_EMAIL:-}"
if [ -n "$author_name" ] && echo "$author_name" | grep -q "$FORBIDDEN_NAME_PATTERN"; then
  echo "[commit-author-guard] 拒绝 commit：GIT_AUTHOR_NAME=$author_name 与 $FORBIDDEN_NAME_PATTERN 冲突。" >&2
  exit 1
fi
if [ -n "$author_email" ] && echo "$author_email" | grep -q "$FORBIDDEN_EMAIL_PATTERN"; then
  echo "[commit-author-guard] 拒绝 commit：GIT_AUTHOR_EMAIL=$author_email 与 $FORBIDDEN_EMAIL_PATTERN 冲突。" >&2
  exit 1
fi

# 3. 兜底：如果历史里已有未推的污染 commit（HEAD 仍在本地），打印警告。
#    这条只警告，不阻断——避免 AI 工具已污染后所有 commit 都失败。
if current_sha=$(git rev-parse HEAD 2>/dev/null || true); then
  if [ -n "$current_sha" ] && git cat-file -p "$current_sha" 2>/dev/null | grep -E "^(author|committer) " | grep -qE "$FORBIDDEN_NAME_PATTERN|$FORBIDDEN_EMAIL_PATTERN"; then
    echo "[commit-author-guard] 警告：HEAD 提交已是污染状态（$current_sha 命中 Claude Fable / noreply@anthropic.com）。" >&2
    echo "  修复后请用 'git commit --amend --reset-author' 改写最近一次 / 'git rebase -i HEAD~n' 改历史。" >&2
  fi
fi
