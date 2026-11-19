/**
 * `type` must confirm the text is in the field (#89). A session could click
 * fields but not type into them, and type reported success either way. These
 * tests drive typeIntoControl and the page expression against fields that
 * accept synthetic input, a React-style controlled input, editors that ignore
 * synthetic events, and a field that rejects everything.
 */

import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { normalizeSteps } from "../src/agent-contract.js";
import { buildTypeExpression, typeIntoControl, typeStepText } from "../src/tool.js";

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}

function makeDoc() {
  const doc = {
    execLog: [],
    activeElement: null,
    execCommand(command, _ui, value) {
      doc.execLog.push(command);
      const el = doc.activeElement;
      if (!el || typeof el.nativeInsert !== "function") return false;
      return el.nativeInsert(command === "insertText" ? String(value) : "");
    },
    createRange: () => ({ selectNodeContents() {} }),
    defaultView: { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) },
  };
  return doc;
}

/**
 * onInput runs on every synthetic input event. nativeInsert is what the
 * browser's editing path (execCommand) does: it replaces the selection.
 */
function makeInput(doc, { type = "text", role = "", value = "", onInput, editable = false } = {}) {
  const el = {
    tagName: editable ? "DIV" : "INPUT",
    type: editable ? undefined : type,
    value: editable ? undefined : value,
    textContent: editable ? value : undefined,
    isContentEditable: editable,
    selectionStart: value.length,
    selectionEnd: value.length,
    ownerDocument: doc,
    events: [],
    getAttribute: (name) => (name === "role" ? role || null : null),
    focus() {
      doc.activeElement = el;
    },
    select() {
      el.selectionStart = 0;
      el.selectionEnd = String(el.value || "").length;
    },
    setSelectionRange(start, end) {
      el.selectionStart = start;
      el.selectionEnd = end;
    },
    dispatchEvent(event) {
      el.events.push(event);
      if (event.type === "input" && onInput) onInput(el, event);
      return true;
    },
    nativeInsert(str) {
      if (editable) el.textContent = str;
      else el.value = str;
      el.nativeInserted = true;
      return true;
    },
  };
  return el;
}

test("plain input: per-character insertText sticks and is verified", async () => {
  const doc = makeDoc();
  const el = makeInput(doc);
  const out = await typeIntoControl(el, "hello@example.com");
  assert.equal(out.stuck, true);
  assert.deepEqual(out.attempts, ["insertText"]);
  assert.equal(el.value, "hello@example.com");
  assert.equal(doc.execLog.length, 0, "no execCommand when insertText already stuck");
});

test("React-style controlled input keeps the value once its tracker sees the change", async () => {
  const doc = makeDoc();
  let state = "";
  const tracker = { value: "", setValue(v) { this.value = v; }, getValue() { return this.value; } };
  const el = makeInput(doc, {
    onInput(node) {
      // React compares the tracker to the DOM; no difference means no onChange,
      // and the re-render restores the controlled value.
      if (tracker.getValue() === node.value) node.value = state;
      else {
        state = node.value;
        tracker.setValue(node.value);
      }
    },
  });
  el._valueTracker = tracker;
  const out = await typeIntoControl(el, "Jack");
  assert.equal(out.stuck, true, JSON.stringify(out));
  assert.equal(state, "Jack");
});

test("an input that reverts synthetic events falls back to execCommand insertText", async () => {
  const doc = makeDoc();
  const el = makeInput(doc, {
    onInput(node) {
      if (!node.nativeInserted) node.value = "";
    },
  });
  const out = await typeIntoControl(el, "search terms");
  assert.equal(out.stuck, true, JSON.stringify(out));
  assert.deepEqual(out.attempts, ["insertText", "execCommand"]);
  assert.equal(el.value, "search terms");
});

test("contenteditable rich editor goes through execCommand first", async () => {
  const doc = makeDoc();
  const el = makeInput(doc, {
    editable: true,
    onInput(node) {
      // The editor re-renders from its model; raw textContent writes vanish.
      if (!node.nativeInserted) node.textContent = "";
    },
  });
  const out = await typeIntoControl(el, "Hi Jack");
  assert.equal(out.mode, "contenteditable");
  assert.equal(out.stuck, true, JSON.stringify(out));
  assert.deepEqual(out.attempts, ["execCommand"]);
  assert.equal(el.textContent, "Hi Jack");
});

test("a field that rejects every write reports stuck:false with what it holds", async () => {
  const doc = makeDoc();
  const el = makeInput(doc, {
    onInput(node) {
      node.value = "";
    },
  });
  el.nativeInsert = () => false;
  const out = await typeIntoControl(el, "nope");
  assert.equal(out.stuck, false);
  assert.equal(out.actual, "");
});

test("a change handler that clears the field makes type fail", async () => {
  const doc = makeDoc();
  const el = makeInput(doc);
  const dispatch = el.dispatchEvent;
  el.dispatchEvent = (event) => {
    dispatch(event);
    if (event.type === "change") el.value = "";
    return true;
  };
  const out = await typeIntoControl(el, "gone on change");
  assert.equal(out.stuck, false);
  assert.equal(out.actual, "");
});

test("inline autocomplete that extends the typed text still counts as typed", async () => {
  const doc = makeDoc();
  const el = makeInput(doc, {
    role: "combobox",
    onInput(node) {
      if (node.value === "New") node.value = "New York";
    },
  });
  const out = await typeIntoControl(el, "New");
  assert.equal(out.stuck, true, JSON.stringify(out));
});

test("type expression compiles for every target form", () => {
  for (const args of [
    { ref: "e4", text: "x" },
    { selector: "#email", text: "x" },
    { label: "Email", text: "x" },
    { text: "x" },
  ]) {
    assert.doesNotThrow(() => new vm.Script(buildTypeExpression(args)), JSON.stringify(args));
  }
});

function runTypeExpression(args, { active, extra = {} } = {}) {
  const doc = makeDoc();
  const el = active(doc);
  doc.activeElement = el;
  Object.assign(doc, {
    body: { tagName: "BODY" },
    title: "Fixture",
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  el.getRootNode = () => doc;
  const context = vm.createContext({
    document: doc,
    window: { getComputedStyle: () => ({ display: "block", visibility: "visible" }) },
    location: { href: "http://127.0.0.1/fixture" },
    Event: FakeEvent,
    InputEvent: FakeEvent,
    setTimeout,
    ...extra,
  });
  return vm.runInContext(buildTypeExpression(args), context);
}

test("with no target, type writes into the focused field and verifies it", async () => {
  const out = await runTypeExpression({ text: "after a click" }, { active: (doc) => makeInput(doc) });
  assert.equal(out.success, true, JSON.stringify(out));
  assert.equal(out.matchedBy, "focused");
  assert.equal(out.field.tag, "input");
});

test("a rejected write returns success:false with lengths, never the field contents", async () => {
  const out = await runTypeExpression(
    { text: "secret-ish" },
    {
      active: (doc) => {
        const el = makeInput(doc, {
          type: "password",
          value: "old value",
          onInput(node) {
            node.value = "old value";
          },
        });
        el.nativeInsert = () => false;
        return el;
      },
    }
  );
  assert.equal(out.success, false);
  assert.match(out.error, /did not stick/);
  assert.equal(out.expectedLength, "secret-ish".length);
  assert.equal(out.actualLength, "old value".length);
  assert.equal(JSON.stringify(out).includes("old value"), false);
});

test("no focused field gives a clear next step instead of typing somewhere else", async () => {
  const out = await runTypeExpression(
    { text: "x" },
    { active: () => ({ tagName: "BODY", getAttribute: () => null }) }
  );
  assert.equal(out.success, false);
  assert.match(out.error, /No text field has focus/);
});

test("a type step written with value types that value, not an empty string", () => {
  const [step] = normalizeSteps([{ op: "type", ref: "e3", value: "Jack" }]);
  assert.equal(typeStepText(step), "Jack");
  assert.equal(typeStepText({ text: "", value: "ignored" }), "", "explicit empty text wins");
  assert.throws(() => normalizeSteps([{ op: "type", ref: "e3" }]), /type requires text/);
});
