/**
 * Compact machine JSON: one line on stdout, and --quiet drops wrappers
 * agents do not need (mode/target/url/title).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { encodeCliJson, slimCliResult } from "../src/cli.js";

test("encodeCliJson is a single-line JSON object", () => {
  const encoded = encodeCliJson({ success: true, result: { filled: ["Email"] } });
  assert.equal(encoded.endsWith("\n"), true);
  assert.equal(encoded.trim().includes("\n"), false);
  assert.equal(JSON.parse(encoded).success, true);
  assert.doesNotMatch(encoded, /  /);
});

test("slimCliResult is a no-op without quiet", () => {
  const raw = {
    success: true,
    mode: "current",
    operation: "fill_fields",
    target: { url: "http://127.0.0.1/x" },
    result: { url: "http://127.0.0.1/x", title: "Hi", filled: ["Email"], failed: [] },
  };
  assert.equal(slimCliResult(raw, { quiet: false }), raw);
});

test("slimCliResult --quiet drops mode/target/url/title from fill", () => {
  const slim = slimCliResult(
    {
      success: true,
      mode: "current",
      operation: "fill_fields",
      pageName: "gym-01",
      target: { url: "http://127.0.0.1/01-hello-form.html", title: "Hello" },
      result: {
        url: "http://127.0.0.1/01-hello-form.html",
        title: "Hello",
        filled: ["Email"],
        failed: [],
      },
    },
    { quiet: true }
  );
  assert.deepEqual(slim, {
    success: true,
    operation: "fill_fields",
    pageName: "gym-01",
    result: { filled: ["Email"], failed: [] },
  });
});

test("slimCliResult --quiet keeps evaluate oracle fields only", () => {
  const slim = slimCliResult(
    {
      success: true,
      mode: "current",
      operation: "evaluate",
      target: { url: "http://127.0.0.1/x" },
      result: { ok: true, checks: { submitted: true }, detail: "form accepted" },
    },
    { quiet: true }
  );
  assert.deepEqual(slim, {
    success: true,
    operation: "evaluate",
    result: { ok: true, checks: { submitted: true }, detail: "form accepted" },
  });
});

test("slimCliResult --quiet preserves user-requested url/title in evaluate result", () => {
  const slim = slimCliResult(
    {
      success: true,
      mode: "current",
      operation: "evaluate",
      target: { url: "http://127.0.0.1/x" },
      result: { url: "http://127.0.0.1/x", title: "Hello", ok: true },
    },
    { quiet: true }
  );
  assert.deepEqual(slim, {
    success: true,
    operation: "evaluate",
    result: { url: "http://127.0.0.1/x", title: "Hello", ok: true },
  });
});

test("slimCliResult --quiet preserves click warnings", () => {
  const slim = slimCliResult(
    {
      success: true,
      mode: "current",
      operation: "click",
      warning: "Dispatched, but this tab is backgrounded.",
      result: { clicked: "#submit", url: "http://127.0.0.1/x" },
    },
    { quiet: true }
  );
  assert.equal(slim.warning, "Dispatched, but this tab is backgrounded.");
  assert.deepEqual(slim.result, { clicked: "#submit" });
});

test("slimCliResult --quiet does not strip doctor or tabs", () => {
  const doctor = {
    success: true,
    operation: "doctor",
    status: "tab_bootstrap_works",
    relay: { reachable: true },
  };
  assert.equal(slimCliResult(doctor, { quiet: true }), doctor);
});
