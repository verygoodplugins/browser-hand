(function () {
  function paintOracle(result) {
    const el = document.getElementById("oracle-status");
    if (!el) return;
    const ok = !!(result && result.ok);
    el.dataset.ok = ok ? "true" : "false";
    if (ok) {
      el.textContent = "PASS: " + (result.detail || "all checks ok");
    } else {
      const detail =
        (result && result.detail) ||
        (result && result.checks
          ? JSON.stringify(result.checks, null, 2)
          : "not complete");
      el.textContent = "FAIL: " + detail;
    }
  }

  function refreshOracle() {
    if (typeof window.__oracle === "function") {
      try {
        paintOracle(window.__oracle());
      } catch (err) {
        paintOracle({ ok: false, detail: String(err) });
      }
    }
  }

  window.__paintOracle = paintOracle;
  window.__refreshOracle = refreshOracle;

  document.addEventListener("DOMContentLoaded", function () {
    refreshOracle();
  });
})();
