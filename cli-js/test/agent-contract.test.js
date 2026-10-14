/**
 * Agent-session contract: compact doctor, scoped snapshot, role/ref clicks,
 * and post-click control state.
 *
 * These are the round-trips that dominated a logged-in DNS session: doctor
 * dumped every tab, snapshots repeated the sidebar, and click had no
 * role/name handle. Payload-size assertions are the before/after comparison.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { summarizeTabInventory } from "../src/tool.js";
import {
  buildSnapshotPayload,
  collectSnapshotEntries,
  controlStateChanged,
  implicitAriaRole,
  readControlState,
  resolveSnapshotClick,
  shapeDoctorInventory,
  snapshotPageHelpersSource,
} from "../src/agent-contract.js";
import vm from "node:vm";

function page(partial) {
  return {
    type: "page",
    targetId: partial.id,
    title: partial.title || "",
    url: partial.url || "https://example.com/",
    active: partial.active === true,
    focused: partial.focused === true,
    windowId: partial.windowId,
  };
}

function el(tag, props = {}, kids = []) {
  const attrs = {};
  for (const [key, value] of Object.entries(props)) {
    if (["id", "text", "value", "checked"].includes(key)) continue;
    attrs[key === "for" ? "for" : key] = value;
  }
  const node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    id: props.id || "",
    type: props.type || "",
    value: props.value,
    checked: props.checked,
    innerText: props.text || "",
    htmlFor: props.for || "",
    attrs,
    children: kids,
    parent: null,
  };
  node.getAttribute = (name) =>
    Object.prototype.hasOwnProperty.call(node.attrs, name) ? node.attrs[name] : null;
  node.closest = (sel) => {
    const want = String(sel).toLowerCase();
    let cur = node;
    while (cur) {
      const tagName = String(cur.tagName || "").toLowerCase();
      const role = cur.getAttribute && cur.getAttribute("role");
      if (want === "nav" && tagName === "nav") return cur;
      if (want === "label" && tagName === "label") return cur;
      if (want === '[role="navigation"]' && role === "navigation") return cur;
      if (want === '[role="menu"]' && role === "menu") return cur;
      if (want === "form" && tagName === "form") return cur;
      cur = cur.parent;
    }
    return null;
  };
  node.querySelectorAll = (sel) => {
    const out = [];
    const parts = String(sel)
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const walk = (item) => {
      for (const child of item.children || []) {
        if (parts.some((part) => matches(child, part))) out.push(child);
        walk(child);
      }
    };
    walk(node);
    return out;
  };
  for (const kid of kids) kid.parent = node;
  return node;
}

function matches(node, sel) {
  if (sel === "a[href]") return node.tagName === "A" && node.getAttribute("href");
  if (sel === 'input:not([type="hidden"])') {
    return node.tagName === "INPUT" && node.getAttribute("type") !== "hidden";
  }
  if (sel.startsWith("[role=")) {
    const role = sel.slice(7, -2);
    return node.getAttribute("role") === role;
  }
  if (sel === "dialog[open]") return node.tagName === "DIALOG" && node.getAttribute("open") != null;
  if (sel === '[aria-modal="true"]') return node.getAttribute("aria-modal") === "true";
  if (sel === "main") return node.tagName === "MAIN";
  if (sel === '[role="main"]') return node.getAttribute("role") === "main";
  if (sel === "nav") return node.tagName === "NAV";
  if (sel === '[role="navigation"]') return node.getAttribute("role") === "navigation";
  if (sel === "h1, h2, h3" || sel === "h1,h2,h3") return ["H1", "H2", "H3"].includes(node.tagName);
  if (sel === "label") return node.tagName === "LABEL";
  const simple = sel.match(/^[a-z]+$/);
  return Boolean(simple) && node.tagName === sel.toUpperCase();
}

function loggedInShell() {
  const navLinks = Array.from({ length: 24 }, (_, i) =>
    el("a", { href: `https://dash.example/section-${i}`, text: `Section ${i} inbox calendar mail` })
  );
  const dialog = el("div", { role: "dialog", "aria-modal": "true" }, [
    el("button", { role: "combobox", "aria-label": "Type", text: "A" }),
    el("input", { id: "name", type: "text", "aria-label": "Name", value: "www" }),
    el("button", { role: "switch", "aria-label": "Proxy", "aria-checked": "true", text: "" }),
    el("div", { role: "listbox" }, [
      el("div", { role: "option", text: "A" }),
      el("div", { role: "option", text: "CNAME" }),
    ]),
  ]);
  const body = el("body", {}, [
    el("nav", {}, navLinks),
    el("main", {}, [
      el("h1", { text: "DNS" }),
      el("button", { text: "Add record" }),
      el("table", {}, [el("tr", {}, [el("td", { text: "existing.example A proxied" })])]),
    ]),
    dialog,
  ]);
  body.innerText = [
    ...navLinks.map((link) => link.innerText),
    "DNS",
    "Add record",
    "existing.example A proxied",
    "Type A Name www Proxy CNAME",
  ].join("\n");
  return {
    body,
    title: "DNS · Cloudflare",
    querySelectorAll: (sel) => body.querySelectorAll(sel),
  };
}

test("doctor inventory is status-sized unless verbose", () => {
  const targets = Array.from({ length: 20 }, (_, i) =>
    page({
      id: `tab-${i + 1}`,
      title: i === 7 ? "DNS · Cloudflare" : `Mail ${i}`,
      url: i === 7 ? "https://dash.cloudflare.com/dns" : `https://mail.example/inbox/${i}`,
      active: i === 7,
      focused: i === 7,
    })
  );
  const inventory = summarizeTabInventory(targets);
  const compact = shapeDoctorInventory(inventory);
  const verbose = shapeDoctorInventory(inventory, { verbose: true });

  assert.equal(compact.tabCount, 20);
  assert.equal(compact.active.title, "DNS · Cloudflare");
  assert.equal(compact.active.url, "https://dash.cloudflare.com/dns");
  assert.equal(Object.hasOwn(compact, "targets"), false);
  assert.equal(verbose.targets.length, 20);
  assert.match(compact.hint, /browser-hand tabs/);

  const compactBytes = JSON.stringify(compact).length;
  const verboseBytes = JSON.stringify(verbose).length;
  assert.ok(
    compactBytes * 4 < verboseBytes,
    `compact doctor ${compactBytes}b should be well under verbose ${verboseBytes}b`
  );
  assert.equal(JSON.stringify(compact).includes("mail.example"), false);
});

test("default snapshot is the dialog and main, not the sidebar three times", () => {
  const doc = loggedInShell();
  const scoped = buildSnapshotPayload(doc, { scope: "auto", maxTextChars: 20000 });
  const full = buildSnapshotPayload(doc, { scope: "full", maxTextChars: 20000 });

  assert.equal(scoped.scope, "dialog+main");
  assert.equal(scoped.text, undefined);
  assert.equal(scoped.links, undefined);
  assert.equal(scoped.nav, undefined);

  const names = scoped.nodes.map((node) => `${node.ref}:${node.role}:${node.name}`);
  assert.ok(names.some((item) => item.includes("combobox:Type")));
  assert.ok(names.some((item) => item.includes("option:CNAME")));
  assert.ok(names.some((item) => item.includes("switch:Proxy")));
  assert.ok(names.some((item) => item.includes("button:Add record")));
  assert.equal(
    names.some((item) => item.includes("Section")),
    false
  );

  const typeNode = scoped.nodes.find((node) => node.role === "combobox" && node.name === "Type");
  assert.equal(typeNode.value, "A");
  const nameNode = scoped.nodes.find((node) => node.name === "Name");
  assert.equal(nameNode.role, "textbox");
  assert.equal(nameNode.value, "www");
  const proxy = scoped.nodes.find((node) => node.name === "Proxy");
  assert.equal(proxy.ariaChecked, "true");

  const dialogRef = scoped.nodes.find((node) => node.name === "Type").ref;
  const mainRef = scoped.nodes.find((node) => node.name === "Add record").ref;
  assert.ok(
    Number(dialogRef.slice(1)) < Number(mainRef.slice(1)),
    "open dialog is ahead of the page"
  );

  const scopedBytes = JSON.stringify(scoped).length;
  const fullBytes = JSON.stringify(full).length;
  assert.ok(Array.isArray(full.nav) && full.nav.length === 24);
  assert.ok(typeof full.text === "string" && full.text.includes("Section 0"));
  assert.ok(
    scopedBytes * 2 < fullBytes,
    `scoped snapshot ${scopedBytes}b should be under half of full ${fullBytes}b`
  );
});

test("role and name click the combobox, not the option whose text is A", () => {
  const doc = loggedInShell();
  const entries = collectSnapshotEntries(doc, { includeNav: true });
  const hit = resolveSnapshotClick(entries, { role: "combobox", name: "Type" });
  assert.equal(hit.entry.role, "combobox");
  assert.equal(hit.entry.name, "Type");
  assert.equal(hit.ambiguous, false);

  const option = resolveSnapshotClick(entries, { role: "option", name: "CNAME" });
  assert.equal(option.entry.name, "CNAME");

  const letter = resolveSnapshotClick(entries, { role: "option", name: "A" });
  assert.equal(letter.entry.role, "option");
  assert.equal(letter.entry.name, "A");
  assert.notEqual(letter.entry.role, "combobox");
});

test("role and name refuses an ambiguous exact match", () => {
  const entries = [
    { ref: "e1", role: "button", name: "Save", el: { id: "a" } },
    { ref: "e2", role: "button", name: "Save", el: { id: "b" } },
  ];
  const hit = resolveSnapshotClick(entries, { role: "button", name: "Save" });
  assert.equal(hit.entry, null);
  assert.equal(hit.ambiguous, true);
  assert.equal(hit.candidates.length, 2);
});

test("ref resolves to the same node the default snapshot published", () => {
  const doc = loggedInShell();
  const payload = buildSnapshotPayload(doc, { scope: "auto" });
  const cname = payload.nodes.find((node) => node.name === "CNAME");
  const entries = collectSnapshotEntries(doc, { scope: "auto" });
  const hit = resolveSnapshotClick(entries, { ref: cname.ref });
  assert.equal(hit.entry.name, "CNAME");
  assert.equal(hit.entry.ref, cname.ref);
});

test("control state reports aria-checked and whether a toggle moved", () => {
  const sw = el("button", { role: "switch", "aria-checked": "true", "aria-label": "Proxy" });
  const before = readControlState(sw);
  assert.equal(before.ariaChecked, "true");
  assert.equal(controlStateChanged(before, before), false);
  sw.attrs["aria-checked"] = "false";
  assert.equal(controlStateChanged(before, readControlState(sw)), true);

  const button = el("button", { text: "Save" });
  assert.equal(controlStateChanged(readControlState(button), readControlState(button)), null);
  assert.equal(implicitAriaRole(el("input", { type: "checkbox" })), "checkbox");

  const secret = el("input", {
    type: "password",
    value: "test-only-secret",
    "aria-label": "Password",
  });
  const hidden = readControlState(secret);
  assert.equal(hidden.value, undefined);
  assert.equal(JSON.stringify(hidden).includes("test-only-secret"), false);
});

test("injected snapshot helpers define the selectors they close over", () => {
  const context = vm.createContext({
    document: {
      body: { innerText: "" },
      title: "",
      querySelectorAll: () => [],
    },
  });
  vm.runInContext(
    `${snapshotPageHelpersSource()}\nthis.roots = selectSnapshotRoots(document, { scope: "auto", visible: () => true });`,
    context
  );
  assert.equal(context.roots.scope, "document");
});
