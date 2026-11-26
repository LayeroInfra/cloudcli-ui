import AppKit
import WebKit

/// What every Companion web view needs from its host app: JavaScript dialogs,
/// the file picker, new windows and downloads. Without a WKUIDelegate WebKit
/// silently drops all of them (`confirm()` returns false, `<input type=file>`
/// does nothing, `window.open` returns null). `uiDelegate` is weak, hence the
/// shared instance.
final class WebPageHost: NSObject, WKUIDelegate {
  static let shared = WebPageHost()

  // MARK: New windows

  /// `target=_blank`, `window.open`: a Companion browser window. WebKit loads
  /// the request into the returned view itself, keeping `window.opener`, which
  /// OAuth popups and pages written with `document.write` rely on.
  func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    BrowserWindow.openPopup(configuration: configuration, features: windowFeatures).webView
  }

  // MARK: JavaScript dialogs

  func webView(
    _ webView: WKWebView,
    runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping () -> Void
  ) {
    let alert = Self.alert(message, frame: frame)
    alert.addButton(withTitle: "OK")
    Self.present(alert, in: webView) { _ in completionHandler() }
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptConfirmPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping (Bool) -> Void
  ) {
    let alert = Self.alert(message, frame: frame)
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Отмена")
    Self.present(alert, in: webView) { completionHandler($0 == .alertFirstButtonReturn) }
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptTextInputPanelWithPrompt prompt: String,
    defaultText: String?,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping (String?) -> Void
  ) {
    let alert = Self.alert(prompt, frame: frame)
    let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
    field.stringValue = defaultText ?? ""
    alert.accessoryView = field
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Отмена")
    alert.window.initialFirstResponder = field
    Self.present(alert, in: webView) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
  }

  // MARK: File picker

  func webView(
    _ webView: WKWebView,
    runOpenPanelWith parameters: WKOpenPanelParameters,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping ([URL]?) -> Void
  ) {
    let panel = NSOpenPanel()
    panel.canChooseFiles = true
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    let finish: (NSApplication.ModalResponse) -> Void = { completionHandler($0 == .OK ? panel.urls : nil) }
    if let window = webView.window {
      panel.beginSheetModal(for: window, completionHandler: finish)
    } else {
      finish(panel.runModal())
    }
  }

  /// `window.close()` from a popup (OAuth flows end this way). Only browser
  /// windows close; the workspace window is never script-closable.
  func webViewDidClose(_ webView: WKWebView) {
    if webView.window?.delegate is BrowserWindow { webView.window?.close() }
  }

  // MARK: Downloads

  /// `<a download>` and responses WebKit cannot show (zip, binaries, `Content-Disposition: attachment`).
  static func shouldDownload(_ response: WKNavigationResponse) -> Bool {
    if !response.canShowMIMEType { return true }
    let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")
    return disposition?.lowercased().hasPrefix("attachment") == true
  }

  // MARK: Helpers

  private static func alert(_ text: String, frame: WKFrameInfo) -> NSAlert {
    let alert = NSAlert()
    let origin = frame.securityOrigin
    alert.messageText = origin.host.isEmpty ? "Страница сообщает" : (origin.port == 0 ? origin.host : "\(origin.host):\(origin.port)")
    alert.informativeText = text
    return alert
  }

  private static func present(_ alert: NSAlert, in webView: WKWebView, completion: @escaping (NSApplication.ModalResponse) -> Void) {
    if let window = webView.window {
      alert.beginSheetModal(for: window, completionHandler: completion)
    } else {
      completion(alert.runModal())
    }
  }
}

/// Saves into ~/Downloads under a free name and bounces the Dock's Downloads stack.
final class Downloads: NSObject, WKDownloadDelegate {
  static let shared = Downloads()
  private var destinations: [ObjectIdentifier: URL] = [:]

  func download(
    _ download: WKDownload,
    decideDestinationUsing response: URLResponse,
    suggestedFilename: String,
    completionHandler: @escaping (URL?) -> Void
  ) {
    let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    let name = (suggestedFilename as NSString).lastPathComponent
    let safeName = name.isEmpty || name == "." || name == ".." ? "download" : name
    var candidate = folder.appendingPathComponent(safeName)
    let base = candidate.deletingPathExtension().lastPathComponent
    let ext = candidate.pathExtension
    var index = 1
    while FileManager.default.fileExists(atPath: candidate.path) {
      index += 1
      candidate = folder.appendingPathComponent(ext.isEmpty ? "\(base) \(index)" : "\(base) \(index).\(ext)")
    }
    destinations[ObjectIdentifier(download)] = candidate
    completionHandler(candidate)
  }

  func downloadDidFinish(_ download: WKDownload) {
    guard let file = destinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
    DistributedNotificationCenter.default().post(name: .init("com.apple.DownloadFileFinished"), object: file.path)
    NSApp.requestUserAttention(.informationalRequest)
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    let file = destinations.removeValue(forKey: ObjectIdentifier(download))
    let alert = NSAlert()
    alert.messageText = "Не удалось скачать \(file?.lastPathComponent ?? "файл")"
    alert.informativeText = error.localizedDescription
    alert.runModal()
  }
}
