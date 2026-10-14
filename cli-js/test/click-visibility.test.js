/**
 * Role/ref clicks and snapshot refs use the same visibility check as text
 * clicks. A nested iframe only needs one extra frame walk.
 */

import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import {
  buildClickExpression,
  buildSnapshotExpression,
  embeddingVisible,
  visibleIn,
} from "../src/tool.js";

function shownStyle(overrides = {}) {
  return {
    display: "block",
    visibility: "visible",
    pointerEvents: "auto",
    opacity: "1",
    ...overrides,
  };
}

function makeDoc(frameElement) {
  const doc = { nodeType: 9, elementFromPoint: () => null };
  const view = {
    document: doc,
    innerWidth: 800,
    innerHeight: 600,
    frameElement: frameElement || null,
    getComputedStyle: (node) => node.__style || shownStyle(),
  };
  doc.defaultView = view;
  return doc;
}

function makeEl(doc, { style, parent, rect } = {}) {
  const el = {
    nodeType: 1,
    tagName: "BUTTON",
    ownerDocument: doc,
    parentElement: parent || null,
    __style: style || shownStyle(),
    children: [],
    getBoundingClientRect: () => rect || { left: 10, top: 10, width: 40, height: 20 },
    checkVisibility: () => true,
    getRootNode: () => doc,
    contains(other) {
      return other === el;
    },
  };
  if (parent) parent.children.push(el);
  return el;
}

test("visibleIn rejects a control under an overlay and a hidden ancestor", () => {
  const doc = makeDoc(null);
  const button = makeEl(doc);
  doc.elementFromPoint = () => button;
  assert.equal(visibleIn(button, true), true);

  const cover = makeEl(doc);
  cover.contains = () => false;
  button.contains = () => false;
  doc.elementFromPoint = () => cover;
  assert.equal(visibleIn(button, true), false);

  const hiddenParent = makeEl(doc, { style: shownStyle({ opacity: "0" }) });
  const covered = makeEl(doc, { parent: hiddenParent });
  doc.elementFromPoint = () => covered;
  assert.equal(visibleIn(covered, true), false);
});

test("a nested hidden iframe fails after one parent-frame check", () => {
  const top = makeDoc(null);
  const outer = makeEl(top, { style: shownStyle({ display: "none" }) });
  const mid = makeDoc(outer);
  const inner = makeEl(mid);
  const innerDoc = makeDoc(inner);
  const button = makeEl(innerDoc);
  innerDoc.elementFromPoint = () => button;
  assert.equal(embeddingVisible(button), false);
  assert.equal(visibleIn(button, embeddingVisible(button)), false);

  outer.__style = shownStyle();
  mid.elementFromPoint = () => inner;
  top.elementFromPoint = () => outer;
  assert.equal(embeddingVisible(button), true);
});

test("snapshot and role clicks share the visibility check", () => {
  const snapshot = buildSnapshotExpression(1000);
  const click = buildClickExpression({ role: "button", name: "Save" });
  assert.match(snapshot, /visible = el => visibleIn\(el, embeddingVisible\(el\)\)/);
  assert.match(click, /visible: \(el\) => visibleIn\(el, embeddingVisible\(el\)\)/);
  assert.equal(click.includes("visible: elementIsVisible"), false);
  new vm.Script(snapshot);
  new vm.Script(click);
});
