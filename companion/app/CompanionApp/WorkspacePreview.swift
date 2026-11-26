import AppKit
import WebKit

final class WorkspaceContentView: NSView {
  let workspace: WKWebView
  var activePreview: WKWebView?

  override var isFlipped: Bool { true }

  init(workspace: WKWebView) {
    self.workspace = workspace
    super.init(frame: workspace.frame)
    workspace.frame = bounds
    workspace.autoresizingMask = [.width, .height]
    addSubview(workspace)
  }

  required init?(coder: NSCoder) { nil }

  func webView(for responder: NSResponder?) -> WKWebView {
    if let activePreview, let responder = responder as? NSView,
       responder.isDescendant(of: activePreview) {
      return activePreview
    }
    return workspace
  }
}

final class WorkspacePreview: NSObject, WKScriptMessageHandler {
  private struct Layout: Decodable {
    struct Slot: Decodable {
      let id: Int
      let url: URL
      let x: Double
      let y: Double
      let width: Double
      let height: Double
    }
    let open: Bool
    let ids: [Int]
    let viewportWidth: Double
    let slot: Slot?
  }

  weak var contentView: WorkspaceContentView?
  private let origin: URL
  private let store = WKWebsiteDataStore.nonPersistent()
  private var pages: [Int: PreviewPage] = [:]

  init(origin: URL) {
    self.origin = origin
  }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    let source = message.frameInfo.securityOrigin
    guard message.frameInfo.isMainFrame,
          source.protocol == origin.scheme, source.host == origin.host, source.port == origin.port,
          let json = message.body as? String, json.utf8.count < 16384,
          let layout = try? JSONDecoder().decode(Layout.self, from: Data(json.utf8)),
          let contentView else { return }

    for id in Array(pages.keys) where !layout.open || !layout.ids.contains(id) {
      pages.removeValue(forKey: id)?.view.removeFromSuperview()
    }
    for page in pages.values { page.view.isHidden = true }
    contentView.activePreview = nil

    guard layout.open, let slot = layout.slot, layout.ids.contains(slot.id),
          BrowserWindow.isLocalPreview(slot.url),
          layout.viewportWidth.isFinite, layout.viewportWidth > 0,
          [slot.x, slot.y, slot.width, slot.height].allSatisfy(\.isFinite),
          slot.width > 0, slot.height > 0 else { return }

    let scale = contentView.bounds.width / layout.viewportWidth
    let frame = CGRect(x: slot.x * scale, y: slot.y * scale, width: slot.width * scale, height: slot.height * scale)
    guard frame.width > 0, frame.height > 0,
          contentView.bounds.insetBy(dx: -1, dy: -1).contains(frame) else { return }

    let page: PreviewPage
    if let existing = pages[slot.id], existing.url == slot.url {
      page = existing
    } else {
      pages.removeValue(forKey: slot.id)?.view.removeFromSuperview()
      page = PreviewPage(url: slot.url, store: store)
      pages[slot.id] = page
      contentView.addSubview(page.view, positioned: .above, relativeTo: contentView.workspace)
    }
    page.view.frame = frame
    page.view.isHidden = false
    contentView.activePreview = page.webView
  }

  static let integration = """
    (() => {
      const ids = new WeakMap();
      let nextId = 0;
      let queued = false;
      let lastLayout = '';
      let panel;
      let watchedFrame;
      const resize = new ResizeObserver(schedule);
      function schedule() {
        if (queued) return;
        queued = true;
        setTimeout(update, 0);
      }
      function update() {
        queued = false;
        const panels = document.querySelectorAll('aside:has([role="tablist"])');
        const current = Array.from(panels).find(node =>
          node.querySelector('iframe[sandbox~="allow-same-origin"][referrerpolicy="no-referrer"]'));
        const open = Boolean(current?.getClientRects().length);
        const frames = open ? Array.from(current.querySelectorAll('iframe[sandbox~="allow-same-origin"][referrerpolicy="no-referrer"]')) : [];
        const frame = frames.find(item => item.getClientRects().length);
        if (current !== panel || frame !== watchedFrame) {
          resize.disconnect();
          panel = current;
          watchedFrame = frame;
          if (panel) resize.observe(panel);
          if (frame) resize.observe(frame);
        }
        const all = frames.map(item => {
          if (!ids.has(item)) ids.set(item, ++nextId);
          return ids.get(item);
        });
        let slot = null;
        if (frame) {
          const rect = frame.getBoundingClientRect();
          const unobscured = [0.15, 0.5, 0.85].every(x => [0.15, 0.5, 0.85].every(y =>
            document.elementFromPoint(rect.x + x * rect.width, rect.y + y * rect.height) === frame));
          if (unobscured && rect.width > 0 && rect.height > 0) {
            const { x, y, width, height } = rect;
            slot = { id: ids.get(frame), url: frame.src, x, y, width, height };
          }
        }
        const layout = JSON.stringify({ open, ids: all, viewportWidth: innerWidth, slot });
        if (layout !== lastLayout) {
          lastLayout = layout;
          window.webkit.messageHandlers.workspacePreviewLayout.postMessage(layout);
        }
      }
      new MutationObserver(schedule).observe(document.body, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'src', 'style', 'open']
      });
      window.addEventListener('resize', schedule);
      window.addEventListener('scroll', schedule, true);
      schedule();
    })();
    """
}

private final class PreviewPage: NSObject, WKNavigationDelegate {
  let url: URL
  let view = NSView()
  let webView: WKWebView
  private static let loadingMessage = "Загружаем страницу…"
  private let status = NSTextField(wrappingLabelWithString: PreviewPage.loadingMessage)

  init(url: URL, store: WKWebsiteDataStore) {
    self.url = url
    let config = WKWebViewConfiguration()
    config.websiteDataStore = store
    webView = WKWebView(frame: .zero, configuration: config)
    super.init()

    view.wantsLayer = true
    view.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
    webView.autoresizingMask = [.width, .height]
    view.addSubview(webView)
    webView.isHidden = true
    webView.navigationDelegate = self
    webView.uiDelegate = WebPageHost.shared
    BrowserWindow.trackInspector(webView)
    status.alignment = .center
    status.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(status)
    NSLayoutConstraint.activate([
      status.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      status.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      status.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -24),
    ])
    openPreview()
  }

  private func openPreview() {
    guard url.port == 5174,
          var built = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
      webView.load(URLRequest(url: url, timeoutInterval: 35))
      return
    }
    built.port = 25174
    guard let builtURL = built.url else { return }
    built.path = "/__workspace_built_preview"
    built.query = nil
    built.fragment = nil
    guard let marker = built.url else { return }

    let request = URLRequest(url: marker, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 1.5)
    URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
      let http = response as? HTTPURLResponse
      let body = data.flatMap { String(data: $0, encoding: .utf8) }
      let available = http?.statusCode == 200 && http?.url == marker &&
        body?.range(of: #"^workspace-built-preview [a-f0-9]{40}\s*$"#, options: .regularExpression) != nil
      DispatchQueue.main.async {
        guard let self else { return }
        self.webView.load(URLRequest(url: available ? builtURL : self.url, timeoutInterval: 35))
      }
    }.resume()
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    if webView.isHidden {
      status.stringValue = Self.loadingMessage
      status.isHidden = false
    }
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    // The page can now paint. Subresources may still be loading.
    status.isHidden = true
    webView.isHidden = false
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    showError(error)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    showError(error)
  }

  private func showError(_ error: Error) {
    guard (error as NSError).code != NSURLErrorCancelled else { return }
    status.stringValue = "Страница не открылась. Обновите вкладку и проверьте, что сервер запущен."
    status.isHidden = false
    webView.isHidden = true
  }
}
