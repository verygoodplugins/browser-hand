/**
 * Fill-key matching. A short id must not steal a longer key, and a miss
 * (no control, or a write that does not stick) fails the command.
 */

import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import {
  FILL_MATCH_HELPER_SOURCE,
  buildFillFieldsExpression,
  collectFillLabels,
  fillFieldsSucceeded,
  fillValueStuck,
  normalizeFillKey,
  pickFillCandidate,
} from "../src/tool.js";

function control({ id = "", name = "", labelText = "", attrs = {} } = {}) {
  return {
    id,
    labels: labelText ? [{ innerText: labelText, textContent: labelText }] : [],
    getAttribute(attr) {
      if (attr === "name") return name || null;
      return Object.prototype.hasOwnProperty.call(attrs, attr) ? attrs[attr] : null;
    },
  };
}

test("Name prefers the visible label over a shorter id or name", () => {
  const candidates = [
    control({ id: "n" }),
    control({ name: "na" }),
    control({ name: "fullName", labelText: "Name" }),
  ].map((el) => ({ labels: collectFillLabels(el, null) }));
  const picked = pickFillCandidate(candidates, "Name");
  assert.equal(picked.index, 2);
  assert.equal(picked.score, 3);
  assert.deepEqual(candidates[0].labels, ["n"]);
  assert.deepEqual(candidates[1].labels, ["na"]);
  assert.ok(candidates[2].labels.includes("name"));
  assert.ok(candidates[2].labels.includes("fullname"));
});

test("Name does not match a control whose only token is n", () => {
  const picked = pickFillCandidate(
    [{ labels: collectFillLabels(control({ id: "n" }), null) }],
    "Name"
  );
  assert.equal(picked, null);
});

test("Last name does not fill a field labeled first name", () => {
  const picked = pickFillCandidate([{ labels: ["first name"] }], "Last name");
  assert.equal(picked, null);
});

test("Company name matches a broken for= label and prefers company over name", () => {
  const label = { tagName: "LABEL", innerText: "Company name", htmlFor: "missing-id" };
  const company = {
    id: "company",
    previousElementSibling: label,
    labels: [],
    closest: () => null,
    getAttribute: (attr) => (attr === "name" ? "company" : null),
  };
  const labels = collectFillLabels(company, { querySelectorAll: () => [] });
  assert.ok(labels.includes("company name"));
  const picked = pickFillCandidate(
    [{ labels: ["name"] }, { labels: collectFillLabels({ id: "company", getAttribute: (attr) => (attr === "name" ? "company" : null), labels: [] }, null) }],
    "Company name"
  );
  assert.equal(picked.index, 1);
  assert.equal(picked.score, 1);
});

test("Name matches name fullName when that is the only candidate", () => {
  const picked = pickFillCandidate(
    [{ labels: collectFillLabels(control({ name: "fullName" }), null) }],
    "Name"
  );
  assert.equal(picked.index, 0);
  assert.equal(picked.score, 1);
});

test("pickFillCandidate breaks score ties by DOM order", () => {
  const picked = pickFillCandidate([{ labels: ["fullname"] }, { labels: ["fullname"] }], "Name");
  assert.equal(picked.index, 0);
  assert.equal(picked.score, 1);
});

test("collectFillLabels reads the visible label, aria text, placeholder, name, and id", () => {
  const label = { innerText: "Name", htmlFor: "person" };
  const heading = { innerText: "Legal name", textContent: "Legal name" };
  const root = {
    querySelectorAll: (sel) => (sel === "label" ? [label] : []),
    getElementById: (id) => (id === "legal-name" ? heading : null),
  };
  const el = {
    id: "person",
    labels: [{ innerText: "Name" }],
    closest: () => null,
    getAttribute: (attr) => {
      if (attr === "aria-labelledby") return "legal-name";
      if (attr === "aria-label") return "Given name";
      if (attr === "placeholder") return "First";
      if (attr === "name") return "fullName";
      return null;
    },
  };
  const labels = collectFillLabels(el, root);
  assert.ok(labels.includes("name"));
  assert.ok(labels.includes("legal name"));
  assert.ok(labels.includes("given name"));
  assert.ok(labels.includes("first"));
  assert.ok(labels.includes("fullname"));
  assert.ok(labels.includes("person"));
});

test("a missed Name field fails the command", () => {
  assert.equal(fillFieldsSucceeded({ failed: [] }), true);
  assert.equal(
    fillFieldsSucceeded({ failed: [{ label: "Name", reason: "field not found" }] }),
    false
  );
  assert.equal(fillFieldsSucceeded(null), false);
  assert.equal(fillFieldsSucceeded(undefined), false);
  assert.equal(fillFieldsSucceeded("nope"), false);
  assert.equal(fillFieldsSucceeded({ filled: ["Name"] }), false);
});

test("fillValueStuck reads a text input back", () => {
  assert.equal(fillValueStuck({ value: "Ada" }, "Ada"), true);
  assert.equal(fillValueStuck({ value: "" }, "Ada"), false);
  assert.equal(fillValueStuck({ value: "" }, null), true);
  assert.equal(fillValueStuck({ value: "(555) 123-4567", type: "tel" }, "5551234567"), true);
  assert.equal(fillValueStuck({ value: "(555) 123-4567" }, "5551234567"), false);
  assert.equal(fillValueStuck({ value: "ab" }, "a-b"), false);
  assert.equal(fillValueStuck({ value: "555" }, "5551234567"), false);
  assert.equal(fillValueStuck({ value: "" }, "-"), false);
  assert.equal(fillValueStuck({ value: "大阪" }, "東京"), false);
  assert.equal(fillValueStuck({ value: "東京" }, "東京"), true);
  assert.equal(fillValueStuck({ value: "Ada Lovelace" }, "Ada"), false);
  assert.notEqual(normalizeFillKey("東京1"), normalizeFillKey("大阪1"));
  assert.equal(
    fillValueStuck(
      { tagName: "SELECT", selectedOptions: [{ value: "大阪", text: "大阪" }] },
      "東京",
      "select"
    ),
    false
  );
  assert.equal(
    fillValueStuck(
      { tagName: "SELECT", selectedOptions: [{ value: "東京", text: "東京" }] },
      "東京",
      "select"
    ),
    true
  );
  assert.equal(
    fillValueStuck(
      { tagName: "SELECT", selectedOptions: [{ value: "大阪1", text: "大阪1" }] },
      "東京1",
      "select"
    ),
    false
  );
});

test("fillValueStuck follows checkbox, radio, select, contenteditable, and combobox", () => {
  assert.equal(fillValueStuck({ type: "checkbox", checked: true }, "yes", "checkbox"), true);
  assert.equal(fillValueStuck({ type: "checkbox", checked: false }, "yes", "checkbox"), false);
  assert.equal(fillValueStuck({ type: "radio", checked: true }, "x", "radio"), true);
  assert.equal(fillValueStuck({ type: "radio", checked: false }, "x", "radio"), false);
  assert.equal(
    fillValueStuck(
      { tagName: "SELECT", selectedOptions: [{ value: "ny", text: "New York" }] },
      "York",
      "select"
    ),
    true
  );
  assert.equal(
    fillValueStuck(
      { tagName: "SELECT", selectedOptions: [{ value: "n", text: "N" }] },
      "Name",
      "select"
    ),
    false
  );
  assert.equal(fillValueStuck({ isContentEditable: true, textContent: "Ada" }, "Ada", "text"), true);
  assert.equal(fillValueStuck({ isContentEditable: true, textContent: "" }, "Ada", "text"), false);
  const option = { textContent: "JFK · New York John F. Kennedy", getAttribute: () => null };
  assert.equal(
    fillValueStuck(
      { value: "JFK", getAttribute: (name) => (name === "aria-expanded" ? "true" : null) },
      "JFK",
      { mode: "combobox", option }
    ),
    false
  );
  assert.equal(
    fillValueStuck(
      { value: "JFK", getAttribute: (name) => (name === "aria-expanded" ? "false" : null) },
      "JFK",
      { mode: "combobox", option }
    ),
    true
  );
  assert.equal(
    fillValueStuck({ value: "JFK · New York John F. Kennedy", getAttribute: () => null }, "JFK", {
      mode: "combobox",
      option,
    }),
    true
  );
  assert.equal(fillValueStuck({ value: "", textContent: "" }, "JFK", "combobox"), false);
  assert.equal(
    fillValueStuck(
      { value: "東京", getAttribute: (name) => (name === "aria-expanded" ? "false" : null) },
      "東京",
      { mode: "combobox", option: { textContent: "東京", getAttribute: () => null } }
    ),
    true
  );
  assert.equal(
    fillValueStuck(
      {
        value: "New York",
        getAttribute: (name) => (name === "aria-expanded" ? "false" : null),
      },
      "New York",
      {
        mode: "combobox",
        option: { textContent: "JFK · New York John F. Kennedy", getAttribute: () => null },
      }
    ),
    true
  );
});

test("fill expression serializes match helpers and drops reverse substring", () => {
  const src = buildFillFieldsExpression({ Name: "Ada" });
  for (const name of [
    "normalizeFillKey",
    "collectFillLabels",
    "pickFillCandidate",
    "fillValueStuck",
    "scoreLabelMatch",
  ]) {
    assert.match(src, new RegExp(`function ${name}`));
  }
  assert.doesNotMatch(src, /wanted\.includes/);
  assert.match(src, /field not found/);
  assert.match(src, /value did not stick/);
});

test("serialized fill match helpers are self-contained", () => {
  const context = vm.createContext({});
  vm.runInContext(FILL_MATCH_HELPER_SOURCE, context);
  const picked = vm.runInContext(
    `pickFillCandidate([{ labels: collectFillLabels({ id: "n", getAttribute: () => null }, null) }, { labels: ["name", "fullname"] }], "Name")`,
    context
  );
  assert.equal(picked.index, 1);
  assert.equal(picked.score, 3);
  assert.equal(
    vm.runInContext(
      `fillValueStuck({ isContentEditable: true, textContent: "Ada" }, "Ada", "text")`,
      context
    ),
    true
  );
  assert.equal(vm.runInContext(`fillValueStuck({ value: "" }, "Ada", "text")`, context), false);
});
