/**
 * Form summaries for snapshot. Agents were clicking nav menuitems because the
 * flat controls list did not say which nodes were fields. summarizeSnapshotForms
 * is injected into the page expression via toString(), so these tests are the
 * page behavior.
 */

import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import {
  buildSnapshotExpression,
  collectSnapshotForms,
  snapshotControlRegion,
  summarizeSnapshotForms,
} from "../src/tool.js";

function matches(el, sel) {
  if (sel === "*") return true;
  const m = String(sel)
    .trim()
    .match(/^([a-zA-Z0-9_-]*)(?:\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\])?$/);
  if (!m) return false;
  const [, tag, attr, value] = m;
  if (!tag && !attr) return false;
  if (tag && String(el.tagName || "").toLowerCase() !== tag.toLowerCase()) return false;
  if (attr) {
    const got = el.getAttribute(attr);
    if (got == null || got === "") return false;
    if (value !== undefined && got !== value) return false;
  }
  return true;
}

function selectorList(el, sel) {
  return String(sel)
    .split(",")
    .some((part) => matches(el, part.trim()));
}

function h(tag, props = {}, kids = []) {
  const attrs = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === "id" || key === "text") continue;
    if (key === "for") {
      attrs.for = value;
      continue;
    }
    attrs[key] = value;
  }
  const el = {
    tagName: String(tag).toUpperCase(),
    id: props.id || "",
    type: props.type || "",
    name: props.name || "",
    innerText: props.text || "",
    htmlFor: props.for || "",
    attrs,
    children: kids,
    parent: null,
  };
  el.getAttribute = (name) =>
    Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null;
  el.closest = (sel) => {
    let node = el;
    while (node) {
      if (selectorList(node, sel)) return node;
      node = node.parent || null;
    }
    return null;
  };
  el.querySelectorAll = (sel) => {
    const out = [];
    const walk = (node) => {
      for (const child of node.children || []) {
        if (selectorList(child, sel)) out.push(child);
        walk(child);
      }
    };
    walk(el);
    return out;
  };
  for (const kid of kids) kid.parent = el;
  return el;
}

test("lists labeled form fields, an orphan input, and skips nav and hidden inputs", () => {
  const name = h("input", { id: "full-name", name: "fullName", type: "text" });
  const form = h("form", { id: "profile", name: "profile", action: "/save" }, [
    h("label", { for: "full-name", text: "Name" }),
    name,
    h("input", { type: "hidden", name: "csrf" }),
    h("input", { type: "submit", name: "go" }),
  ]);
  const hiddenOnly = h("form", { id: "token", name: "token", action: "/token" }, [
    h("input", { type: "hidden", name: "t" }),
  ]);
  const orphan = h("input", { id: "city", name: "city", type: "text", "aria-label": "City" });
  const root = h("div", {}, [
    h("nav", {}, [h("div", { role: "menuitem", name: "productsMenu", text: "Products" })]),
    form,
    hiddenOnly,
    orphan,
  ]);

  const forms = summarizeSnapshotForms(root, () => true);

  assert.deepEqual(forms, [
    {
      id: "profile",
      name: "profile",
      action: "/save",
      fields: [{ label: "Name", type: "text", name: "fullName", id: "full-name" }],
    },
    {
      id: "",
      name: "",
      action: "",
      orphan: true,
      fields: [{ label: "City", type: "text", name: "city", id: "city" }],
    },
  ]);
  const labels = forms.flatMap((entry) => entry.fields.map((field) => field.label));
  assert.equal(labels.some((label) => label.includes("Products")), false);
  assert.equal(JSON.stringify(forms).includes("csrf"), false);
});

test("uses tag name when type is empty and prefers label[for], wrapping label, aria-label, placeholder", () => {
  const bio = h("textarea", { id: "bio", name: "bio" });
  const note = h("div", { contenteditable: "true", "aria-label": "Note" });
  const box = h("span", { role: "textbox", name: "box", placeholder: "Box" });
  const root = h("div", {}, [
    h("form", { id: "extra", name: "extra", action: "/e" }, [
      h("label", { for: "bio", text: "Biography" }, [bio]),
      h("select", { name: "color", "aria-label": "Color" }),
      h("input", { type: "email", name: "email", placeholder: "Email" }),
      note,
      box,
    ]),
  ]);

  const forms = summarizeSnapshotForms(root, () => true);
  assert.deepEqual(forms[0].fields, [
    { label: "Biography", type: "textarea", name: "bio", id: "bio" },
    { label: "Color", type: "select", name: "color", id: "" },
    { label: "Email", type: "email", name: "email", id: "" },
    { label: "Note", type: "div", name: "", id: "" },
    { label: "Box", type: "span", name: "box", id: "" },
  ]);
});

test("fields inside an open shadow root stay on their form", () => {
  const input = h("input", { id: "full-name", name: "fullName", type: "text" });
  const shadow = h("div", {}, [h("label", { for: "full-name", text: "Name" }), input]);
  input.getRootNode = () => shadow;
  const host = h("span", {});
  host.shadowRoot = shadow;
  shadow.host = host;
  const root = h("div", {}, [h("form", { id: "profile", name: "profile", action: "/save" }, [host])]);

  assert.deepEqual(summarizeSnapshotForms(root, () => true), [
    {
      id: "profile",
      name: "profile",
      action: "/save",
      fields: [{ label: "Name", type: "text", name: "fullName", id: "full-name" }],
    },
  ]);
});

test("same-origin iframe forms are tagged with the frame", () => {
  const inner = h("div", {}, [
    h("form", { id: "inner", name: "inner", action: "/in" }, [
      h("input", { id: "em", name: "email", type: "email", "aria-label": "Email" }),
    ]),
  ]);
  const frame = h("iframe", { id: "checkout" });
  frame.contentDocument = inner;
  const root = h("div", {}, [frame]);

  const forms = collectSnapshotForms(root, () => true);
  assert.equal(forms.length, 1);
  assert.equal(forms[0].frame, "checkout");
  assert.equal(forms[0].fields[0].name, "email");
  assert.equal(forms[0].fields[0].label, "Email");
});

test("omits a form when every field fails the visibility predicate", () => {
  const root = h("div", {}, [
    h("form", { id: "f", name: "f", action: "/f" }, [
      h("input", { type: "text", name: "gone", id: "gone" }),
    ]),
  ]);
  assert.deepEqual(summarizeSnapshotForms(root, () => false), []);
});

test("region is nav, then form, otherwise control", () => {
  const item = h("div", { role: "menuitem", text: "Products" });
  h("nav", {}, [item]);
  assert.equal(snapshotControlRegion(item), "nav");

  const menuItem = h("button", { text: "More" });
  h("div", { role: "menu" }, [menuItem]);
  assert.equal(snapshotControlRegion(menuItem), "nav");

  const field = h("input", { type: "text", name: "fullName" });
  const form = h("form", {}, [field]);
  assert.equal(snapshotControlRegion(field), "form");

  const trapped = h("input", { type: "text", name: "q" });
  h("nav", {}, [h("form", {}, [trapped])]);
  assert.equal(snapshotControlRegion(trapped), "nav");

  assert.equal(snapshotControlRegion(h("button", { text: "Go" })), "control");
});

test("buildSnapshotExpression lists forms before controls and assigns region", () => {
  const src = buildSnapshotExpression(100);
  new Function(`return ${src}`);
  const body = src.slice(src.lastIndexOf("return {"));
  const formsAt = body.indexOf("forms");
  const controlsAt = body.indexOf("controls");
  const linksAt = body.indexOf("links");
  assert.ok(formsAt !== -1 && formsAt < controlsAt && controlsAt < linksAt);
  assert.match(src, /const forms = collectSnapshotForms\(document, visible\)/);
  assert.match(src, /region:\s*snapshotControlRegion\(el\)/);
  assert.match(src, /\.slice\(0,\s*100\)/);

  // toString() drops module closures. Run the embedded copy in a bare realm.
  const start = src.indexOf("const summarizeSnapshotForms");
  const end = src.indexOf("const labelForInRoot");
  const name = h("input", { id: "full-name", name: "fullName", type: "text" });
  const root = h("div", {}, [
    h("form", { id: "profile", name: "profile", action: "/save" }, [
      h("label", { for: "full-name", text: "Name" }),
      name,
    ]),
  ]);
  const context = vm.createContext({ root });
  vm.runInContext(
    `${src.slice(start, end)}\nthis.forms = summarizeSnapshotForms(root, () => true);`,
    context
  );
  // Cross-realm objects fail deepEqual; compare the JSON the page would return.
  assert.deepEqual(JSON.parse(JSON.stringify(context.forms)), [
    {
      id: "profile",
      name: "profile",
      action: "/save",
      fields: [{ label: "Name", type: "text", name: "fullName", id: "full-name" }],
    },
  ]);
});
