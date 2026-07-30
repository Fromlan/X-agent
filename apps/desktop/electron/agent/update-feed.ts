/**
 * Pure helpers for packaged-app update feeds (no Electron imports).
 */
import type { UpdateSource } from "../../shared/ipc";

/** Gitee mirror for China downloads (generic feed under rolling `latest` tag). */
export const GITEE_OWNER = "fromlan";
export const GITEE_REPO = "x-agent";
export const GITEE_LATEST_TAG = "latest";

export const DEFAULT_GITHUB_OWNER = "Fromlan";
export const DEFAULT_GITHUB_REPO = "X-agent";

export type GithubFeed = { owner: string; repo: string };

export function giteeGenericFeedUrl(
  owner = GITEE_OWNER,
  repo = GITEE_REPO,
  tag = GITEE_LATEST_TAG,
): string {
  return `https://gitee.com/${owner}/${repo}/releases/download/${tag}/`;
}

export function parseGithubRepoUrl(url: string): GithubFeed | null {
  const trimmed = url.trim().replace(/\.git$/i, "");
  const https = trimmed.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/i,
  );
  if (https) return { owner: https[1]!, repo: https[2]! };
  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  if (ssh) return { owner: ssh[1]!, repo: ssh[2]! };
  return null;
}

export function feedMessage(
  source: UpdateSource,
  github?: GithubFeed,
): string {
  if (source === "gitee") {
    return `已配置 Gitee 更新源：${GITEE_OWNER}/${GITEE_REPO}`;
  }
  const feed = github ?? {
    owner: DEFAULT_GITHUB_OWNER,
    repo: DEFAULT_GITHUB_REPO,
  };
  return `已配置 GitHub 更新源：${feed.owner}/${feed.repo}`;
}
