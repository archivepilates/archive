// Run separately with swift. Never print or export any returned credential.
import Foundation
import Security
import Darwin

SecKeychainSetUserInteractionAllowed(false)
var keychain: SecKeychain?
let file = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Keychains/login.keychain-db").path
guard SecKeychainOpen(file, &keychain) == errSecSuccess, let keychain else { exit(2) }
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "com.archivepilates.ops.mac-unlock",
    kSecAttrAccount as String: String(getuid()),
    kSecMatchSearchList as String: [keychain],
    kSecReturnData as String: true,
]
var result: CFTypeRef?
let status = SecItemCopyMatching(query as CFDictionary, &result)
result = nil
print("{\"otherReaderDenied\":\(status == errSecInteractionNotAllowed || status == errSecAuthFailed),\"statusCode\":\(status)}")
exit(status == errSecInteractionNotAllowed || status == errSecAuthFailed ? 0 : 1)
