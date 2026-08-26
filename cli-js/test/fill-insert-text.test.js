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
  usesAtomicValueAssign,
  dispatchOptionPointer,
  insertTextDelayMs,
  optionIsVisible,
} from "../src/tool.js";

function makeInput({ role = "", value = "", type = "text" } = {}) {
  const events = [];
  const el = {
    tagName: "INPUT",
    type,
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

test("usesAtomicValueAssign covers sanitizing input types", () => {
  assert.equal(usesAtomicValueAssign(makeInput({ type: "date" })), true);
  assert.equal(usesAtomicValueAssign(makeInput({ type: "number" })), true);
  assert.equal(usesAtomicValueAssign(makeInput({ type: "text" })), false);
});

test("typeByInsertText assigns number values atomically so a leading minus survives", async () => {
  const el = makeInput({ type: "number" });
  let stored = "";
  Object.defineProperty(el, "value", {
    configurable: true,
    get() {
      return stored;
    },
    set(next) {
      const s = String(next);
      if (s === "" || /^-?\d+(\.\d+)?$/.test(s)) stored = s;
    },
  });
  await typeByInsertText(el, "-1");
  assert.equal(el.value, "-1");
});

test("typeByInsertText assigns date values atomically", async () => {
  const el = makeInput({ type: "date" });
  let stored = "";
  Object.defineProperty(el, "value", {
    configurable: true,
    get() {
      return stored;
    },
    set(next) {
      const s = String(next);
      if (s === "" || /^\d{4}-\d{2}-\d{2}$/.test(s)) stored = s;
    },
  });
  await typeByInsertText(el, "2026-08-26");
  assert.equal(el.value, "2026-08-26");
});

test("dispatchOptionPointer fires a single click without a native click() follow-up", () => {
  const events = [];
  let nativeClicks = 0;
  const option = {
    dispatchEvent(event) {
      events.push(event && event.type);
      return true;
    },
    click() {
      nativeClicks += 1;
    },
  };
  dispatchOptionPointer(option);
  assert.equal(events.filter((type) => type === "click").length, 1);
  assert.equal(nativeClicks, 0);
});

test("insertTextDelayMs is zero for ordinary text so long fills stay under the relay timeout", () => {
  assert.equal(insertTextDelayMs(makeInput({ type: "text" }), "a".repeat(800)), 0);
});

test("insertTextDelayMs keeps combobox typing under a 20s budget", () => {
  const combo = makeInput({ role: "combobox" });
  assert.equal(insertTextDelayMs(combo, "JFK"), 55);
  const long = "x".repeat(800);
  const delay = insertTextDelayMs(combo, long);
  assert.ok(delay < 55, delay);
  assert.ok(delay * long.length <= 20000, delay * long.length);
});

test("optionIsVisible rejects aria-disabled options", () => {
  const option = {
    getClientRects: () => [{ width: 10, height: 10 }],
    getAttribute: (name) => (name === "aria-disabled" ? "true" : null),
    hidden: false,
  };
  assert.equal(optionIsVisible(option), false);
});
