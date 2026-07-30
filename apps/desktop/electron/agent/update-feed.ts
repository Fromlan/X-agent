/**
 * Pure helpers for packaged-app update feeds (no Electron imports).
 */

export const DEFAULT_GITHUB_OWNER = "Fromlan";
export const DEFAULT_GITHUB_REPO = "X-agent";

export type GithubFeed = { owner: string; repo: string };

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

export function feedMessage(github?: GithubFeed): string {
  const feed = github ?? {
    owner: DEFAULT_GITHUB_OWNER,
    repo: DEFAULT_GITHUB_REPO,
  };
  return `已配置 GitHub 更新源：${feed.owner}/${feed.repo}`;
}

/** Browser page for manual download when GitHub auto-update fails or is unsupported. */
export function githubReleasesUrl(github?: GithubFeed): string {
  const feed = github ?? {
    owner: DEFAULT_GITHUB_OWNER,
    repo: DEFAULT_GITHUB_REPO,
  };
  return `https://github.com/${feed.owner}/${feed.repo}/releases`;
}
