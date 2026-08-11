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
  classifyClickOutcome,
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
    "defaultIsHiddenNode",
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

test("collectElementLabels reads aria-label past a truthy icon glyph", () => {
  // Reproduces the Maps button: <button aria-label="Directions">
  //   <span class="google-symbols" aria-hidden="true"></span>
  // </button>
  const button = el({
    attrs: { "aria-label": "Directions" },
    children: [el({ attrs: { "aria-hidden": "true" }, text: MATERIAL_ICON_GLYPH })],
  });

  const labels = collectElementLabels(button);
  assert.ok(
    labels.includes("directions"),
    `expected aria-label to survive, got ${JSON.stringify(labels)}`
  );
  // The icon glyph must not leak in as a label of its own.
  assert.ok(!labels.includes(MATERIAL_ICON_GLYPH.toLowerCase()));
});

test("collectElementLabels ignores text inside aria-hidden subtrees", () => {
  const button = el({
    attrs: { "aria-label": "Close" },
    children: [el({ attrs: { "aria-hidden": "true" }, text: "decorative" })],
  });
  const labels = collectElementLabels(button);
  assert.ok(labels.includes("close"));
  assert.ok(!labels.includes("decorative"));
});

test("collectElementLabels excludes CSS-hidden descendants", () => {
  // <button><span style="display:none">Delete</span>Edit</button>
  // Collecting "deleteedit" would let a click for "Delete" dispatch Edit.
  const hiddenSpan = el({ text: "Delete" });
  const button = el({
    children: [hiddenSpan, { nodeType: 3, nodeValue: "Edit" }],
  });
  const isHidden = (node) => node === hiddenSpan;

  const labels = collectElementLabels(button, isHidden);
  assert.deepEqual(labels, ["edit"]);
  assert.ok(!labels.some((label) => label.includes("delete")));

  // Without the probe the hidden text would leak in — guards the regression.
  assert.ok(collectElementLabels(button, () => false).includes("deleteedit"));
});

test("collectElementLabels skips subtrees marked with the hidden attribute", () => {
  const button = el({
    children: [el({ attrs: { hidden: "" }, text: "Archive" }), { nodeType: 3, nodeValue: "Reply" }],
  });
  // The stub only answers getAttribute, so give it hasAttribute too.
  button.childNodes[0].hasAttribute = (name) => name === "hidden";
  assert.deepEqual(collectElementLabels(button), ["reply"]);
});

test("collectElementLabels keeps block boundaries as word breaks", () => {
  // <button><div>Save</div><div>Changes</div></button>
  // innerText yields "Save\nChanges"; concatenating text nodes yields
  // "SaveChanges", so a click for the visible label "Save Changes" misses.
  const first = el({ text: "Save" });
  const second = el({ text: "Changes" });
  const button = el({ children: [first, second] });
  const isBlock = (node) => node === first || node === second;

  assert.ok(collectElementLabels(button, () => false, isBlock).includes("save changes"));
  // Inline boundaries must not gain a space: "Save<b>!</b>" is "Save!".
  const bang = el({ text: "!" });
  const inline = el({ children: [{ nodeType: 3, nodeValue: "Save" }, bang] });
  assert.ok(
    collectElementLabels(
      inline,
      () => false,
      () => false
    ).includes("save!")
  );
});

test("collectElementLabels gathers title, value and visible text", () => {
  const link = el({ attrs: { title: "Open map" }, text: "Map" });
  const labels = collectElementLabels(link);
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

test("pickClickCandidate prefers a visible match over a hidden duplicate", () => {
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

test("classifyClickOutcome only fails a click it could not observe", () => {
  // Observed change is always a success, hidden or not.
  assert.deepEqual(classifyClickOutcome({ documentHidden: true, changed: true }), {
    success: true,
    proven: true,
    reason: null,
  });

  // Visible tab got trusted input. Plenty of real clicks change nothing
  // observable (analytics, no-op toggles) — that must not be reported a failure.
  const visibleNoChange = classifyClickOutcome({
    documentHidden: false,
    changed: false,
  });
  assert.equal(visibleNoChange.success, true);
  assert.equal(visibleNoChange.proven, false);
  assert.equal(visibleNoChange.reason, null);

  // Hidden tab with nothing observed: the dispatch ran, only confirmation
  // failed. Reporting failure here is the more dangerous error — a caller that
  // retries can repeat a non-idempotent action silently. Report it as run but
  // unproven, and carry the reason.
  const hiddenNoChange = classifyClickOutcome({
    documentHidden: true,
    changed: false,
  });
  assert.equal(hiddenNoChange.success, true);
  assert.equal(hiddenNoChange.proven, false);
  assert.match(hiddenNoChange.reason, /could not be confirmed/);
  assert.match(hiddenNoChange.reason, /retry/i);

  // Nothing reports failure from this function — only a resolve or dispatch
  // error does, and those never reach here.
  for (const documentHidden of [true, false]) {
    for (const changed of [true, false, null]) {
      assert.equal(
        classifyClickOutcome({ documentHidden, changed }).success,
        true,
        `hidden=${documentHidden} changed=${changed} must not report failure`
      );
    }
  }

  // `proven` still discriminates, which is what a caller should branch on.
  assert.equal(classifyClickOutcome({ documentHidden: true, changed: true }).proven, true);
  assert.equal(classifyClickOutcome({ documentHidden: true, changed: null }).proven, false);
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
