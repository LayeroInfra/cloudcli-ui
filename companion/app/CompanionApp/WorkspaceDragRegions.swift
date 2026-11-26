import WebKit

final class WorkspaceDragRegions: NSObject, WKScriptMessageHandler {
  private(set) var rectangles: [CGRect] = []
  var onSwitchWorkspace: (() -> Void)?
  /// Popups opened from the workspace share its content controller; only the
  /// workspace page itself may move the title bar or switch workspaces.
  weak var webView: WKWebView?

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.frameInfo.isMainFrame, message.webView === webView else { return }
    if (message.body as? String) == "switch" {
      onSwitchWorkspace?()
      return
    }
    guard let values = message.body as? [[Double]] else { return }
    rectangles = values.compactMap { values in
      guard values.count == 4, values.allSatisfy(\.isFinite), values[2] > 0, values[3] > 0 else { return nil }
      return CGRect(x: values[0], y: values[1], width: values[2], height: values[3])
    }
  }

  // Treat only the gaps between visible controls and text as part of the title bar.
  static let script = """
    (() => {
      let pending = false;
      let observed;
      const resize = new ResizeObserver(schedule);
      function schedule() {
        if (pending) return;
        pending = true;
        setTimeout(update, 0);
      }
      function update() {
        pending = false;
        const header = document.querySelector('.fixed.inset-0.flex .pwa-header-safe');
        if (header !== observed) {
          resize.disconnect();
          observed = header;
          if (header) resize.observe(header);
        }
        const regions = [];
        if (header) {
          const bounds = header.getBoundingClientRect();
          const used = [];
          const exclude = ({left, right, width, height}) => {
            if (width > 0 && height > 0) used.push([left - 6, right + 6]);
          };
          header.querySelectorAll('button, a, input, select, textarea, [role="button"], [tabindex], svg, img')
            .forEach(element => exclude(element.getBoundingClientRect()));
          const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
          const range = document.createRange();
          while (walker.nextNode()) {
            if (!walker.currentNode.textContent.trim()) continue;
            range.selectNodeContents(walker.currentNode);
            for (const rect of range.getClientRects()) exclude(rect);
          }
          const top = Math.max(bounds.top, 0);
          const height = Math.min(bounds.bottom, innerHeight) - top;
          let start = Math.max(bounds.left + 6, 80);
          const end = Math.min(bounds.right - 6, innerWidth);
          const addGap = right => {
            if (right - start < 24 || height <= 0) return;
            const halfway = document.elementFromPoint((start + right) / 2, top + height / 2);
            if (header.contains(halfway)) regions.push([start, top, right - start, height]);
          };
          for (const [left, right] of used.sort((a, b) => a[0] - b[0])) {
            addGap(Math.min(left, end));
            start = Math.max(start, right);
          }
          addGap(end);
        }
        window.webkit.messageHandlers.workspaceDragRegions.postMessage(regions);
      }
      new MutationObserver(records => {
        if (!observed || !observed.isConnected || records.some(({target}) =>
          target === document.body || observed.contains(target) ||
          (target instanceof Element && target.closest('dialog, [role="dialog"], [aria-modal="true"]'))
        )) schedule();
      }).observe(document.body, {
        subtree: true, childList: true, characterData: true, attributes: true
      });
      window.addEventListener('resize', schedule);
      document.fonts?.ready.then(schedule);
      schedule();
    })();
    """
}
