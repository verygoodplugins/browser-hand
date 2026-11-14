import Cocoa
import SafariServices
import WebKit

private let extensionID = "ai.autojack.browserhand.safari.Extension"

class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {
    @IBOutlet var webView: WKWebView!
    private var sizedWindow = false

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.navigationDelegate = self
        webView.configuration.userContentController.add(self, name: "controller")
        guard let page = Bundle.main.url(forResource: "Main", withExtension: "html") else { return }
        webView.loadFileURL(page, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        guard !sizedWindow, let window = view.window else { return }
        sizedWindow = true
        window.setContentSize(NSSize(width: 560, height: 560))
        window.center()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionID) { state, _ in
            DispatchQueue.main.async {
                webView.evaluateJavaScript("extensionState(\(state?.isEnabled == true ? "true" : "false"))")
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let action = message.body as? String else { return }
        if action == "preferences" {
            SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionID) { _ in }
            return
        }
        guard action == "setup", let resources = Bundle.main.resourceURL else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            let process = Process()
            let output = Pipe()
            process.executableURL = resources.appendingPathComponent("runtime/node")
            process.arguments = [resources.appendingPathComponent("runtime/setup.mjs").path, resources.path]
            process.standardOutput = output
            process.standardError = output
            var message = "Could not start setup."
            var success = false
            do {
                try process.run()
                let data = output.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                message = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? message
                success = process.terminationStatus == 0
            } catch { message = error.localizedDescription }
            let json = try? JSONSerialization.data(withJSONObject: [message], options: [])
            let literal = json.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"Setup failed.\"]"
            DispatchQueue.main.async {
                self.webView.evaluateJavaScript("setupResult(\(success ? "true" : "false"), \(literal)[0])")
            }
        }
    }
}
