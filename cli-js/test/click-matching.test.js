/**
 * Click-by-text targeting for Browser Hand current mode.
 *
 * Regression coverage for the Google Maps failure (Aug 2026): icon fonts put a
 * Private Use Area ligature glyph in innerText. That glyph is truthy, so the old
 * `innerText || value || aria-label` chain short-circuited on it and never read
 * the accessible name, and every icon-only control became unclickable.
 *
 * These helpers are embedded verbatim into the in-page expression via
 * toString(), so testing them here tests what actually runs in Chrome.
 *
 * No env vars required.
 */

import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import {
  CLICK_HELPER_SOURCE,
  defaultVisibleText,
  collectElementLabels,
  normalizeLabelText,
  pickClickCandidate,
  scoreLabelMatch,
} from "../src/tool.js";

// Minimal element stub matching the surface collectElementLabels touches.
function el({ attrs = {}, text = "", value = "", children = null }) {
  const node = {
    nodeType: 1,
    getAttribute: (name) =>
      Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null,
    value,
    childNodes: [],
  };
  node.childNodes = children ?? (text ? [{ nodeType: 3, nodeValue: text }] : []);
  return node;
}

const MATERIAL_ICON_GLYPH = String.fromCharCode(58670); // U+E52E, seen on Maps

test("serialized helper source is self-contained", () => {
  // The helpers are shipped into the page as text via fn.toString(). Any name
  // they resolve from module scope in Node — including a default-parameter
  // value — is simply undefined in the page. Running them in a bare VM context
  // reproduces the page's scope, so this fails where a Node-scope test cannot.
  const context = vm.createContext({});
  vm.runInContext(CLICK_HELPER_SOURCE, context);

  const probe = `collectElementLabels({
    nodeType: 1,
    getAttribute: name => (name === 'aria-label' ? 'Save' : null),
    childNodes: [],
  })`;
  // Array.from: the VM realm has its own Array prototype, which strict
  // deep-equality treats as a mismatch.
  assert.deepEqual(Array.from(vm.runInContext(probe, context)), ["save"]);

  // And the pieces the resolver calls by name are all present.
  for (const name of [
    "normalizeLabelText",
    "collectElementLabels",
    "scoreLabelMatch",
    "pickClickCandidate",
    "defaultVisibleText",
  ]) {
    assert.equal(
      vm.runInContext(`typeof ${name}`, context),
      "function",
      `${name} must be serialized into the page`
    );
  }
});

test("normalizeLabelText strips Private Use Area icon glyphs", () => {
  // The exact glyph observed inside <span class="google-symbols" aria-hidden>
  assert.equal(normalizeLabelText(MATERIAL_ICON_GLYPH), "");
  assert.equal(normalizeLabelText(""), "");
  const ZWSP = String.fromCharCode(0x200b);
  const BOM = String.fromCharCode(0xfeff);
  assert.equal(normalizeLabelText(`${ZWSP}Directions${BOM}`), "directions");
  assert.equal(normalizeLabelText(`${MATERIAL_ICON_GLYPH}Directions`), "directions");
  assert.equal(normalizeLabelText("  Get   Directions "), "get directions");
  assert.equal(normalizeLabelText(null), "");
  assert.equal(normalizeLabelText(undefined), "");
});

// Models the real mechanism: innerText reflects which aria-hidden children are
// currently display:none, so hiding them and re-reading is what excludes them.
function buttonWithHidden({ parts }) {
  const nodes = parts.map((part) => ({
    text: part.text,
    hidden: Boolean(part.hidden),
    contains: () => false,
    style: { display: "" },
  }));
  return {
    nodeType: 1,
    getAttribute: () => null,
    querySelectorAll: () => nodes.filter((node) => node.hidden),
    get innerText() {
      return nodes
        .filter((node) => node.style.display !== "none")
        .map((node) => node.text)
        .join(" ");
    },
    __nodes: nodes,
  };
}

test("defaultVisibleText excludes aria-hidden content by hiding and re-reading", () => {
  const button = buttonWithHidden({
    parts: [{ text: "delete", hidden: true }],
  });
  assert.equal(defaultVisibleText(button).trim(), "");
  // Inline styles are restored, so the read leaves no trace.
  assert.deepEqual(
    button.__nodes.map((node) => node.style.display),
    [""]
  );
});

test("defaultVisibleText keeps the visible copy regardless of DOM order", () => {
  // Hidden duplicate AFTER the visible text — the ordering that defeated
  // first-occurrence subtraction ("Delete item Delete" became "item Delete").
  const after = buttonWithHidden({
    parts: [{ text: "Delete item" }, { text: "Delete", hidden: true }],
  });
  assert.equal(defaultVisibleText(after).trim(), "Delete item");

  // And BEFORE it — the ordering that defeated global replacement.
  const before = buttonWithHidden({
    parts: [{ text: "Save", hidden: true }, { text: "Save" }],
  });
  assert.equal(defaultVisibleText(before).trim(), "Save");
});

test("defaultVisibleText leaves elements without aria-hidden children untouched", () => {
  const plain = { innerText: "Save\nChanges", querySelectorAll: () => [] };
  assert.equal(defaultVisibleText(plain), "Save\nChanges");
  assert.equal(defaultVisibleText({ innerText: "x" }), "x");
  assert.equal(defaultVisibleText({}), "");
});

test("collectElementLabels keeps aria-label when aria-hidden text is removed", () => {
  const button = buttonWithHidden({
    parts: [{ text: "delete", hidden: true }],
  });
  button.getAttribute = (name) => (name === "aria-label" ? "Edit" : null);
  const labels = collectElementLabels(button);
  assert.deepEqual(labels, ["edit"]);
  assert.ok(!labels.includes("delete"));
});

test("collectElementLabels uses the browser-rendered text verbatim", () => {
  // innerText semantics (block breaks, <br>, display:none exclusion, <td>/<li>,
  // white-space, text-transform) are the browser's job now — re-deriving them by
  // hand produced a new edge-case bug in three consecutive review rounds. What
  // this module still owns is assembling the label set, so that is what is
  // tested here; the rendered-text semantics are covered on a real page.
  const button = el({ attrs: { "aria-label": "Save" } });
  const labels = collectElementLabels(button, () => "Save\nChanges");
  assert.ok(labels.includes("save changes"), JSON.stringify(labels));
  assert.ok(labels.includes("save"));
});

test("collectElementLabels reads aria-label past a truthy icon glyph", () => {
  // The Google Maps button: innerText is a Private Use Area ligature glyph,
  // which is truthy, so `innerText || value || aria-label` never reached the
  // accessible name. An array plus PUA stripping is what fixes it.
  const button = el({ attrs: { "aria-label": "Directions" } });
  const labels = collectElementLabels(button, () => MATERIAL_ICON_GLYPH);
  assert.deepEqual(labels, ["directions"]);
});

test("collectElementLabels gathers title, value and visible text", () => {
  const link = el({ attrs: { title: "Open map" } });
  const labels = collectElementLabels(link, () => "Map");
  assert.ok(labels.includes("open map"));
  assert.ok(labels.includes("map"));

  const submit = el({ attrs: { type: "submit" }, value: "Send" });
  assert.ok(collectElementLabels(submit).includes("send"));
});

test("scoreLabelMatch tiers exact above prefix above substring", () => {
  assert.equal(scoreLabelMatch(["search"], "search"), 3);
  assert.equal(scoreLabelMatch(["search this area"], "search"), 2);
  assert.equal(scoreLabelMatch(["go search now"], "search"), 1);
  assert.equal(scoreLabelMatch(["directions"], "search"), 0);
  assert.equal(scoreLabelMatch([], "search"), 0);
});

test("pickClickCandidate prefers an exact match over an earlier substring match", () => {
  // The reported Maps symptom: "Search" also matches "Search this area".
  const picked = pickClickCandidate(
    [
      { labels: ["search this area"], visible: true, area: 100 },
      { labels: ["search"], visible: true, area: 100 },
    ],
    "search"
  );
  assert.equal(picked.best.index, 1);
  assert.equal(picked.best.score, 3);
  assert.equal(picked.candidateCount, 2);
});

test("pickClickCandidate prefers a visible match at the SAME score", () => {
  const picked = pickClickCandidate(
    [
      { labels: ["directions"], visible: false, area: 0 },
      { labels: ["directions"], visible: true, area: 2592 },
    ],
    "directions"
  );
  assert.equal(picked.best.index, 1);
  assert.equal(picked.best.visible, true);
});

test("score outranks visibility, so a visible partial cannot beat a hidden exact", () => {
  // "Delete" against a hidden exact and a visible prefix match. Picking the
  // visible one dispatches a broader, destructive action the caller did not ask
  // for; wrong-action is worse than no-action.
  const picked = pickClickCandidate(
    [
      { labels: ["delete all archived items"], visible: true, area: 100 },
      { labels: ["delete"], visible: false, area: 100 },
    ],
    "delete"
  );
  assert.equal(picked.best.index, 1);
  assert.equal(picked.best.score, 3);
  assert.equal(picked.best.visible, false);
});

test("pickClickCandidate breaks ties on smallest area, then DOM order", () => {
  const picked = pickClickCandidate(
    [
      { labels: ["submit"], visible: true, area: 9000 },
      { labels: ["submit"], visible: true, area: 120 },
    ],
    "submit"
  );
  assert.equal(picked.best.index, 1);

  const tie = pickClickCandidate(
    [
      { labels: ["submit"], visible: true, area: 120 },
      { labels: ["submit"], visible: true, area: 120 },
    ],
    "submit"
  );
  assert.equal(tie.best.index, 0);
});

test("pickClickCandidate exposes the full ranked set, not just three runners-up", () => {
  // The aria-hidden correction pass walks this list, so truncating it at four
  // made a genuine candidate unreachable behind decoys that matched only on
  // hidden text.
  const many = Array.from({ length: 9 }, () => ({
    labels: ["confirm"],
    visible: true,
    area: 100,
  }));
  const picked = pickClickCandidate(many, "confirm");
  assert.equal(picked.candidateCount, 9);
  assert.equal(picked.ranked.length, 9);
  assert.equal(picked.runnersUp.length, 3, "runnersUp stays a reporting slice");
  assert.deepEqual(
    picked.ranked.map((item) => item.index),
    [0, 1, 2, 3, 4, 5, 6, 7, 8]
  );
});

test("pickClickCandidate reports no match and surfaces runners-up", () => {
  assert.equal(pickClickCandidate([], "search"), null);
  assert.equal(pickClickCandidate([{ labels: ["home"], visible: true, area: 10 }], "search"), null);

  const picked = pickClickCandidate(
    [
      { labels: ["search"], visible: true, area: 10 },
      { labels: ["search this area"], visible: true, area: 10 },
      { labels: ["search nearby"], visible: true, area: 10 },
    ],
    "search"
  );
  assert.equal(picked.candidateCount, 3);
  assert.equal(picked.runnersUp.length, 2);
  assert.deepEqual(
    picked.runnersUp.map((item) => item.labels[0]),
    ["search this area", "search nearby"]
  );
});

test("icon-only control still loses to an exact text match", () => {
  // An aria-label-only icon button must match, but must not outrank an exact hit.
  const picked = pickClickCandidate(
    [
      { labels: ["directions to here"], visible: true, area: 50 },
      { labels: ["directions"], visible: true, area: 2592 },
    ],
    "directions"
  );
  assert.equal(picked.best.index, 1);
  assert.equal(picked.best.score, 3);
});
