// TI-34 MultiView — native macOS shell.
//
// A plain AppKit host around a WKWebView that renders src/ui/index.html. No
// nib/storyboard/SwiftUI: everything (window, menu bar, web view) is built in
// code, because this environment has only the Command Line Tools (no Xcode,
// no Interface Builder).
//
// This file is compiled as a single `main.swift`, so the top-level statements
// at the bottom are the program's entry point — no @main/@NSApplicationMain
// needed.

import AppKit
import WebKit

// Matches the faceplate's own 300:560 aspect, declared on `.calculator` in
// src/ui/faceplate.css. The two must agree: the CSS sizes the faceplate to
// whichever axis binds first, so a window of any other shape would leave a
// dead margin down one side. The window is locked to this ratio
// (contentAspectRatio below), so resizing stays in proportion.
private let baseSize = NSSize(width: 450, height: 840)

/// WKWebView that never shows a right-click context menu and never lets the
/// user drag-select text — an appliance, not a page. Suppressing the menu has
/// to happen here, at the NSView level (`menu(for:)`); WKUIDelegate's
/// context-menu hooks are iOS-only, there is no macOS equivalent.
private final class ApplianceWebView: WKWebView {
    override func menu(for event: NSEvent) -> NSMenu? {
        nil
    }
}

// Custom scheme the UI is served under (see BundleSchemeHandler below).
private let resourceScheme = "ti34resource"
private let resourceHost = "app"
// Name of the JS -> native message channel used for diagnostics (see below).
private let diagnosticsChannel = "diagnostics"

/// Serves files out of Resources/src under a custom URL scheme instead of
/// `file://`.
///
/// This isn't cosmetic: `loadFileURL(_:allowingReadAccessTo:)` was tried
/// first, as the natural API for "load a bundled HTML file with access to
/// its neighbours", but WebKit's `<script type="module">` fetches are
/// CORS-checked, and a `file://` document's origin doesn't satisfy that
/// check even for an import from its own directory — confirmed empirically
/// (a same-directory module import fails the same way a cross-directory one
/// does, while a classic non-module `<script src>` to the same file
/// succeeds). Serving everything from one `scheme://host` origin instead
/// sidesteps the problem entirely: every request the page makes, including
/// module imports, is same-origin.
private final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    let rootURL: URL

    init(rootURL: URL) {
        self.rootURL = rootURL
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let requestURL = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        // "ti34resource://app/ui/index.html" -> Resources/src/ui/index.html;
        // a relative import from that file (e.g. "../engine/tokens.js")
        // resolves, per ordinary URL rules, to
        // "ti34resource://app/engine/tokens.js" -> Resources/src/engine/tokens.js.
        let relativePath = requestURL.path.hasPrefix("/") ? String(requestURL.path.dropFirst()) : requestURL.path
        let fileURL = rootURL.appendingPathComponent(relativePath).standardizedFileURL

        // Everything served here is our own bundled content, so a traversal
        // attempt shouldn't be reachable — but the handler resolves a path
        // from a URL, so keep it boxed into Resources/src regardless.
        guard fileURL.path.hasPrefix(rootURL.standardizedFileURL.path + "/") else {
            urlSchemeTask.didFailWithError(URLError(.noPermissionsToReadFile))
            return
        }

        guard let data = try? Data(contentsOf: fileURL) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let response = URLResponse(
            url: requestURL,
            mimeType: Self.mimeType(for: fileURL),
            expectedContentLength: data.count,
            textEncodingName: "utf-8"
        )
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Loads above are synchronous and already finished by the time a
        // stop could arrive, so there's nothing to cancel.
    }

    private static func mimeType(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "html": return "text/html"
        case "js", "mjs": return "text/javascript"
        case "css": return "text/css"
        case "json": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        default: return "application/octet-stream"
        }
    }
}

private final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: ApplianceWebView!
    private var schemeHandler: BundleSchemeHandler!

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.mainMenu = Self.buildMainMenu()

        guard let resourcesURL = Bundle.main.resourceURL else {
            fatalError("app bundle has no Resources directory")
        }
        schemeHandler = BundleSchemeHandler(rootURL: resourcesURL.appendingPathComponent("src"))

        let contentController = WKUserContentController()
        contentController.addUserScript(Self.applianceScript)
        contentController.addUserScript(Self.diagnosticsScript)
        contentController.add(self, name: diagnosticsChannel)
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: resourceScheme)

        let contentRect = NSRect(origin: .zero, size: baseSize)
        webView = ApplianceWebView(frame: contentRect, configuration: configuration)
        webView.navigationDelegate = self
        webView.allowsMagnification = false
        webView.allowsBackForwardNavigationGestures = false

        window = NSWindow(
            contentRect: contentRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "TI-34 MultiView"
        window.contentView = webView
        window.contentMinSize = baseSize
        window.contentAspectRatio = baseSize
        window.isReleasedWhenClosed = false
        window.initialFirstResponder = webView

        // Restore the last frame the user left it at, if any; otherwise
        // center the default size. setFrameAutosaveName arranges for future
        // moves/resizes to be saved under the same key.
        let autosaveName = NSWindow.FrameAutosaveName("MainWindow")
        if !window.setFrameUsingName(autosaveName) {
            window.center()
        }
        window.setFrameAutosaveName(autosaveName)

        loadCalculatorUI()

        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(webView)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func loadCalculatorUI() {
        guard let url = URL(string: "\(resourceScheme)://\(resourceHost)/ui/index.html") else {
            fatalError("malformed resource URL")
        }
        webView.load(URLRequest(url: url))
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        disableScrollBounce(in: webView)
        window.makeFirstResponder(webView)
    }

    /// Elastic rubber-banding on macOS is a native NSScrollView behaviour;
    /// WKWebView embeds one internally, so find it and turn elasticity off
    /// (belt-and-suspenders alongside the CSS `overscroll-behavior` below).
    private func disableScrollBounce(in view: NSView) {
        if let scrollView = view as? NSScrollView {
            scrollView.verticalScrollElasticity = .none
            scrollView.horizontalScrollElasticity = .none
        }
        for subview in view.subviews {
            disableScrollBounce(in: subview)
        }
    }

    // MARK: - Menu bar

    private static func buildMainMenu() -> NSMenu {
        let appName = "TI-34 MultiView"
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenuItem.submenu = appMenu
        appMenu.addItem(withTitle: "About \(appName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide \(appName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        // Cmd+Q needs an actual menu item bound to terminate: — without a
        // programmatic main menu there is nothing to claim that key
        // equivalent, so it would otherwise do nothing.
        appMenu.addItem(withTitle: "Quit \(appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenuItem.submenu = editMenu
        // Targets are left nil so these route through the responder chain to
        // the web view, which implements the standard cut:/copy:/paste:
        // selectors itself.
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        return mainMenu
    }

    // MARK: - Appliance styling injected into every page load

    private static let applianceScript = WKUserScript(
        source: """
        (function () {
            var style = document.createElement('style');
            style.textContent = [
                '* { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }',
                'html, body { overscroll-behavior: none; }'
            ].join('\\n');
            document.documentElement.appendChild(style);
        })();
        """,
        injectionTime: .atDocumentStart,
        forMainFrameOnly: true
    )

    // MARK: - Diagnostics
    //
    // A JavaScript error inside a bundled WKWebView is completely invisible:
    // there is no console to open, and a page that fails to load its modules
    // just renders as a blank faceplate with no clue why. Forwarding errors
    // to the system log makes that debuggable from a terminal with
    //
    //     log show --last 2m --predicate 'process == "TI-34 MultiView"'
    //
    // The "ui ready" line doubles as confirmation that the ES modules
    // actually resolved over the ti34resource:// scheme.

    private static let diagnosticsScript = WKUserScript(
        source: """
        (function () {
            var send = function (kind, text) {
                try {
                    window.webkit.messageHandlers.diagnostics.postMessage(kind + ': ' + text);
                } catch (e) { /* handler absent outside the app — ignore */ }
            };
            window.addEventListener('error', function (e) {
                send('js error', (e.message || 'unknown') + ' @ ' + (e.filename || '?') + ':' + (e.lineno || 0));
            });
            window.addEventListener('unhandledrejection', function (e) {
                send('unhandled rejection', String((e.reason && e.reason.message) || e.reason));
            });
            window.addEventListener('load', function () {
                send('ui ready', document.querySelectorAll('[data-key]').length + ' keys rendered');
            });
        })();
        """,
        injectionTime: .atDocumentStart,
        forMainFrameOnly: true
    )
}

extension AppDelegate: WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == diagnosticsChannel else { return }
        NSLog("[ti34] %@", String(describing: message.body))
    }
}

private let app = NSApplication.shared
private let delegate = AppDelegate()
app.delegate = delegate
app.run()
