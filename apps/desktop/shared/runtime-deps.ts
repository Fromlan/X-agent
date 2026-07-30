/** Official download pages for runtime deps guided via Ready Checklist / Settings. */

export const NODE_JS_DOWNLOAD_URL = "https://nodejs.org/";

/** Windows shipping target; use when prompting Git for Windows. */
export const GIT_FOR_WINDOWS_DOWNLOAD_URL =
  "https://git-scm.com/download/win";

/** Non-Windows fallback. */
export const GIT_DOWNLOAD_URL = "https://git-scm.com/downloads";

/** Prefer Windows download URL; pass `"darwin"` / `"linux"` for the generic page. */
export function gitDownloadUrl(platform = "win32"): string {
  return platform === "win32"
    ? GIT_FOR_WINDOWS_DOWNLOAD_URL
    : GIT_DOWNLOAD_URL;
}
