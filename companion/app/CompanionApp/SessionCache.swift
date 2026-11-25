import Foundation
import Security

struct WorkspaceIdentity: Codable, Equatable {
  let workspaceHost: String
  let owner: String
}

struct SessionCache {
  private struct Session: Codable {
    let identity: WorkspaceIdentity
    let token: String
  }

  private let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "ai.layero.cloudcli-companion.workspace-session",
    kSecAttrAccount as String: "current",
  ]

  func token(for identity: WorkspaceIdentity?) -> String? {
    guard let identity else { return nil }
    var readQuery = query
    readQuery[kSecReturnData as String] = true
    var result: CFTypeRef?
    guard SecItemCopyMatching(readQuery as CFDictionary, &result) == errSecSuccess,
          let data = result as? Data,
          let session = try? JSONDecoder().decode(Session.self, from: data),
          session.identity == identity else { return nil }
    return session.token
  }

  func store(token: String, for identity: WorkspaceIdentity) {
    guard let data = try? JSONEncoder().encode(Session(identity: identity, token: token)) else { return }
    let value = [kSecValueData as String: data]
    if SecItemUpdate(query as CFDictionary, value as CFDictionary) == errSecItemNotFound {
      SecItemAdd(query.merging(value) { _, new in new } as CFDictionary, nil)
    }
  }

  func clear() -> Bool {
    let status = SecItemDelete(query as CFDictionary)
    return status == errSecSuccess || status == errSecItemNotFound
  }
}
