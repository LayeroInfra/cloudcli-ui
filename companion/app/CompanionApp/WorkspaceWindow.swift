import AppKit
import WebKit

final class WorkspaceWindow: NSWindow {
  static let topDragInset = 24
  var dragRegions: WorkspaceDragRegions?
  func mergeTitleBarWithWorkspace() {
    styleMask.insert(.fullSizeContentView)
    titleVisibility = .hidden
    titlebarAppearsTransparent = true
    titlebarSeparatorStyle = .none
    contentMinSize.width = 800
  }

  func restoreSignInTitleBar() {
    dragRegions = nil
    contentMinSize.width = 0
    styleMask.remove(.fullSizeContentView)
    titleVisibility = .visible
    titlebarAppearsTransparent = false
    titlebarSeparatorStyle = .automatic
  }

  override func sendEvent(_ event: NSEvent) {
    if event.type == .leftMouseDown, canDrag(at: event.locationInWindow) {
      performDrag(with: event)
      return
    }
    super.sendEvent(event)
  }

  func canDrag(at locationInWindow: CGPoint) -> Bool {
    guard styleMask.contains(.fullSizeContentView), !styleMask.contains(.fullScreen),
          let contentView else { return false }
    let point = contentView.convert(locationInWindow, from: nil)
    let bounds = contentView.bounds
    let x = point.x - bounds.minX
    let y = contentView.isFlipped ? point.y - bounds.minY : bounds.maxY - point.y
    return dragRegions?.rectangles.contains { $0.contains(CGPoint(x: x, y: y)) } == true ||
      (y >= 0 && y < CGFloat(Self.topDragInset) && x >= 80)
  }

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    if event.modifierFlags.intersection([.command, .shift, .control, .option]) == .command,
       event.charactersIgnoringModifiers?.lowercased() == "v" || event.keyCode == 9,
       pasteIntoWebView(nil) {
      return true
    }
    return super.performKeyEquivalent(with: event)
  }

  @objc @discardableResult
  func pasteIntoWebView(_ sender: Any?) -> Bool {
    guard let webView = contentView as? WKWebView else { return false }
    return webView.tryToPerform(#selector(NSText.paste(_:)), with: sender)
  }
}
