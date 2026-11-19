import Cocoa
import SafariServices

private let extensionID = (Bundle.main.bundleIdentifier ?? "ai.autojack.browserhand.safari") + ".Extension"

/// `Browser Hand --extension-state` prints Safari's real on/off state for the extension
/// as one line of JSON and exits before any window opens. `browser-hand-safari doctor`
/// runs it, because a relay with no extension cannot tell "Safari is closed" from
/// "the extension is turned off". Any other launch starts the app normally.
@main
enum BrowserHandMain {
    static func main() {
        if CommandLine.arguments.dropFirst().first == "--extension-state" {
            ExtensionStateCommand.run()
        }
        _ = NSApplicationMain(CommandLine.argc, CommandLine.unsafeArgv)
    }
}

/// Exit codes: 0 state read, 1 Safari returned an error, 2 Safari did not answer in time.
enum ExtensionStateCommand {
    static func run() -> Never {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionID) { state, error in
            if let state {
                finish(["enabled": state.isEnabled, "extension": extensionID], code: 0)
            }
            finish(["error": error?.localizedDescription ?? "Safari did not report a state.", "extension": extensionID], code: 1)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
            finish(["error": "Safari did not report the extension state within 5 seconds.", "extension": extensionID], code: 2)
        }
        dispatchMain()
    }

    private static func finish(_ object: [String: Any], code: Int32) -> Never {
        var data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
        data.append(0x0A)
        FileHandle.standardOutput.write(data)
        exit(code)
    }
}

class AppDelegate: NSObject, NSApplicationDelegate {

    func applicationDidFinishLaunching(_ notification: Notification) {
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

}
