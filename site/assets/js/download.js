/* Link directly to a published Windows installer when GitHub can provide a verified asset URL. */
(async function resolveInstaller() {
  const platform = navigator.userAgentData?.platform || navigator.platform;
  if (!/^win/i.test(platform)) return;

  try {
    const response = await fetch("https://api.github.com/repos/Fromlan/X-agent/releases/latest", {
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return;
    const release = await response.json();
    const installer = release.assets?.find((asset) => /^X-agent-Setup-[\w.-]+-x64\.exe$/i.test(asset.name));
    if (!installer) return;
    const url = new URL(installer.browser_download_url);
    if (url.origin !== "https://github.com" || !url.pathname.startsWith("/Fromlan/X-agent/releases/download/")) return;

    document.querySelectorAll("[data-version-href]").forEach((link) => {
      link.href = url.href;
      const label = link.querySelector('[data-i18n="cta.downloadWin"]');
      if (label) {
        label.dataset.i18n = "cta.installWin";
        label.textContent = window.XAgentI18n.t("cta.installWin");
      }
    });
  } catch {
    // Leave the available releases link in place for offline or rate-limited requests.
  }
})();
