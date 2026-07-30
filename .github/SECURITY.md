# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Browser Hand, please **do not** open a public issue.

Instead, report it privately via [GitHub Security Advisories](https://github.com/verygoodplugins/browser-hand/security/advisories/new). We aim to respond within 3 business days.

For urgent issues you may also email [support@verygoodplugins.com](mailto:support@verygoodplugins.com).

## Supported Versions

The latest minor release on the default branch receives security updates. Older versions may be patched on a case-by-case basis.

## Disclosure Policy

We follow coordinated disclosure: we'll work with you on a fix and credit you in the release notes if you wish.

## Scope of particular interest

Browser Hand drives a **real Chrome profile** via a local extension and relay. Reports of interest include:

- Privilege escalation from untrusted page content into the extension / relay / host
- Cross-origin or tab-targeting mistakes that leak cookies or session data
- Local WebSocket relay authentication / binding issues (should stay loopback-only)
- Prompt-injection or agent-driven actions that bypass intended human-in-the-loop focus gates
- Supply-chain issues in install/postinstall binary download paths

Automation against third-party sites is the operator’s responsibility; please do not use security reports as a request to automate CAPTCHA/auth bypass.
