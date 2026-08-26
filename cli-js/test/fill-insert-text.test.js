/**
 * Fill/type must fire insertText InputEvents the way Playwright does.
 * Dumping .value + a bare `input` event fails search-as-you-type widgets
 * (gym challenge 20 / point.me comboboxes).
 */

import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import {
  FILL_HELPER_SOURCE,
  dispatchInsertText,
  isComboboxWidget,
  listboxRootForCombobox,
  matchComboboxOption,
  typeByInsertText,
  waitForComboboxOption,
} from "../src/tool.js";

function makeInput({ role = "", value = "" } = {}) {
  const events = [];
  const el = {
    tagName: "INPUT",
    type: "text",
    value,
    isContentEditable: false,
    selectionStart: value.length,
    selectionEnd: value.length,
    getAttribute: (name) => (name === "role" ? role || null : null),
    focus() {},
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
    events,
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
  };
  return el;
}

test("serialized fill helper source is self-contained", () => {
  const context = vm.createContext({ InputEvent: class InputEvent {}, Event: class Event {} });
  vm.runInContext(FILL_HELPER_SOURCE, context);
  assert.equal(typeof context.dispatchInsertText, "function");
  assert.equal(typeof context.typeByInsertText, "function");
  assert.equal(typeof context.isComboboxWidget, "function");
  assert.equal(typeof context.matchComboboxOption, "function");
});

test("dispatchInsertText records inputType insertText and data", () => {
  const el = makeInput();
  dispatchInsertText(el, "J");
  assert.ok(
    el.events.some((event) => event.inputType === "insertText" && event.data === "J"),
    JSON.stringify(el.events)
  );
  assert.equal(el.value, "J");
});

test("typeByInsertText types each character instead of dumping .value", async () => {
  const el = makeInput();
  await typeByInsertText(el, "JFK");
  const inserts = el.events
    .filter((event) => event.type === "input" && event.inputType === "insertText")
    .map((event) => event.data);
  assert.deepEqual(
    inserts.filter((data) => data === "J" || data === "F" || data === "K"),
    ["J", "F", "K"]
  );
  assert.equal(el.value, "JFK");
});

test("isComboboxWidget detects explicit combobox role", () => {
  assert.equal(isComboboxWidget(makeInput({ role: "combobox" })), true);
  assert.equal(isComboboxWidget(makeInput()), false);
  assert.equal(isComboboxWidget({ tagName: "SELECT", getAttribute: () => null }), true);
});

test("matchComboboxOption prefers a text match on role=option", () => {
  const options = [
    { getAttribute: (name) => (name === "role" ? "option" : null), textContent: "BER · Berlin" },
    { getAttribute: (name) => (name === "role" ? "option" : null), textContent: "JFK · New York John F. Kennedy" },
  ];
  const hit = matchComboboxOption(options, "JFK");
  assert.equal(hit.textContent, "JFK · New York John F. Kennedy");
});

test("listboxRootForCombobox uses aria-controls instead of the whole document", () => {
  const owned = { id: "arrival-list" };
  const other = { id: "other-list" };
  const root = {
    getElementById: (id) => (id === "arrival-list" ? owned : id === "other-list" ? other : null),
  };
  const combo = {
    getAttribute: (name) => (name === "aria-controls" ? "arrival-list" : null),
  };
  assert.equal(listboxRootForCombobox(combo, root), owned);
});

test("waitForComboboxOption times out when no option appears", async () => {
  const combo = { getAttribute: () => null };
  const root = { getElementById: () => null, querySelectorAll: () => [] };
  const hit = await waitForComboboxOption(combo, "JFK", { timeoutMs: 30, root });
  assert.equal(hit, null);
});
