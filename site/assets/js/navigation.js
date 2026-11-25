/* Keep the narrow navigation native and return keyboard focus on dismissal. */
const sections = document.querySelector(".topbar__sections");
const sectionsTrigger = sections.querySelector("summary");

sections.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !sections.open) return;
  event.preventDefault();
  sections.open = false;
  sectionsTrigger.focus();
});

sections.addEventListener("click", (event) => {
  const link = event.target.closest("a[href^='#']");
  if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  sections.open = false;
  const target = document.getElementById(link.hash.slice(1));
  if (!target) return;
  target.tabIndex = -1;
  target.focus({ preventScroll: true });
});

document.addEventListener("click", (event) => {
  if (sections.open && !sections.contains(event.target)) sections.open = false;
});

sections.addEventListener("focusout", (event) => {
  if (sections.open && event.relatedTarget && !sections.contains(event.relatedTarget)) sections.open = false;
});
