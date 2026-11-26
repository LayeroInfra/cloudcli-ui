import AppKit
import WebKit

/// A plain browser window inside Companion: external links, `window.open`
/// popups and "Open in a new window" from the Browser panel all land here, so
/// nothing leaves the app for Safari or Chrome.
final class BrowserWindow: NSObject, NSWindowDelegate, WKNavigationDelegate, NSTextFieldDelegate {
  /// Strong references; a window drops out when it closes.
  private static var open: Set<BrowserWindow> = []

  /// Sign-ins survive restarts: unlike the workspace page, this store persists.
  private static func freshConfiguration() -> WKWebViewConfiguration {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    config.preferences.isElementFullscreenEnabled = true
    return config
  }

  let webView: WKWebView
  private let window: NSWindow
  private let address = NSTextField()
  private let back = NSButton()
  private let forward = NSButton()
  private let reload = NSButton()
  private var observations: [NSKeyValueObservation] = []

  /// Opens `url` in a new window.
  @discardableResult
  static func open(_ url: URL) -> BrowserWindow {
    let browser = BrowserWindow(configuration: freshConfiguration(), frame: nil)
    browser.webView.load(URLRequest(url: url))
    browser.show()
    return browser
  }

  /// A window for WebKit to load a popup into (see WebPageHost.createWebViewWith).
  static func openPopup(configuration: WKWebViewConfiguration, features: WKWindowFeatures) -> BrowserWindow {
    var frame: NSRect?
    if let width = features.width?.doubleValue, let height = features.height?.doubleValue {
      frame = NSRect(x: features.x?.doubleValue ?? 0, y: features.y?.doubleValue ?? 0, width: width, height: height)
    }
    let browser = BrowserWindow(configuration: configuration, frame: frame)
    browser.show()
    return browser
  }

  private init(configuration: WKWebViewConfiguration, frame: NSRect?) {
    webView = WKWebView(frame: .zero, configuration: configuration)
    window = NSWindow(
      contentRect: frame ?? NSRect(x: 0, y: 0, width: 1100, height: 760),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered, defer: false
    )
    super.init()
    webView.allowsBackForwardNavigationGestures = true
    webView.navigationDelegate = self
    webView.uiDelegate = WebPageHost.shared
    window.isReleasedWhenClosed = false
    window.delegate = self
    window.title = "Layero Workspace"
    window.contentView = makeContent()
    if frame == nil { window.center() }
    observe()
  }

  private func show() {
    Self.open.insert(self)
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  private func makeContent() -> NSView {
    for (button, symbol, label, action) in [
      (back, "chevron.left", "Назад", #selector(goBack)),
      (forward, "chevron.right", "Вперёд", #selector(goForward)),
      (reload, "arrow.clockwise", "Обновить", #selector(reloadPage)),
    ] {
      button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
      button.bezelStyle = .texturedRounded
      button.toolTip = label
      button.target = self
      button.action = action
    }
    address.placeholderString = "Адрес"
    address.delegate = self
    address.target = self
    address.action = #selector(go)
    address.lineBreakMode = .byTruncatingTail
    address.cell?.usesSingleLineMode = true

    let bar = NSStackView(views: [back, forward, reload, address])
    bar.orientation = .horizontal
    bar.spacing = 6
    bar.edgeInsets = NSEdgeInsets(top: 6, left: 8, bottom: 6, right: 8)
    address.setContentHuggingPriority(.defaultLow, for: .horizontal)

    let content = NSStackView(views: [bar, webView])
    content.orientation = .vertical
    content.spacing = 0
    content.alignment = .leading
    content.distribution = .fill
    bar.setContentHuggingPriority(.required, for: .vertical)
    webView.setContentHuggingPriority(.defaultLow, for: .vertical)
    for view in [bar, webView] {
      view.widthAnchor.constraint(equalTo: content.widthAnchor).isActive = true
    }
    return content
  }

  private func observe() {
    observations = [
      webView.observe(\.title) { [weak self] view, _ in
        guard let self else { return }
        self.window.title = view.title?.isEmpty == false ? view.title! : (view.url?.host ?? "Layero Workspace")
      },
      webView.observe(\.url) { [weak self] view, _ in
        guard let self, self.window.firstResponder !== self.address.currentEditor() else { return }
        self.address.stringValue = view.url?.absoluteString ?? ""
      },
      webView.observe(\.canGoBack) { [weak self] view, _ in self?.back.isEnabled = view.canGoBack },
      webView.observe(\.canGoForward) { [weak self] view, _ in self?.forward.isEnabled = view.canGoForward },
    ]
    back.isEnabled = false
    forward.isEnabled = false
  }

  @objc private func goBack() { webView.goBack() }
  @objc private func goForward() { webView.goForward() }
  @objc private func reloadPage() { webView.reload() }

  /// Typed addresses: a bare `localhost:5174` is http (the preview tunnel),
  /// anything else without a scheme is https.
  @objc private func go() {
    let text = address.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    let withScheme: String
    if text.contains("://") {
      withScheme = text
    } else if text.range(of: #"^(localhost|127\.0\.0\.1)(:|/|$)"#, options: [.regularExpression, .caseInsensitive]) != nil {
      withScheme = "http://" + text
    } else {
      withScheme = "https://" + text
    }
    guard let url = URL(string: withScheme), ["http", "https"].contains(url.scheme?.lowercased()) else {
      NSSound.beep()
      return
    }
    webView.load(URLRequest(url: url))
    window.makeFirstResponder(webView)
  }

  // MARK: WKNavigationDelegate

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    if navigationAction.shouldPerformDownload {
      decisionHandler(.download)
      return
    }
    let scheme = navigationAction.request.url?.scheme?.lowercased() ?? ""
    if ["http", "https", "about", "blob", "data", "file"].contains(scheme) {
      decisionHandler(.allow)
      return
    }
    decisionHandler(.cancel)
    // mailto:, tel: and app links have nothing to render here.
    if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url {
      NSWorkspace.shared.open(url)
    }
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationResponse: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    decisionHandler(WebPageHost.shouldDownload(navigationResponse) ? .download : .allow)
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    download.delegate = Downloads.shared
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    download.delegate = Downloads.shared
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    webView.reload()
  }

  // MARK: NSWindowDelegate

  func windowWillClose(_ notification: Notification) {
    observations.removeAll()
    webView.stopLoading()
    Self.open.remove(self)
  }
}
