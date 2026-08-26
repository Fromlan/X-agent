/* theme.js — dark / light theme switcher
 * Persists in localStorage; falls back to prefers-color-scheme.
 */

const THEME_KEY = "x-agent-site-theme";

function getInitialTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch (e) {
    /* localStorage unavailable */
  }
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

let currentTheme = getInitialTheme();

function applyTheme(theme) {
  currentTheme = theme === "light" ? "light" : "dark";
  try {
    localStorage.setItem(THEME_KEY, currentTheme);
  } catch (e) {
    /* ignore */
  }
  document.body.setAttribute("data-theme", currentTheme);
  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    btn.setAttribute("aria-pressed", currentTheme === "light" ? "true" : "false");
    btn.setAttribute(
      "aria-label",
      currentTheme === "light"
        ? window.XAgentI18n.t("cta.theme.toggle") + " (light)"
        : window.XAgentI18n.t("cta.theme.toggle") + " (dark)"
    );
    const icon = btn.querySelector(".theme-toggle__icon");
    if (icon) icon.textContent = currentTheme === "light" ? "☀" : "☾";
  });
}

function toggleTheme() {
  applyTheme(currentTheme === "dark" ? "light" : "dark");
}

function initTheme() {
  applyTheme(currentTheme);
}

// React to system theme changes when user hasn't picked one
if (window.matchMedia) {
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  mq.addEventListener("change", (e) => {
    try {
      if (localStorage.getItem(THEME_KEY)) return; // user override wins
    } catch (err) { /* ignore */ }
    applyTheme(e.matches ? "light" : "dark");
  });
}

window.XAgentTheme = { applyTheme, toggleTheme, get currentTheme() { return currentTheme; } };
