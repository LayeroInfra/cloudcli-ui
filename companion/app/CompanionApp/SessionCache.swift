import CryptoKit
import Foundation
import LocalAuthentication
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

  // Local ad-hoc builds have different signing identities. Avoid reusing a
  // Keychain item whose access list belongs to an older build.
  private let account: String? = Bundle.main.executableURL
    .flatMap { try? Data(contentsOf: $0, options: .mappedIfSafe) }
    .map { SHA256.hash(data: $0).map { String(format: "%02x", $0) }.joined() }

  private func withQuery<Value>(fallback: Value, _ operation: ([String: Any]) -> Value) -> Value {
    guard let account else { return fallback }
    let context = LAContext()
    context.interactionNotAllowed = true

    // The file-based macOS login Keychain can open ACL dialogs independently
    // of LAContext. Disable optional UI only during this cache operation.
    var previous = DarwinBoolean(true)
    guard SecKeychainGetUserInteractionAllowed(&previous) == errSecSuccess,
          SecKeychainSetUserInteractionAllowed(false) == errSecSuccess else { return fallback }
    defer { _ = SecKeychainSetUserInteractionAllowed(previous.boolValue) }

    return operation([
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "ai.layero.cloudcli-companion.workspace-session",
      kSecAttrAccount as String: account,
      kSecUseAuthenticationContext as String: context,
    ])
  }

  func token(for identity: WorkspaceIdentity?) -> String? {
    guard let identity else { return nil }
    return withQuery(fallback: nil) { query -> String? in
      var readQuery = query
      readQuery[kSecReturnData as String] = true
      var result: CFTypeRef?
      guard SecItemCopyMatching(readQuery as CFDictionary, &result) == errSecSuccess,
            let data = result as? Data,
            let session = try? JSONDecoder().decode(Session.self, from: data),
            session.identity == identity else { return nil }
      return session.token
    }
  }

  func store(token: String, for identity: WorkspaceIdentity) {
    guard let data = try? JSONEncoder().encode(Session(identity: identity, token: token)) else { return }
    withQuery(fallback: ()) { query in
      let value = [kSecValueData as String: data]
      if SecItemUpdate(query as CFDictionary, value as CFDictionary) == errSecItemNotFound {
        SecItemAdd(query.merging(value) { _, new in new } as CFDictionary, nil)
      }
    }
  }

  func clear() -> Bool {
    withQuery(fallback: false) { query in
      let status = SecItemDelete(query as CFDictionary)
      return status == errSecSuccess || status == errSecItemNotFound
    }
  }
}
