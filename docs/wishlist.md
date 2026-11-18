# Browser Hand wishlist

Improvements based on AutoJack's real-world use on 2026-11-18, while checking Gmail for Cosyworld mail with Jack watching on a live voice call. Related autohub PR: [verygoodplugins/autohub#2615](https://github.com/verygoodplugins/autohub/pull/2615) (prefer signed-in Safari).

## Reliability

### 1. Reliable typing into form fields
An agent session could click form fields but couldn't type into them. `type` and `fill` must set the value every time, and the change has to stick for frameworks that listen for input events (React and others).
- Confirm the value after typing, and return an error when it didn't take.
- Add regression tests against plain inputs, React-controlled inputs and contenteditable fields.

### 2. Work on pages with strict CSP (Gmail)
On Gmail in Safari, `snapshot` and `evaluate` fail with: "Refused to evaluate a string as JavaScript because this document requires a 'Trusted Type' assignment". `goto`, `tabs` and `screenshot` still work, so the agent had to read Gmail from screenshots.
- Add a snapshot path that doesn't depend on string eval.
- When this happens, give one clear next step, for example "enable Allow User Scripts for Browser Hand in Safari".

## Connection and status

### 3. Detect a disabled Safari extension, or prompt for it
The Safari extension had to be switched on by hand before Browser Hand could connect.
- `doctor` should detect that the extension is installed but disabled, and name the exact setting: Safari > Settings > Extensions > Browser Hand.
- Optionally, show a macOS notification asking the user to enable it.

### 4. Clear status on which browser is active
The default `browser-hand` relay (port 9333) had no browser connected while `browser-hand-safari` (port 19334) was healthy. Falling back to headless Chrome caused confusion.
- Every command should report which binary, relay and browser it used, for example "Safari 27.0.1 via 19334".
- Never fall back to headless Chrome silently when the user expects their own browser. Fail loudly, or say "fell back to Chrome".

## Visibility

### 5. Let the user watch, and show live activity
Before switching to Safari, the work ran in AutoJack's remote browser. Jack could only watch it through the Grok Bot app's Computer tab. Long tasks gave no progress except chat updates.
- Make the user's own visible browser the default for human-watched work (this is what autohub#2615 does).
- Add a live activity indicator in the browser: a badge or a small overlay showing "Browser Hand is navigating / typing / reading".
- Optionally, send progress events that the hub can pass on to voice or chat.

### 6. Simplify or document new-tab focus modes
New-tab focus has three modes: background tabs, focus browser window, and focus tab if the browser is active. Their behavior felt inconsistent. "Focus browser window" reliably brought Safari to the front.
- Document what each mode does, and recommend "focus browser window" for sessions a human is watching.
- Consider collapsing them into two modes: quiet or visible.

## Authenticated sites

### 7. Better session and credential handling
The remote browser had no saved Google login, and Google sign-in needed phone approval, which blocked the Gmail check. It worked once it ran in Jack's own signed-in Safari.
- Prefer the user's real signed-in browser for authenticated sites (Gmail, Google, banking and similar).
- When a sign-in wall appears, report it clearly: name the site and the account it wants. Don't loop.
- Add a `focus --reason 2fa` hand-off pattern for steps only a human can do.

### 8. A direct Gmail and Google account-switch action
Switching to dbcorkins@gmail.com inside Safari worked, but it took trial and error. Guessed `/mail/u/1/` and `/u/3/` URLs hit an account chooser or a CSP error, and `?authuser=<email>` resolved to `/u/2/`.
- Add a helper such as `browser-hand google-account --email <addr>` that opens the right `/u/N/` URL and reports the index.
- Optionally, cache the email-to-index mapping per browser.

## Adjacent, outside Browser Hand

### 9. Smarter default alert times for created tasks (Todoist, autohub)
When AutoJack created a Todoist task, it got a default 8:30 alert (30 minutes before the 9:00 due time), and a 7:30 alert was added on top. Neither fit Jack's day; he moved it to 14:00. Agents creating reminders should pick alert times from the user's known schedule and the business's opening hours, instead of generic morning defaults. This belongs in autohub or the agent instructions, not Browser Hand.
