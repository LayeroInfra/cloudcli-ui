import AppKit
import WebKit

final class SignInPage: NSObject, WKNavigationDelegate {
  let webView: WKWebView
  private var activeURL: URL?
  var onFailure: (() -> Void)?

  override init() {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    webView = WKWebView(frame: .zero, configuration: config)
    super.init()
    webView.navigationDelegate = self
  }

  func load(_ url: URL) {
    activeURL = url
    webView.load(URLRequest(url: url, timeoutInterval: 10))
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    decisionHandler(navigationAction.request.url == activeURL ? .allow : .cancel)
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    if (error as NSError).code != NSURLErrorCancelled { onFailure?() }
  }
}
