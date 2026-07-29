/**
 * Autofill placeholder substitution.
 *
 * Walks a vars tree and replaces `{me:KEY}`, `{secure:KEY}`, and
 * `{secret:KEY}` placeholders before they are passed to dev_browser (or any
 * other consumer). Three-tier
 * design:
 *   - {me:KEY}    → looked up in plain JSON autofill data (PII the LLM
 *                   already needs to know to fill a form: name, email, etc).
 *   - {secure:KEY} → looked up via an injected reader (macOS keychain in
 *                    production). Use for legal names, addresses, SSN, card
 *                    data, passwords, and other profile data that should not
 *                    live in memory or repo files.
 *   - {secret:KEY} → looked up via an injected reader (macOS keychain in
 *                    production). The LLM passes a placeholder; the wrapper
 *                    substitutes the real value just before stdin write so
 *                    secrets never enter LLM/API logs.
 *
 * Pure module — no I/O. Production wires up keychain reader + autofill
 * loader; tests inject fakes.
 */

export async function substitutePlaceholders(input, opts = {}) {
  const {
    autofill = {},
    getSecret = async () => null,
    getSecure = async () => null,
    secretCache = new Map(),
    secureCache = new Map(),
  } = opts;

  const errors = [];
  const substituted = { me: new Set(), secret: new Set(), secure: new Set() };
  const redactions = new Set();
  let sawSecurePlaceholder = false;

  if (input === null || input === undefined) {
    return {
      vars: input,
      errors,
      substituted: { me: [], secret: [] },
      redactions: [],
    };
  }

  async function substituteString(str) {
    const re = /\{(me|secret|secure):([^}]+)\}/g;
    const matches = [...str.matchAll(re)];
    if (matches.length === 0) {
      return str;
    }

    const replacements = new Map();
    const uniqueMatches = [];
    const seenPlaceholders = new Set();
    for (const m of matches) {
      const [whole] = m;
      if (seenPlaceholders.has(whole)) {
        continue;
      }
      seenPlaceholders.add(whole);
      uniqueMatches.push(m);
    }

    await Promise.all(
      uniqueMatches.map(async m => {
        const [whole, kind, key] = m;

        if (kind === 'me') {
          const val = lookupDotted(autofill, key);
          if (val === undefined) {
            errors.push(
              `Unknown {me:${key}} — add it to ~/.autohub/autofill.json`
            );
            return;
          }
          const replacement = String(val);
          replacements.set(whole, replacement);
          substituted.me.add(key);
          addRedaction(redactions, replacement);
          return;
        }

        if (kind === 'secure') {
          sawSecurePlaceholder = true;
          const val = await readCachedKey({
            key,
            cache: secureCache,
            reader: getSecure,
          });
          if (val === null || val === undefined) {
            errors.push(
              `Unknown {secure:${key}} — store it with: security add-generic-password -s autohub-profile-${key} -a "$USER" -w 'VALUE'`
            );
            return;
          }
          const replacement = String(val);
          replacements.set(whole, replacement);
          substituted.secure.add(key);
          addRedaction(redactions, replacement);
          return;
        }

        // kind === 'secret'
        const val = await readCachedKey({
          key,
          cache: secretCache,
          reader: getSecret,
        });
        if (val === null || val === undefined) {
          errors.push(
            `Unknown {secret:${key}} — store it with: security add-generic-password -s autohub-autofill-${key} -a "$USER" -w 'VALUE'`
          );
          return;
        }
        const replacement = String(val);
        replacements.set(whole, replacement);
        substituted.secret.add(key);
        addRedaction(redactions, replacement);
      })
    );

    let out = str;
    for (const [from, to] of replacements) {
      out = out.split(from).join(to);
    }
    return out;
  }

  async function walk(node) {
    if (typeof node === 'string') {
      return await substituteString(node);
    }
    if (Array.isArray(node)) {
      return Promise.all(node.map(item => walk(item)));
    }
    if (node && typeof node === 'object') {
      const entries = await Promise.all(
        Object.entries(node).map(async ([k, v]) => [k, await walk(v)])
      );
      return Object.fromEntries(entries);
    }
    return node;
  }

  const vars = await walk(input);

  const substitutedResult = {
    me: [...substituted.me],
    secret: [...substituted.secret],
  };
  if (sawSecurePlaceholder || substituted.secure.size > 0) {
    substitutedResult.secure = [...substituted.secure];
  }

  return {
    vars,
    errors,
    substituted: substitutedResult,
    redactions: [...redactions],
  };
}

async function readCachedKey({ key, cache, reader }) {
  if (cache.has(key)) {
    return await cache.get(key);
  }

  const pending = Promise.resolve()
    .then(() => reader(key))
    .catch(() => null);
  cache.set(key, pending);
  try {
    return await pending;
  } finally {
    if (cache.get(key) === pending) {
      cache.delete(key);
    }
  }
}

function addRedaction(redactions, value) {
  if (typeof value !== 'string' || value.length === 0) {
    return;
  }
  redactions.add(value);
}

function lookupDotted(obj, path) {
  return path.split('.').reduce((acc, key) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return acc[key];
    }
    return undefined;
  }, obj);
}
