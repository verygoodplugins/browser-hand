/**
 * One CDP attach for a named-page recipe: batch --steps, navigate that
 * subscribes before Page.navigate, and Page.loadEventFired instead of DCL.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildHandlerInput } from "../src/cli.js";
import { navigateAndWait, parseBatchSteps } from "../src/tool.js";

test("parseBatchSteps rejects an empty list", () => {
  assert.throws(() => parseBatchSteps([]), /non-empty/);
  assert.throws(() => parseBatchSteps(null), /non-empty/);
});

test("parseBatchSteps aliases fill and caps step count", () => {
  const steps = parseBatchSteps([
    { operation: "open", url: "http://127.0.0.1/x" },
    { operation: "fill", fields: { Email: "a@b.c" } },
    { operation: "click", text: "Send" },
  ]);
  assert.equal(steps[1].operation, "fill_fields");
  assert.equal(steps[1].fields.Email, "a@b.c");
  assert.throws(
    () => parseBatchSteps(Array.from({ length: 33 }, () => ({ operation: "snapshot" }))),
    /32/
  );
});

test("parseBatchSteps rejects doctor and nested batch", () => {
  assert.throws(() => parseBatchSteps([{ operation: "doctor" }]), /not batchable/i);
  assert.throws(() => parseBatchSteps([{ operation: "batch" }]), /not batchable/i);
});

test("buildHandlerInput parses batch --steps JSON", () => {
  const input = buildHandlerInput("batch", {
    "page-name": "gym-01",
    steps: JSON.stringify([
      { operation: "open", url: "http://127.0.0.1/01-hello-form.html" },
      { operation: "fill_fields", fields: { Email: "ada@example.com" } },
      { operation: "evaluate", code: "window.__oracle()" },
    ]),
  });
  assert.equal(input.operation, "batch");
  assert.equal(input.pageName, "gym-01");
  assert.equal(input.steps.length, 3);
  assert.equal(input.steps[1].operation, "fill_fields");
});

test("navigateAndWait subscribes to load before Page.navigate", async () => {
  const order = [];
  const cdp = {
    waitForEvent(method) {
      order.push(`wait:${method}`);
      return Promise.resolve({});
    },
    send(method, params) {
      order.push(`send:${method}`);
      if (method === "Page.navigate") {
        assert.equal(params.url, "http://127.0.0.1/x");
        return Promise.resolve({ frameId: "f1" });
      }
      return Promise.resolve({});
    },
  };
  const nav = await navigateAndWait(cdp, "sid", "http://127.0.0.1/x", 30000);
  assert.equal(nav.frameId, "f1");
  assert.equal(order[0], "wait:Page.loadEventFired");
  assert.equal(order[1], "send:Page.navigate");
});

test("parseBatchSteps rejects array fields in fill steps", () => {
  assert.throws(
    () =>
      parseBatchSteps([
        { operation: "open", url: "http://127.0.0.1/x" },
        { operation: "fill_fields", fields: ["Email"] },
      ]),
    /fields must be a JSON object map/i
  );
});

test("batch redactions aggregate per-step secrets in output", async () => {
  const { substitutePlaceholders } = await import("../src/autofill.js");
  const { redactSensitiveText } = await import("../src/tool.js");

  const sub = await substitutePlaceholders(
    { url: "https://example.test/callback?token={secret:TOKEN}" },
    { getSecret: async () => "batch-secret-value-xyz" }
  );
  assert.equal(sub.redactions.length, 1);
  const batchRedactions = [...sub.redactions];
  const resolvedUrl = sub.vars.url;
  assert.match(resolvedUrl, /batch-secret-value-xyz/);
  const redactedUrl = redactSensitiveText(resolvedUrl, batchRedactions);
  assert.equal(redactedUrl, "https://example.test/callback?token=[REDACTED]");
});

test("navigateAndWait caps the ready wait well under the 30s op timeout", async () => {
  let waited = null;
  const cdp = {
    waitForEvent(_method, { timeoutMs }) {
      waited = timeoutMs;
      return Promise.resolve({});
    },
    send() {
      return Promise.resolve({});
    },
  };
  await navigateAndWait(cdp, "sid", "http://127.0.0.1/x", 30000);
  assert.ok(waited <= 8000, waited);
  assert.ok(waited >= 250, waited);
});
