import AppKit
import Foundation

private struct SessionHandoff: Decodable {
  let token: String?
  let signInURL: URL?
  let cacheRejected: Bool?
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  private var companion: Process?
  private var stopping = false
  private var signInPage: SignInPage?
  private var workspacePage: WorkspacePage?
  private let window = WorkspaceWindow(
    contentRect: NSRect(x: 0, y: 0, width: 540, height: 660),
    styleMask: [.titled, .closable, .miniaturizable, .resizable],
    backing: .buffered, defer: false
  )
  private var sessionPipe: Pipe?
  private var sessionReply: FileHandle?
  private var handoffData = Data()
  private var handoffFailed = false
  private let sessionCache = SessionCache()
  private var pendingToken: String?

  private var shareDir: URL {
    FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(".local/share/cloudcli-companion")
  }

  private var stateDir: URL {
    FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(".local/state/cloudcli-companion")
  }

  private var readyFile: URL { stateDir.appendingPathComponent("ready.json") }
  private var startScript: URL { shareDir.appendingPathComponent("bin/start-companion.sh") }
  private var stopScript: URL { shareDir.appendingPathComponent("bin/stop-workspace.sh") }

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.regular)
    // Clear stale ready flag from a previous run.
    try? FileManager.default.removeItem(at: readyFile)

    window.title = "Layero Workspace"
    window.isReleasedWhenClosed = false
    window.center()
    showMessage("Открываем Layero Workspace…")
    revealWindow()

    ensureShareInstalled()
    startCompanion()
  }

  @objc func switchWorkspace(_ sender: Any?) {
    guard sessionCache.clear() else {
      showMessage("Не удалось сбросить сессию. Проверьте доступ к Связке ключей macOS.")
      return
    }
    stopEverything()
    stopping = false
    handoffFailed = false
    handoffData.removeAll()
    pendingToken = nil
    signInPage = nil
    workspacePage = nil
    window.restoreSignInTitleBar()
    window.setContentSize(NSSize(width: 540, height: 660))
    showMessage("Открываем форму входа…")
    startCompanion(switching: true)
  }

  private func currentIdentity() -> WorkspaceIdentity? {
    let file = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(".config/layero-workspace/identity.json")
    guard let data = try? Data(contentsOf: file) else { return nil }
    return try? JSONDecoder().decode(WorkspaceIdentity.self, from: data)
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    revealWindow()
    return true
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    stopEverything()
    return .terminateNow
  }

  func applicationWillTerminate(_ notification: Notification) {
    stopEverything()
  }

  private func revealWindow() {
    window.deminiaturize(nil)
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  private func showMessage(_ text: String) {
    let view = NSView()
    let label = NSTextField(wrappingLabelWithString: text)
    label.alignment = .center
    label.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(label)
    NSLayoutConstraint.activate([
      label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      label.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -60),
    ])
    window.contentView = view
  }

  private func commandSucceeded(_ executable: String, _ arguments: [String]) -> Bool {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    return runAndWait(process)
  }

  private func runAndWait(_ process: Process) -> Bool {
    do {
      try process.run()
      process.waitUntilExit()
      return process.terminationStatus == 0
    } catch {
      return false
    }
  }

  private func receiveHandoff(_ data: Data) {
    guard !stopping, workspacePage == nil, !handoffFailed else { return }
    handoffData.append(data)
    while let newline = handoffData.firstIndex(of: 10) {
      let handoff = try? JSONDecoder().decode(SessionHandoff.self, from: handoffData.prefix(upTo: newline))
      handoffData.removeSubrange(...newline)
      if handoff?.cacheRejected == true {
        _ = sessionCache.clear()
        continue
      }
      if let url = handoff?.signInURL, url.scheme == "http", url.host == "127.0.0.1", url.port != nil {
        let page = signInPage ?? SignInPage()
        page.onFailure = { [weak self] in self?.completeHandoff(false) }
        signInPage = page
        window.contentView = page.webView
        window.makeFirstResponder(page.webView)
        page.load(url)
      } else if let token = handoff?.token, !token.isEmpty {
        sessionPipe?.fileHandleForReading.readabilityHandler = nil
        signInPage = nil
        showMessage("Подключаемся к пространству…")
        pendingToken = token
        let page = WorkspacePage(token: token) { [weak self] loaded in
          self?.completeHandoff(loaded)
        }
        page.dragRegions.onSwitchWorkspace = { [weak self] in self?.switchWorkspace(nil) }
        workspacePage = page
        page.load()
        return
      } else {
        completeHandoff(false)
        return
      }
    }
    if data.isEmpty || handoffData.count > 65536 {
      sessionPipe?.fileHandleForReading.readabilityHandler = nil
      if !data.isEmpty { completeHandoff(false) }
    }
  }

  private func completeHandoff(_ loaded: Bool) {
    guard !stopping, !handoffFailed else { return }
    if let reply = sessionReply {
      // Closing stdin also releases the launch script if the reply cannot be delivered.
      try? reply.write(contentsOf: Data((loaded ? "ready\n" : "failed\n").utf8))
      try? reply.close()
      sessionReply = nil
    }
    defer { pendingToken = nil }
    if loaded, let page = workspacePage {
      if let token = pendingToken, let identity = currentIdentity() {
        sessionCache.store(token: token, for: identity)
      }
      window.dragRegions = page.dragRegions
      window.mergeTitleBarWithWorkspace()
      let available = window.screen?.visibleFrame.size ?? NSSize(width: 1120, height: 760)
      window.setContentSize(NSSize(width: min(1120, available.width), height: min(760, available.height - 30)))
      window.center()
      window.contentView = page.webView
      window.makeFirstResponder(page.webView)
    } else {
      handoffFailed = true
      signInPage = nil
      workspacePage = nil
      showMessage("Пространство не открылось. Проверьте подключение и запустите Layero Workspace снова.")
    }
  }

  private func ensureShareInstalled() {
    let fm = FileManager.default
    let source = Bundle.main.bundleURL
      .deletingLastPathComponent()
      .appendingPathComponent("cloudcli-companion")
    let installer = source.appendingPathComponent("bin/install.sh")
    guard fm.isExecutableFile(atPath: installer.path) else { return }

    let sourceBinary = source.appendingPathComponent("app/Companion.app/Contents/MacOS/companion")
    let installedBinary = shareDir.appendingPathComponent("app/Companion.app/Contents/MacOS/companion")
    guard !fm.isExecutableFile(atPath: startScript.path)
      || !fm.contentsEqual(atPath: sourceBinary.path, andPath: installedBinary.path)
    else { return }

    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/bin/bash")
    proc.arguments = [installer.path]
    proc.environment = ProcessInfo.processInfo.environment.merging(["SKIP_IDENTITY": "1"]) { _, n in n }
    _ = runAndWait(proc)
  }

  private func startCompanion(switching: Bool = false) {
    try? FileManager.default.createDirectory(at: stateDir, withIntermediateDirectories: true)
    guard FileManager.default.isExecutableFile(atPath: startScript.path) else {
      showMessage("Переустановите Layero Workspace.")
      return
    }

    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/bin/bash")
    proc.arguments = [startScript.path]
    proc.environment = ProcessInfo.processInfo.environment.merging(["WORKSPACE_NATIVE_SESSION": "1", "WORKSPACE_SWITCH": switching ? "1" : "0"]) { _, new in new }
    let output = Pipe()
    let input = Pipe()
    proc.standardOutput = output
    proc.standardInput = input
    sessionPipe = output
    sessionReply = input.fileHandleForWriting
    output.fileHandleForReading.readabilityHandler = { [weak self, weak output] handle in
      let data = handle.availableData
      if data.isEmpty { handle.readabilityHandler = nil }
      DispatchQueue.main.async {
        guard let self, let output, self.sessionPipe === output else { return }
        self.receiveHandoff(data)
      }
    }
    let log = stateDir.appendingPathComponent("app.log")
    if !FileManager.default.fileExists(atPath: log.path) {
      FileManager.default.createFile(atPath: log.path, contents: nil)
    }
    if let handle = try? FileHandle(forWritingTo: log) {
      _ = try? handle.seekToEnd()
      proc.standardError = handle
    }
    proc.terminationHandler = { [weak self] process in
      DispatchQueue.main.async {
        guard let self, !self.stopping, self.companion === process else { return }
        if process.terminationStatus != 0, !self.handoffFailed { self.completeHandoff(false) }
        self.stopEverything()
        if !self.handoffFailed { NSApp.terminate(nil) }
      }
    }
    do {
      try proc.run()
      companion = proc
      try? output.fileHandleForWriting.close()
      try? input.fileHandleForReading.close()
      let token = switching ? "" : sessionCache.token(for: currentIdentity()) ?? ""
      do {
        try input.fileHandleForWriting.write(contentsOf: Data((token + "\n").utf8))
      } catch {
        completeHandoff(false)
        stopEverything()
      }
    } catch {
      showMessage("Не удалось запустить Layero Workspace. \(error.localizedDescription)")
    }
  }

  private func stopEverything() {
    if stopping { return }
    stopping = true
    sessionPipe?.fileHandleForReading.readabilityHandler = nil
    try? sessionReply?.close()
    sessionReply = nil
    try? FileManager.default.removeItem(at: readyFile)

    guard let companion else { return }
    if companion.isRunning {
      companion.terminate()
      let deadline = Date().addingTimeInterval(1.5)
      while companion.isRunning, Date() < deadline {
        Thread.sleep(forTimeInterval: 0.05)
      }
      if companion.isRunning { companion.interrupt() }
    }
    self.companion = nil

    if FileManager.default.isExecutableFile(atPath: stopScript.path) {
      _ = commandSucceeded("/bin/bash", [stopScript.path])
    }
  }

}
