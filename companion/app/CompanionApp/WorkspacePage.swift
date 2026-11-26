import AppKit
import WebKit

final class WorkspacePage: NSObject, WKNavigationDelegate {
  let webView: WKWebView
  let dragRegions = WorkspaceDragRegions()
  private let url = URL(string: "https://127.0.0.1:19443/")!
  private var completion: ((Bool) -> Void)?

  init(token: String, completion: @escaping (Bool) -> Void) {
    self.completion = completion
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    // A URL a workspace program asks to open (`$BROWSER`, login flows) arrives
    // over the shell socket, not from a click; without this WebKit drops it.
    config.preferences.javaScriptCanOpenWindowsAutomatically = true
    let encodedToken = String(decoding: try! JSONEncoder().encode(token), as: UTF8.self)
    config.userContentController.addUserScript(WKUserScript(
      source: """
        if (location.origin === 'https://127.0.0.1:19443') {
          localStorage.setItem('auth-token', \(encodedToken));
        }
        """,
      injectionTime: .atDocumentStart,
      forMainFrameOnly: true
    ))
    config.userContentController.add(dragRegions, contentWorld: .defaultClient, name: "workspaceDragRegions")
    config.userContentController.addUserScript(Self.windowIntegration)
    webView = WKWebView(frame: .zero, configuration: config)
    super.init()
    webView.navigationDelegate = self
    webView.uiDelegate = WebPageHost.shared
    dragRegions.webView = webView
  }

  func load() {
    webView.load(URLRequest(url: url, timeoutInterval: 35))
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    if navigationAction.shouldPerformDownload {
      decisionHandler(.download)
      return
    }
    let destination = navigationAction.request.url
    if destination?.scheme == url.scheme, destination?.host == url.host, destination?.port == url.port {
      decisionHandler(.allow)
      return
    }
    // Frames inside the workspace (the Browser panel's localhost preview,
    // srcdoc/blob previews) may load anything; only the top-level page is
    // pinned to the workspace UI.
    if let frame = navigationAction.targetFrame, !frame.isMainFrame {
      decisionHandler(.allow)
      return
    }
    decisionHandler(.cancel)
    if completion != nil {
      finish(false)
    } else if let destination, ["https", "http"].contains(destination.scheme?.lowercased()) {
      BrowserWindow.open(destination)
    }
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationResponse: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    if completion != nil, navigationResponse.isForMainFrame,
       let response = navigationResponse.response as? HTTPURLResponse,
       !(200..<300).contains(response.statusCode) {
      decisionHandler(.cancel)
      finish(false)
    } else if completion == nil, WebPageHost.shouldDownload(navigationResponse) {
      decisionHandler(.download)
    } else {
      decisionHandler(.allow)
    }
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    download.delegate = Downloads.shared
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    download.delegate = Downloads.shared
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard completion != nil else { return }
    webView.evaluateJavaScript("Boolean(localStorage.getItem('auth-token'))") { [weak self] value, error in
      self?.finish(error == nil && value as? Bool == true)
    }
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    finish(false)
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    finish(false)
  }

  private static let windowIntegration = WKUserScript(
    source: """
      // Popups the workspace opens share this configuration; leave them alone.
      if (location.origin === 'https://127.0.0.1:19443' && !window.opener) {
      const style = document.createElement('style');
      style.textContent = `
        .fixed.inset-0.flex.bg-background:has(> .flex.min-w-0.flex-1.flex-col) {
          padding-block-start: \(WorkspaceWindow.topDragInset)px;
        }
      `;
      document.head.append(style);
      \(WorkspaceDragRegions.script)
      \(WorkspacePage.profileAndStartupScript)
      }
      """,
    injectionTime: .atDocumentEnd,
    forMainFrameOnly: true,
    in: .defaultClient
  )

  private static let profileAndStartupScript = """
    (() => {
      const sidebar = '.fixed.inset-0.flex.bg-background > .relative.h-full.flex-shrink-0';
      const newChatSelector = `${sidebar} > .flex.h-full.flex-col > .flex-shrink-0 > button:has(> svg.lucide-square-pen)`;
      let shouldOpenNewChat = sessionStorage.getItem('layero-workspace.initial-route') !== 'opened';
      function stopAutoOpen(event) {
        if (event?.isTrusted === false) return;
        shouldOpenNewChat = false;
        sessionStorage.setItem('layero-workspace.initial-route', 'opened');
        document.removeEventListener('pointerdown', stopAutoOpen, true);
        document.removeEventListener('keydown', stopAutoOpen, true);
      }
      if (shouldOpenNewChat) {
        document.addEventListener('pointerdown', stopAutoOpen, true);
        document.addEventListener('keydown', stopAutoOpen, true);
      }

      function update() {
        if (shouldOpenNewChat) {
          const button = document.querySelector(newChatSelector);
          if (location.pathname !== '/') {
            stopAutoOpen();
          } else if (button) {
            stopAutoOpen();
            button.click();
          }
        }

        const source = document.querySelector(`${sidebar} [role="dialog"] a[href="https://github.com/LayeroInfra/cloudcli-ui"]`);
        if (source && !source.parentElement.querySelector('[data-workspace-switch]')) {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.workspaceSwitch = '';
          button.className = source.className;
          button.textContent = 'Сменить пространство';
          button.addEventListener('click', () => window.webkit.messageHandlers.workspaceDragRegions.postMessage('switch'));
          source.before(button);
        }
      }

      const observer = new MutationObserver(records => {
        if (records.some(record => record.addedNodes.length)) update();
      });
      observer.observe(document.body, { subtree: true, childList: true });
      update();
    })();
    """

  private func finish(_ loaded: Bool) {
    guard let completion else { return }
    self.completion = nil
    let scripts = webView.configuration.userContentController
    scripts.removeAllUserScripts()
    scripts.addUserScript(Self.windowIntegration)
    completion(loaded)
  }
}
