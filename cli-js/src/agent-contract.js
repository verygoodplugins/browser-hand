/**
 * Pure helpers for the agent-facing CLI contract.
 *
 * Injected into page expressions via toString(), so they must not close over
 * module state. Doctor shaping, snapshot scope, and click resolution stay
 * here so tests can compare payloads without Chrome.
 */

const NODE_SELECTOR = [
  "button",
  "a[href]",
  'input:not([type="hidden"])',
  "textarea",
  "select",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="combobox"]',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="slider"]',
  '[contenteditable="true"]',
].join(", ");

const POPUP_SELECTOR =
  'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="listbox"], [role="menu"]';

const MAX_SNAPSHOT_NODES = 100;

function attr(el, name) {
  try {
    if (!el || typeof el.getAttribute !== "function") return "";
    const value = el.getAttribute(name);
    return value == null ? "" : String(value);
  } catch {
    return "";
  }
}

function norm(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function short(value, cap = 240) {
  const text = norm(value);
  return text.length > cap ? text.slice(0, cap) : text;
}

function queryAll(node, sel) {
  if (!node || typeof node.querySelectorAll !== "function") return [];
  try {
    return Array.from(node.querySelectorAll(sel));
  } catch {
    return [];
  }
}

export function elementIsVisible(el) {
  try {
    const view = el && el.ownerDocument && el.ownerDocument.defaultView;
    const getComputedStyle = view && view.getComputedStyle;
    if (typeof getComputedStyle !== "function" || typeof el.getBoundingClientRect !== "function") {
      return true;
    }
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (
      style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
    );
  } catch {
    return false;
  }
}

export function inNavigation(el) {
  const hit = (sel) => {
    try {
      return !!(el && typeof el.closest === "function" && el.closest(sel));
    } catch {
      return false;
    }
  };
  return hit("nav") || hit('[role="navigation"]');
}

export function implicitAriaRole(el) {
  const explicit = attr(el, "role").trim().toLowerCase();
  if (explicit) return explicit;
  const tag = String((el && el.tagName) || "").toLowerCase();
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "a") return attr(el, "href") ? "link" : "";
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  if (tag === "option") return "option";
  if (attr(el, "contenteditable") === "true") return "textbox";
  if (tag === "input") {
    const type = attr(el, "type").trim().toLowerCase() || "text";
    if (type === "hidden") return "";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "button" || type === "submit" || type === "reset") return "button";
    if (type === "search") return "searchbox";
    return "textbox";
  }
  return "";
}

function labelledByRoot(el, root) {
  // Snapshot roots are <main> or a dialog element, which has no getElementById.
  // IDs resolve on the owning document. A shadow root keeps its own ID scope.
  try {
    const own = el && typeof el.getRootNode === "function" ? el.getRootNode() : null;
    if (own && own.nodeType !== 1 && typeof own.getElementById === "function") return own;
  } catch {
    /* detached */
  }
  const doc = el && el.ownerDocument;
  if (doc && typeof doc.getElementById === "function") return doc;
  if (root && typeof root.getElementById === "function") return root;
  const rootDoc = root && root.ownerDocument;
  if (rootDoc && typeof rootDoc.getElementById === "function") return rootDoc;
  return null;
}

export function snapshotAccessibleName(el, root) {
  const aria = short(attr(el, "aria-label"));
  if (aria) return aria;
  const labelledBy = attr(el, "aria-labelledby");
  const lookup = labelledBy ? labelledByRoot(el, root) : null;
  if (labelledBy && lookup) {
    const parts = [];
    for (const id of labelledBy.split(/\s+/)) {
      if (!id) continue;
      const node = lookup.getElementById(id);
      const text = short(node && node.innerText);
      if (text) parts.push(text);
    }
    if (parts.length) return short(parts.join(" "));
  }
  if (el && el.id && root && typeof root.querySelectorAll === "function") {
    for (const label of queryAll(root, "label")) {
      const forId = label.htmlFor || attr(label, "for");
      if (forId && forId === el.id) {
        const text = short(label.innerText);
        if (text) return text;
      }
    }
  }
  try {
    const wrapping = el && typeof el.closest === "function" ? el.closest("label") : null;
    const text = short(wrapping && wrapping.innerText);
    if (text) return text;
  } catch {
    /* detached */
  }
  const role = implicitAriaRole(el);
  if (
    ["button", "link", "option", "menuitem", "tab", "checkbox", "radio", "switch"].includes(role)
  ) {
    const text = short(el.innerText || el.value || "");
    if (text) return text;
  }
  const placeholder = short(attr(el, "placeholder"));
  if (placeholder) return placeholder;
  const title = short(attr(el, "title"));
  if (title) return title;
  return "";
}

export function readControlState(el) {
  const state = {};
  if (!el) return state;
  const role = implicitAriaRole(el);
  const ariaChecked = attr(el, "aria-checked");
  if (ariaChecked) {
    state.ariaChecked = ariaChecked;
    if (role === "switch" || role === "checkbox" || role === "radio") {
      if (ariaChecked === "true" || ariaChecked === "false") state.checked = ariaChecked === "true";
    }
  } else if (typeof el.checked === "boolean" && (role === "checkbox" || role === "radio")) {
    state.checked = el.checked;
  }
  const pressed = attr(el, "aria-pressed");
  if (pressed) state.ariaPressed = pressed;
  const expanded = attr(el, "aria-expanded");
  if (expanded) state.ariaExpanded = expanded;
  const tag = String(el.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    if (role !== "checkbox" && role !== "radio" && role !== "button" && role !== "switch") {
      const type = attr(el, "type").trim().toLowerCase();
      if (type !== "password") {
        state.value = el.value == null ? "" : String(el.value);
      }
    }
  }
  return state;
}

export function controlStateChanged(before, after) {
  if (!before || !after) return null;
  const keys = ["ariaChecked", "checked", "ariaPressed", "ariaExpanded", "value"];
  const watched = keys.filter((key) => Object.prototype.hasOwnProperty.call(before, key));
  if (watched.length === 0) return null;
  return watched.some((key) => before[key] !== after[key]);
}

export function selectSnapshotRoots(doc, options = {}) {
  const visible = typeof options.visible === "function" ? options.visible : elementIsVisible;
  const scope = options.scope || "auto";
  const query = (sel) =>
    queryAll(doc, sel).filter((el) => {
      try {
        return visible(el);
      } catch {
        return false;
      }
    });

  if (scope === "nav") {
    const navs = query('nav, [role="navigation"]');
    return { scope: "nav", roots: navs, includeNav: true };
  }

  const popups = query(POPUP_SELECTOR).filter((el) => !inNavigation(el));
  const main = queryAll(doc, 'main, [role="main"]')[0] || (doc && doc.body) || doc;
  const roots = [];
  for (const popup of popups) roots.push(popup);
  if (main) roots.push(main);
  const hasMain = queryAll(doc, 'main, [role="main"]').length > 0;
  let label = hasMain ? "main" : "document";
  if (popups.length) label = hasMain ? "dialog+main" : "dialog";
  return { scope: label, roots, includeNav: false };
}

function pushEntry(out, seen, el, root, includeNav, refOffset = 0) {
  if (!el || seen.has(el) || out.length >= MAX_SNAPSHOT_NODES) return;
  if (!includeNav && inNavigation(el)) return;
  const role = implicitAriaRole(el);
  if (!role || role === "listbox" || role === "menu" || role === "navigation") return;
  seen.add(el);
  const name = snapshotAccessibleName(el, root);
  const state = readControlState(el);
  if ((role === "combobox" || role === "searchbox") && state.value == null) {
    const text = short(el.innerText || "");
    if (text && text.toLowerCase() !== name.toLowerCase()) state.value = text;
  }
  const offset = Number.isFinite(refOffset) && refOffset > 0 ? Math.floor(refOffset) : 0;
  out.push({
    el,
    ref: `e${offset + out.length + 1}`,
    role,
    name,
    ...state,
  });
}

export function collectSnapshotEntries(doc, options = {}) {
  const visible = typeof options.visible === "function" ? options.visible : elementIsVisible;
  let roots = options.roots;
  let includeNav = options.includeNav === true;
  if (!roots) {
    if (options.includeNav === true && !options.scope) {
      roots = [doc && doc.body ? doc.body : doc];
    } else {
      const selected = selectSnapshotRoots(doc, { visible, scope: options.scope || "auto" });
      roots = selected.roots;
      includeNav = selected.includeNav === true;
    }
  }
  const out = [];
  const seen = new Set();
  const refOffset =
    Number.isFinite(options.refOffset) && options.refOffset > 0 ? Math.floor(options.refOffset) : 0;
  const walk = (node, depth) => {
    if (!node || depth > 6 || out.length >= MAX_SNAPSHOT_NODES) return;
    let nodes = [];
    try {
      nodes = queryAll(node, NODE_SELECTOR);
    } catch {
      nodes = [];
    }
    for (const el of nodes) {
      let shown = true;
      try {
        shown = visible(el);
      } catch {
        shown = false;
      }
      if (!shown) continue;
      pushEntry(out, seen, el, node, includeNav, refOffset);
      if (out.length >= MAX_SNAPSHOT_NODES) return;
    }
    let hosts = [];
    try {
      hosts = queryAll(node, "*");
    } catch {
      hosts = [];
    }
    for (const host of hosts) {
      if (host && host.shadowRoot) walk(host.shadowRoot, depth + 1);
    }
    let frames = [];
    try {
      frames = queryAll(node, "iframe").slice(0, 20);
    } catch {
      frames = [];
    }
    for (const frame of frames) {
      try {
        if (frame.contentDocument) walk(frame.contentDocument, depth + 1);
      } catch {
        /* cross-origin */
      }
    }
  };
  for (const root of roots || []) walk(root, 0);
  return out;
}

export function toSnapshotNode(entry) {
  const node = { ref: entry.ref, role: entry.role, name: entry.name || "" };
  if (entry.value != null) node.value = entry.value;
  if (entry.ariaChecked != null) node.ariaChecked = entry.ariaChecked;
  if (entry.checked != null) node.checked = entry.checked;
  if (entry.ariaPressed != null) node.ariaPressed = entry.ariaPressed;
  if (entry.ariaExpanded != null) node.ariaExpanded = entry.ariaExpanded;
  const href = entry.el ? attr(entry.el, "href") : entry.href || "";
  if (href) node.href = href;
  return node;
}

function headingsIn(roots, visible) {
  const out = [];
  for (const root of roots || []) {
    for (const el of queryAll(root, "h1, h2, h3")) {
      if (inNavigation(el)) continue;
      try {
        if (!visible(el)) continue;
      } catch {
        continue;
      }
      const text = short(el.innerText);
      if (text) out.push(text);
      if (out.length >= 8) return out;
    }
  }
  return out;
}

export function buildSnapshotPayload(doc, options = {}) {
  const visible = typeof options.visible === "function" ? options.visible : elementIsVisible;
  const scope = options.scope || "auto";
  const maxTextChars = Number(options.maxTextChars) > 0 ? Number(options.maxTextChars) : 8000;
  const selected =
    scope === "nav"
      ? selectSnapshotRoots(doc, { visible, scope: "nav" })
      : selectSnapshotRoots(doc, { visible, scope: "auto" });
  const entries = collectSnapshotEntries(doc, {
    roots: selected.roots,
    includeNav: scope === "nav",
    visible,
  });
  const formRoots = (selected.roots || []).filter(
    (root, index, all) =>
      !all.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other &&
          typeof other.contains === "function" &&
          other.contains(root)
      )
  );
  const payload = {
    url: (() => {
      try {
        return doc.location ? doc.location.href : "";
      } catch {
        return "";
      }
    })(),
    title: doc.title || (doc.ownerDocument && doc.ownerDocument.title) || "",
    scope: selected.scope,
    nodes: entries.map(toSnapshotNode),
  };
  try {
    payload.focused = typeof doc.hasFocus === "function" ? doc.hasFocus() === true : undefined;
  } catch {
    payload.focused = undefined;
  }
  if (payload.focused === undefined) delete payload.focused;
  const headings = headingsIn(formRoots, visible);
  if (headings.length) payload.headings = headings;
  if (typeof options.summarizeSnapshotForms === "function") {
    const forms = [];
    for (const root of formRoots) {
      const chunk = options.summarizeSnapshotForms(root, visible);
      if (Array.isArray(chunk)) forms.push(...chunk);
    }
    if (forms.length) payload.forms = forms;
  }
  if (scope === "full") {
    const nav = collectSnapshotEntries(doc, {
      roots: selectSnapshotRoots(doc, { visible, scope: "nav" }).roots,
      includeNav: true,
      visible,
      refOffset: entries.length,
    });
    payload.nav = nav.map(toSnapshotNode);
    const text = norm(doc.body && doc.body.innerText);
    payload.text = text.slice(0, maxTextChars);
  }
  return payload;
}

export function resolveSnapshotClick(entries, query = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const brief = (entry) => ({ ref: entry.ref, role: entry.role, name: entry.name || "" });
  const ref = query.ref ? String(query.ref) : "";
  if (ref) {
    const hit = list.find((entry) => entry.ref === ref);
    return hit
      ? { entry: hit, ambiguous: false, candidates: [] }
      : { entry: null, ambiguous: false, candidates: [] };
  }
  const role = query.role ? String(query.role).toLowerCase() : "";
  const wanted = norm(query.name || "").toLowerCase();
  let pool = list;
  if (role) pool = pool.filter((entry) => String(entry.role || "").toLowerCase() === role);
  if (!wanted) {
    return { entry: null, ambiguous: false, candidates: pool.slice(0, 8).map(brief) };
  }
  const exact = pool.filter((entry) => norm(entry.name).toLowerCase() === wanted);
  if (exact.length === 1) return { entry: exact[0], ambiguous: false, candidates: [] };
  if (exact.length > 1) {
    return { entry: null, ambiguous: true, candidates: exact.slice(0, 8).map(brief) };
  }
  return { entry: null, ambiguous: false, candidates: pool.slice(0, 8).map(brief) };
}

export function shapeDoctorInventory(inventory = {}, { verbose = false } = {}) {
  const shaped = {
    targetCount: inventory.targetCount || 0,
    tabCount: inventory.tabCount || 0,
    active: inventory.active || null,
    hint: "Doctor is a health check. For a full inventory use `browser-hand tabs`.",
  };
  if (verbose) {
    shaped.targets = Array.isArray(inventory.tabs) ? inventory.tabs : [];
    shaped.truncated = inventory.truncated === true;
  }
  return shaped;
}

export function snapshotPageHelpersSource() {
  return [
    `const NODE_SELECTOR = ${JSON.stringify(NODE_SELECTOR)};`,
    `const POPUP_SELECTOR = ${JSON.stringify(POPUP_SELECTOR)};`,
    `const MAX_SNAPSHOT_NODES = ${MAX_SNAPSHOT_NODES};`,
    attr,
    norm,
    short,
    queryAll,
    elementIsVisible,
    inNavigation,
    implicitAriaRole,
    labelledByRoot,
    snapshotAccessibleName,
    readControlState,
    controlStateChanged,
    selectSnapshotRoots,
    pushEntry,
    collectSnapshotEntries,
    toSnapshotNode,
    headingsIn,
    buildSnapshotPayload,
    resolveSnapshotClick,
  ]
    .map((fn) => (typeof fn === "function" ? fn.toString() : fn))
    .join("\n");
}
