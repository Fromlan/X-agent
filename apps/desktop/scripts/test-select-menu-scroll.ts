import assert from "node:assert/strict";
import {
  isScrollInsidePanel,
  resolveMenuScrollTarget,
  shouldScrollOptionIntoView,
} from "../src/lib/select-menu-scroll.ts";

// --- scrollIntoView policy ---
assert.equal(shouldScrollOptionIntoView("open"), true);
assert.equal(shouldScrollOptionIntoView("keyboard"), true);
assert.equal(
  shouldScrollOptionIntoView("pointer"),
  false,
  "pointer hover must not scrollIntoView (fights wheel scroll)",
);

// --- resolve target: highlighted wins over earlier selected ---
{
  type FakeEl = { id: string; highlighted?: boolean; selected?: boolean };
  const options: FakeEl[] = [
    { id: "selected-top", selected: true },
    { id: "mid" },
    { id: "highlighted-lower", highlighted: true },
  ];

  // Reproduce the buggy combined selector (document-order first match).
  const buggyCombined = options.find((o) => o.highlighted || o.selected);
  assert.equal(
    buggyCombined?.id,
    "selected-top",
    "precondition: comma querySelector would return selected (earlier in DOM)",
  );

  const panel = {
    querySelector(sel: string): FakeEl | null {
      if (sel === '[data-highlighted="true"]') {
        return options.find((o) => o.highlighted) ?? null;
      }
      if (sel === '[aria-selected="true"]') {
        return options.find((o) => o.selected) ?? null;
      }
      return null;
    },
  };

  const target = resolveMenuScrollTarget(panel);
  assert.equal(
    target?.id,
    "highlighted-lower",
    "must prefer highlighted over earlier selected — otherwise scroll bounces to top",
  );
}

{
  type FakeEl = { id: string; highlighted?: boolean; selected?: boolean };
  const options: FakeEl[] = [{ id: "only-selected", selected: true }];
  const panel = {
    querySelector(sel: string): FakeEl | null {
      if (sel === '[data-highlighted="true"]') {
        return options.find((o) => o.highlighted) ?? null;
      }
      if (sel === '[aria-selected="true"]') {
        return options.find((o) => o.selected) ?? null;
      }
      return null;
    },
  };
  assert.equal(resolveMenuScrollTarget(panel)?.id, "only-selected");
}

// --- ignore scrolls that originate inside the panel ---
{
  const panelNode = { id: "panel" };
  const optionNode = { id: "option" };
  const outsideNode = { id: "page" };
  const panel = {
    contains(node: { id: string }) {
      return node === panelNode || node === optionNode;
    },
  };
  assert.equal(isScrollInsidePanel(panel, optionNode), true);
  assert.equal(isScrollInsidePanel(panel, panelNode), true);
  assert.equal(isScrollInsidePanel(panel, outsideNode), false);
  assert.equal(isScrollInsidePanel(null, optionNode), false);
  assert.equal(isScrollInsidePanel(panel, null), false);
}

console.log("test-select-menu-scroll: ok");
