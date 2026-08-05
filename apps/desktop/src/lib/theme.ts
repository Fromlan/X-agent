/**
 * Apply themeId + colorMode to <body data-theme> — single source shared by
 * App boot, prefs changes and workspace session restore.
 */
export function applyTheme(themeId: string, colorMode: string): void {
  document.body.dataset.theme = `${themeId}-${colorMode}`;
}
