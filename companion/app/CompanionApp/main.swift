import AppKit
import Darwin

signal(SIGPIPE, SIG_IGN)

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate

let menu = NSMenu()
let appItem = NSMenuItem()
let appMenu = NSMenu(title: "Layero Workspace")
if #available(macOS 13.3, *) {
  BrowserWindow.addInspectorToggle(to: appMenu)
}
BrowserWindow.addPreviewDataReset(to: appMenu)
appMenu.addItem(.separator())
appMenu.addItem(
  withTitle: "Завершить Layero Workspace",
  action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"
)
appItem.submenu = appMenu
menu.addItem(appItem)

let editItem = NSMenuItem()
let editMenu = NSMenu(title: "Правка")
editMenu.addItem(withTitle: "Вырезать", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
editMenu.addItem(withTitle: "Копировать", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
editMenu.addItem(withTitle: "Вставить", action: #selector(WorkspaceWindow.pasteIntoWebView(_:)), keyEquivalent: "v")
editMenu.addItem(.separator())
editMenu.addItem(withTitle: "Выделить всё", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
editItem.submenu = editMenu
menu.addItem(editItem)
app.mainMenu = menu

app.run()
