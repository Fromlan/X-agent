/**
 * Pure helpers for packaged-app update feeds (no Electron imports).
 */
import { readFileSync } from "node:fs";

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

type PackageJsonShape = {
  repository?: string | { url?: string };
  build?: {
    publish?:
      | { provider?: string; owner?: string; repo?: string }
      | Array<{ provider?: string; owner?: string; repo?: string }>;
  };
};

/** Resolve feed from a parsed package.json object. */
export function resolveGithubFeedFromPackageJson(
  raw: PackageJsonShape,
): GithubFeed | null {
  const publish = raw.build?.publish;
  const publishEntry = Array.isArray(publish) ? publish[0] : publish;
  if (
    publishEntry?.provider === "github" &&
    publishEntry.owner &&
    publishEntry.repo
  ) {
    return { owner: publishEntry.owner, repo: publishEntry.repo };
  }
  const repoUrl =
    typeof raw.repository === "string"
      ? raw.repository
      : raw.repository?.url;
  if (repoUrl) {
    return parseGithubRepoUrl(repoUrl);
  }
  return null;
}

/**
 * Try package.json paths in order; fall back to known release repo.
 * `readFile` is injectable for tests (defaults to fs.readFileSync).
 */
export function resolveGithubFeed(
  packageJsonPaths: readonly string[],
  readFile: (path: string) => string = (p) => readFileSync(p, "utf8"),
): GithubFeed {
  for (const path of packageJsonPaths) {
    try {
      const raw = JSON.parse(readFile(path)) as PackageJsonShape;
      const feed = resolveGithubFeedFromPackageJson(raw);
      if (feed) return feed;
    } catch {
      // try next candidate
    }
  }
  return { owner: DEFAULT_GITHUB_OWNER, repo: DEFAULT_GITHUB_REPO };
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
