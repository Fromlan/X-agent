/* reveal.js — IntersectionObserver-driven scroll reveal + count-up
 * Zero dependencies. Toggles .is-revealed on elements when they enter viewport.
 *
 * Conventions:
 *   [data-reveal]            - element reveals when in view
 *   [data-reveal-up|left|right|scale|down] - direction variant
 *   [data-reveal-delay="N"]  - delay N * --stagger-base (handled in motion.css)
 *   [data-reveal-stagger]    - parent container; direct children stagger by index
 *
 *   [data-count-to="N"]      - count up to N (number) on reveal
 *   [data-count-prefix]      - optional prefix (e.g. "v")
 *   [data-count-suffix]      - optional suffix (e.g. "+")
 *   [data-count-decimals]    - optional decimal places
 *
 * Honors prefers-reduced-motion: all animations skip, final value shown.
 */
(function initReveal() {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Count-up: easeOutQuart
  function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
  }

  function animateCount(el) {
    const target = parseFloat(el.getAttribute("data-count-to"));
    if (isNaN(target)) return;
    const decimals = parseInt(el.getAttribute("data-count-decimals") || "0", 10);
    const prefix = el.getAttribute("data-count-prefix") || "";
    const suffix = el.getAttribute("data-count-suffix") || "";
    const duration = 1200; // ms

    if (reduced || typeof requestAnimationFrame === "undefined") {
      el.textContent = prefix + target.toFixed(decimals) + suffix;
      return;
    }

    const start = performance.now();
    function frame(now) {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      const v = easeOutQuart(t) * target;
      el.textContent = prefix + v.toFixed(decimals) + suffix;
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        el.textContent = prefix + target.toFixed(decimals) + suffix;
      }
    }
    requestAnimationFrame(frame);
  }

  // If reduced motion: just reveal everything immediately
  if (reduced) {
    document.querySelectorAll("[data-reveal], [data-reveal-up], [data-reveal-down], [data-reveal-left], [data-reveal-right], [data-reveal-scale]").forEach((el) => {
      el.classList.add("is-revealed");
    });
    document.querySelectorAll("[data-count-to]").forEach((el) => {
      animateCount(el);
    });
    return;
  }

  // No IntersectionObserver: just show everything
  if (!("IntersectionObserver" in window)) {
    document.querySelectorAll("[data-reveal], [data-reveal-up], [data-reveal-down], [data-reveal-left], [data-reveal-right], [data-reveal-scale]").forEach((el) => {
      el.classList.add("is-revealed");
    });
    document.querySelectorAll("[data-count-to]").forEach((el) => {
      animateCount(el);
    });
    return;
  }

  // Apply stagger to children of [data-reveal-stagger]
  document.querySelectorAll("[data-reveal-stagger]").forEach((parent) => {
    Array.from(parent.children).forEach((child, idx) => {
      if (!child.hasAttribute("data-reveal") &&
          !child.hasAttribute("data-reveal-up") &&
          !child.hasAttribute("data-reveal-left") &&
          !child.hasAttribute("data-reveal-right") &&
          !child.hasAttribute("data-reveal-scale")) {
        child.setAttribute("data-reveal", "");
      }
      // Assign a stagger-delay slot
      const slot = idx < 8 ? String(idx + 1) : "8";
      child.setAttribute("data-reveal-delay", slot);
    });
  });

  const observed = new Set();
  const obs = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !observed.has(entry.target)) {
          observed.add(entry.target);
          entry.target.classList.add("is-revealed");
          // Count-up if present
          if (entry.target.hasAttribute("data-count-to")) {
            animateCount(entry.target);
          }
          // Count-up any nested [data-count-to] within the element
          entry.target.querySelectorAll("[data-count-to]").forEach((el) => {
            if (!observed.has(el)) {
              observed.add(el);
              animateCount(el);
            }
          });
          obs.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.12,
      rootMargin: "0px 0px -8% 0px",
    }
  );

  document
    .querySelectorAll(
      "[data-reveal], [data-reveal-up], [data-reveal-down], [data-reveal-left], [data-reveal-right], [data-reveal-scale]"
    )
    .forEach((el) => obs.observe(el));
})();
