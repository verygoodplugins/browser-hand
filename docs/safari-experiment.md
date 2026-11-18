# Safari support

Browser Hand's Safari extension runs through a signed macOS app. Safari 27.0.1
has been tested with the notarized release, including a Safari restart. Download
the standalone image from [GitHub Releases](https://github.com/verygoodplugins/browser-hand/releases).
Building from source requires macOS, Xcode, and an Apple Development signing
identity; installing the published app does not.

## Standalone download

The standalone disk image includes the Safari extension, CLI, local relay, and a
universal Node runtime; recipients do not need Xcode, Node, or an Apple
Developer account. It requires macOS 13.5 or later. Open the disk image and drag
**Browser Hand** to Applications. Open the app and click **Set up Browser Hand**.
Enable the extension in Safari Settings and choose its website permissions. Run
`~/.local/bin/browser-hand-safari doctor` to check the connection. Add
`~/.local/bin` to your shell's PATH if you want to type `browser-hand-safari`
without the full path.

If you installed an earlier experimental **Browser Hand Safari.app**, quit it
and remove that old app from Applications before using the renamed app. Having
both copies registered can cause competing extension connections. Then restart
Safari and enable Browser Hand if needed.

Setup installs a per-user login item and command symlink. The Safari relay
listens on localhost port 19334, separate from the default Chromium relay on
9333. Setup refuses to replace another command or login item or occupy a port
already in use. To remove it, run:

```sh
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/ai.autojack.browserhand.safari.standalone.plist
rm ~/Library/LaunchAgents/ai.autojack.browserhand.safari.standalone.plist ~/.local/bin/browser-hand-safari
```

Then remove the app from Applications. Its logs are in
`~/Library/Logs/Browser Hand`.

## Install from source

```sh
npm install
npm run build:relay
npm run safari:prepare
```

Open the generated project path printed by the command in Xcode. In **Signing &
Capabilities**, choose your Apple Development team for both the app and the
extension targets. Build and run the app, then copy **Browser Hand.app**
from Xcode's Products folder to `~/Applications`. Open the installed app and
enable **Browser Hand** in Safari Settings → Extensions. Grant website access
in Safari as needed, then start the relay and run `npm run doctor`.

The generated project defaults to `ai.autojack.browserhand.safari` as its app
bundle identifier. If that identifier belongs to another team, set
`BROWSER_HAND_SAFARI_BUNDLE_ID` to a reverse-DNS identifier owned by your team
before running `safari:prepare`. The script refuses to overwrite an existing
project; pass an unused output directory as its argument for another build.

The default extension relay port is 9333. The relay serves one connected
extension at a time, so Safari replaces Chrome or Search on the same relay. To
run Safari separately, choose a port at build time and use that same port for
the relay and CLI:

```sh
BROWSER_HAND_EXTENSION_RELAY_PORT=19333 npm run safari:prepare -- build/safari-19333
DEV_BROWSER_RELAY_PORT=19333 npm run relay
DEV_BROWSER_RELAY_PORT=19333 npm run browser-hand -- doctor
```

For a persistent per-user macOS relay, first stop any relay already using the
chosen port, then run `DEV_BROWSER_RELAY_PORT=19333 npm run safari:relay:install`.
This installs a separate LaunchAgent that starts at login and restarts if it
exits. It points at this checkout's built relay and Node executable; keep that
checkout and Node installation in place. The script prints the removal command
and will not overwrite an existing job or take over an occupied port. You can
also keep the relay in a terminal instead of installing the LaunchAgent.

For development, Safari 27 can also load `extension/dist/safari-mv3` using
Settings → Developer → **Add Temporary Extension…** after enabling unsigned
extensions. That is not the persistent signed installation. The signed app was
verified with **Allow unsigned extensions** turned off.

## Capabilities and limits

Safari uses a nonpersistent background page and the scripting transport. It
does not support `chrome.debugger`, tab groups, or Chrome's `userScripts` API.
A page content security policy that prohibits string evaluation can prevent
snapshot, fill, click, and evaluate. `--group-title` does not create Safari tab
groups. Safari may require per-site permission before page content can be
accessed. A healthy relay connection does not guarantee that a particular site
allows injection. Safari's site permissions determine which page data the
extension may access.

Live verification on Safari 27.0.1: the development-signed app was installed in
`~/Applications`, unsigned extensions were disabled, and Safari was restarted.
The relay observed the extension disconnect and reconnect; `doctor` returned
`tab_bootstrap_works`. A named background tab opened the local hello-form
challenge, and snapshot, fill, click, and evaluation succeeded. The page oracle
confirmed all fields were accepted. No third-party form was submitted. A
notarized Release build on port 19333 was also installed, reconnected after a
Safari restart, and passed the hello-form fill and submit test. The exact
standalone disk image was then installed on this Apple silicon Mac, its setup
button started the login item, and its bundled CLI passed the hello-form test
after a Safari restart without a system Node executable in PATH. The existing
Safari extension permissions were reused after removing a duplicate registration
from the earlier experimental app. Fresh-account permission
setup, older Safari versions, Intel Macs, restrictive CSP pages, a full macOS
login cycle, and long-term reconnection remain unverified.

## Preparing a download for other people

A user can install a properly signed, notarized Safari app without Xcode or an
Apple Developer account. The publisher needs a Developer ID Application
certificate and access to Apple's notary service. The locally development-signed
app is not suitable for distribution.

For the self-contained disk image, run the following on a publisher's Mac with the
dependencies installed. It downloads pinned Node binaries, verifies their
SHA-256 hashes, builds universal code, signs the nested runtime and app, then
notarizes and staples the result:

```sh
APPLE_DEVELOPER_IDENTITY='Developer ID Application: Your Team (TEAMID)' \
APPLE_NOTARY_PROFILE=your-keychain-profile \
npm run safari:standalone -- "$HOME/Downloads/Browser-Hand.dmg"
```

The result uses port 19334 and contains the CLI and relay. Both the app and the
disk image are independently signed, notarized, and stapled.

### Automated GitHub releases

Once these workflow changes are merged and the secrets below are configured,
Release Please calls the macOS build workflow when it creates a
`browser-hand-vX.Y.Z` release. A matching manually pushed tag also triggers it;
the two paths share a concurrency lock and skip assets already uploaded. The
workflow refuses partial pre-existing assets and never overwrites a release
download. It checks that the tag matches `package.json`, signs and notarizes
the app and image, and adds `Browser-Hand-macOS.dmg` and its SHA-256 file to
that release. The workflow can also be retried with **Build Safari download**
from the Actions tab for an existing matching release tag.

The normal build uses the release tag. To backfill an existing release after a
packaging fix, run the workflow manually with `source_ref` set to the full SHA
of a commit that descends from that tag and still has the same package version.
The job records the build commit in its log; the backfilled download therefore
comes from that commit rather than the original tag.

The GitHub repository needs these Actions secrets before the workflow can run:

| Secret | Value |
| --- | --- |
| `APPLE_SIGNING_CERTIFICATE_BASE64` | Base64 of the Developer ID Application certificate and private key exported as a password-protected `.p12` |
| `APPLE_SIGNING_CERTIFICATE_PASSWORD` | The password chosen during that export |
| `APPLE_NOTARY_APPLE_ID` | Apple Account email for a member of the developer team |
| `APPLE_NOTARY_TEAM_ID` | The Apple Developer team ID |
| `APPLE_NOTARY_PASSWORD` | An app-specific password for that Apple Account |

Export the `.p12` from Keychain Access yourself and set the secrets in GitHub
Settings → Secrets and variables → Actions. For the certificate value, run
`base64 -i /path/to/exported.p12 | pbcopy` locally and paste the clipboard into
the secret field; do not paste credentials into chat or commit the file. The
runner imports the key into a temporary keychain and deletes the temporary
material after the job. It creates a notarytool profile in the runner's
keychain using the app-specific password; the publisher's local keychain
profile is not available on a GitHub-hosted machine.

### Extension-only build

This older workflow requires a separate relay and CLI.

1. Run `npm run safari:prepare` and build a **Release** app in Xcode with both
   targets signed by the same **Developer ID Application** identity. Choose a
   bundle identifier belonging to your team if needed. Both signatures need a
   secure timestamp and must omit `com.apple.security.get-task-allow`. Preserve
   the app sandbox and outgoing network permission for the host and extension.
2. Configure a notarytool keychain profile through Apple's supported credential
   workflow. Never put the credential itself in a script or repository.
3. Run:

   ```sh
   APPLE_NOTARY_PROFILE=<profile-name> npm run safari:package -- \
     '/path/to/Browser Hand.app' '/path/to/Browser-Hand-Safari.zip'
   ```

The packaging command verifies both signatures, team and bundle identifiers,
Safari extension type, Hardened Runtime, secure timestamps and the absence of
the debugging entitlement; submits the app to Apple's notary service; staples
and validates the ticket; and writes a ZIP and SHA-256 file. It refuses to
replace an existing output and does not publish anything. A sandboxed Release
test build was accepted by the notary service and its ticket was stapled.

The extension-only app does not contain Node.js, the relay, or the CLI.
