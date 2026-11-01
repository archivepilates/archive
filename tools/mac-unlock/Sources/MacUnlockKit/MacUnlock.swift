import AppKit
import CoreGraphics
import CryptoKit
import Darwin
import Foundation
import Security

struct Stop: Error { let code: String; init(_ code: String) { self.code = code } }

struct Session: Codable, Equatable {
    let host: String
    let uid: UInt32
    let id: String
    let locked: Bool
    let lockTime: String?
    var epoch: String? { lockTime.map { id + ":" + $0 } }
}

struct Attempt: Codable {
    let epoch: String
    var phase: String
    let at: String
}

struct State: Codable {
    let version: Int
    let host: String
    let uid: UInt32
    var unlockedSession: String
    var blocked: Bool
    var attempt: Attempt?
}

struct Field: Equatable {
    let count: Int
    let characters: Int
    let focused: Bool
    let abc: Bool
}

func gate(_ s: Session, _ state: State) throws {
    guard state.version == 1, state.host == s.host, state.uid == s.uid else { throw Stop("host_or_user_mismatch") }
    guard s.locked, let epoch = s.epoch else { throw Stop("lock_evidence_missing") }
    guard state.unlockedSession == s.id else { throw Stop("new_login_requires_arm") }
    guard !state.blocked, state.attempt?.epoch != epoch else { throw Stop("attempt_already_consumed") }
}

struct Stroke { let code: CGKeyCode; let shift: Bool }

func strokes(_ bytes: Data) throws -> [Stroke] {
    guard !bytes.isEmpty, bytes.count <= 128 else { throw Stop("unsupported_credential_length") }
    let lower = Array("abcdefghijklmnopqrstuvwxyz".utf8)
    let codes: [CGKeyCode] = [0,11,8,2,14,3,5,4,34,38,40,37,46,45,31,35,12,15,1,17,32,9,13,7,16,6]
    var map = Dictionary(uniqueKeysWithValues: zip(lower, codes).map { ($0, Stroke(code: $1, shift: false)) })
    for (c, code) in zip(Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ".utf8), codes) { map[c] = Stroke(code: code, shift: true) }
    let plain = Array("1234567890-=[]\\;',./` ".utf8)
    let shifted = Array("!@#$%^&*()_+{}|:\"<>?~ ".utf8)
    let other: [CGKeyCode] = [18,19,20,21,23,22,26,28,25,29,27,24,33,30,42,41,39,43,47,44,50,49]
    for (c, code) in zip(plain, other) { map[c] = Stroke(code: code, shift: false) }
    for (c, code) in zip(shifted, other) where c != 32 { map[c] = Stroke(code: code, shift: true) }
    return try bytes.map { guard let s = map[$0] else { throw Stop("unsupported_credential_character") }; return s }
}

func command(_ path: String, _ args: [String]) throws -> Data {
    let p = Process(), output = Pipe(), error = Pipe()
    p.executableURL = URL(fileURLWithPath: path)
    p.arguments = args
    p.standardInput = FileHandle.nullDevice
    p.standardOutput = output
    p.standardError = error
    try p.run()
    let data = output.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    guard p.terminationStatus == 0 else { throw Stop("native_probe_failed") }
    return data
}

func session() throws -> Session {
    let root = try PropertyListSerialization.propertyList(from: command("/usr/sbin/ioreg", ["-n","Root","-d","1","-a"]), format: nil)
    var dictionaries: [[String: Any]] = []
    func visit(_ value: Any) {
        if let d = value as? [String: Any] { dictionaries.append(d); d.values.forEach(visit) }
        else if let a = value as? [Any] { a.forEach(visit) }
    }
    visit(root)
    guard let locked = dictionaries.compactMap({ $0["IOConsoleLocked"] as? Bool }).first else { throw Stop("lock_state_unknown") }
    let consoles = dictionaries.filter { ($0["kCGSSessionOnConsoleKey"] as? Bool) == true }
    guard consoles.count == 1, let c = consoles.first,
          (c["kCGSSessionUserIDKey"] as? NSNumber)?.uint32Value == getuid(),
          getuid() == geteuid(), getuid() != 0,
          (c["kCGSessionLoginDoneKey"] as? Bool) == true,
          let id = c["CGSSessionUniqueSessionUUID"] as? String else { throw Stop("not_own_existing_console_session") }
    if let second = c["CGSSessionScreenIsLocked"] as? Bool, second != locked { throw Stop("lock_state_disagreement") }
    let hardware = try PropertyListSerialization.propertyList(from: command("/usr/sbin/ioreg", ["-r","-d","1","-c","IOPlatformExpertDevice","-a"]), format: nil)
    guard let a = hardware as? [[String: Any]], let uuid = a.first?["IOPlatformUUID"] as? String else { throw Stop("host_identity_missing") }
    let host = SHA256.hash(data: Data(uuid.utf8)).map { String(format: "%02x", $0) }.joined()
    let time = (c["CGSSessionScreenLockedTime"] as? NSNumber)?.stringValue
    if locked && time == nil { throw Stop("lock_epoch_missing") }
    return Session(host: host, uid: getuid(), id: id, locked: locked, lockTime: time)
}

let inputScript = """
with timeout of 5 seconds
tell application "System Events" to tell process "loginwindow"
set n to 0
set charCount to -1
set hasFocus to false
set abc to false
set elems to entire contents of window 1
repeat with e in elems
if (subrole of e as text) is "AXSecureTextField" then
set n to n + 1
set charCount to length of (value of e as text)
set hasFocus to focused of e
end if
if (role of e as text) is "AXButton" then
try
if (name of e as text) is "ABC" then set abc to true
end try
end if
end repeat
return (n as text) & "," & (charCount as text) & "," & (hasFocus as text) & "," & (abc as text)
end tell
end timeout
"""

func field() throws -> Field {
    let result = try command("/usr/bin/osascript", ["-e", inputScript])
    let a = String(decoding: result, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines).split(separator: ",")
    guard a.count == 4, let n = Int(a[0]), let length = Int(a[1]) else { throw Stop("field_probe_incomplete") }
    return Field(count: n, characters: length, focused: a[2] == "true", abc: a[3] == "true")
}

func target() throws -> pid_t {
    let data = try command("/usr/bin/osascript", ["-e", "tell application \"System Events\" to get unix id of process \"loginwindow\""])
    guard let pid = Int32(String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)) else { throw Stop("target_pid_unknown") }
    let exe = try command("/bin/ps", ["-p",String(pid),"-o","comm="])
    guard String(decoding: exe, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines) == "/System/Library/CoreServices/loginwindow.app/Contents/MacOS/loginwindow" else { throw Stop("wrong_keyboard_target") }
    return pid
}

func post(_ stroke: Stroke, to pid: pid_t) throws {
    for down in [true, false] {
        guard let e = CGEvent(keyboardEventSource: nil, virtualKey: stroke.code, keyDown: down) else { throw Stop("keyboard_event_failed") }
        e.flags = stroke.shift ? .maskShift : []
        e.postToPid(pid)
    }
}

final class PrivateStore {
    let directory: URL
    let stateFile: URL
    private let fd: Int32
    init() throws {
        directory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/ARCHIVE PILATES OPS/MacUnlock")
        stateFile = directory.appendingPathComponent("state.json")
        var info = stat()
        guard lstat(directory.path, &info) == 0, info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFDIR, info.st_mode & 0o077 == 0 else { throw Stop("private_installation_missing") }
        let lockPath = directory.appendingPathComponent("operation.lock").path
        fd = open(lockPath, O_RDWR | O_CREAT | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw Stop("operation_lock_unavailable") }
        guard fstat(fd, &info) == 0, info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFREG, info.st_mode & 0o077 == 0,
              flock(fd, LOCK_EX | LOCK_NB) == 0 else { close(fd); throw Stop("operation_busy_or_unsafe") }
    }
    deinit { flock(fd, LOCK_UN); close(fd) }
    func read() throws -> State {
        var info = stat()
        guard lstat(stateFile.path, &info) == 0, info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFREG, info.st_mode & 0o077 == 0,
              info.st_size < 8192 else { throw Stop("state_missing_or_unsafe") }
        do { return try JSONDecoder().decode(State.self, from: Data(contentsOf: stateFile)) }
        catch { throw Stop("state_corrupt_no_retry") }
    }
    func exists() -> Bool { FileManager.default.fileExists(atPath: stateFile.path) }
    func write(_ state: State) throws {
        let data = try JSONEncoder().encode(state)
        let temp = directory.appendingPathComponent("state-" + UUID().uuidString + ".tmp")
        let file = open(temp.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard file >= 0 else { throw Stop("state_write_unavailable") }
        defer { close(file); unlink(temp.path) }
        let n = data.withUnsafeBytes { Darwin.write(file, $0.baseAddress, $0.count) }
        guard n == data.count, fsync(file) == 0, rename(temp.path, stateFile.path) == 0 else { throw Stop("state_not_durable") }
        let parent = open(directory.path, O_RDONLY)
        guard parent >= 0 else { throw Stop("state_not_durable") }
        defer { close(parent) }
        guard fsync(parent) == 0 else { throw Stop("state_not_durable") }
    }
}

final class Credential {
    let keychain: SecKeychain
    let query: [String: Any]
    init() throws {
        var keychain: SecKeychain?
        let p = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Keychains/login.keychain-db").path
        guard SecKeychainOpen(p, &keychain) == errSecSuccess, let k = keychain else { throw Stop("local_login_keychain_unavailable") }
        self.keychain = k
        query = [kSecClass as String: kSecClassGenericPassword,
                 kSecAttrService as String: "com.archivepilates.ops.mac-unlock",
                 kSecAttrAccount as String: String(getuid()),
                 kSecMatchSearchList as String: [k]]
    }
    func present() throws -> Bool {
        var q = query
        q[kSecReturnAttributes as String] = true
        let status = SecItemCopyMatching(q as CFDictionary, nil)
        guard [errSecSuccess, errSecItemNotFound].contains(status) else { throw Stop("keychain_access_unavailable") }
        return status == errSecSuccess
    }
    func save(_ data: Data) throws {
        guard try !present() else { throw Stop("credential_already_exists_no_overwrite") }
        var access: SecAccess?
        guard SecAccessCreate("ARCHIVE PILATES OPS Mac unlock" as CFString, nil, &access) == errSecSuccess, let access else { throw Stop("keychain_acl_creation_failed") }
        var item = query
        item.removeValue(forKey: kSecMatchSearchList as String)
        item[kSecUseKeychain as String] = keychain
        item[kSecAttrAccess as String] = access
        item[kSecAttrLabel as String] = "ARCHIVE PILATES OPS Mac unlock"
        item[kSecValueData as String] = data
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw Stop("keychain_save_failed") }
        try audit()
    }
    func audit() throws {
        var q = query
        q[kSecReturnRef as String] = true
        var result: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess, let result,
              CFGetTypeID(result) == SecKeychainItemGetTypeID() else { throw Stop("keychain_acl_item_unavailable") }
        let item = unsafeBitCast(result, to: SecKeychainItem.self)
        var access: SecAccess?
        guard SecKeychainItemCopyAccess(item, &access) == errSecSuccess, let access else { throw Stop("keychain_acl_unavailable") }
        var list: CFArray?
        guard SecAccessCopyACLList(access, &list) == errSecSuccess, let acls = list as? [SecACL] else { throw Stop("keychain_acl_unavailable") }
        var expected: SecTrustedApplication?
        guard SecTrustedApplicationCreateFromPath(nil, &expected) == errSecSuccess, let expected else { throw Stop("trusted_identity_unavailable") }
        var expectedData: CFData?
        guard SecTrustedApplicationCopyData(expected, &expectedData) == errSecSuccess, let expectedData else { throw Stop("trusted_identity_unavailable") }
        var checked = 0
        for acl in acls {
            let permissions = SecACLCopyAuthorizations(acl) as? [String] ?? []
            if permissions.contains(kSecACLAuthorizationDecrypt as String) || permissions.contains(kSecACLAuthorizationAny as String) {
                var apps: CFArray?
                var description: CFString?
                var selector = SecKeychainPromptSelector()
                guard SecACLCopyContents(acl, &apps, &description, &selector) == errSecSuccess,
                      let trusted = apps as? [SecTrustedApplication], trusted.count == 1 else { throw Stop("keychain_acl_too_broad") }
                var actual: CFData?
                guard SecTrustedApplicationCopyData(trusted[0], &actual) == errSecSuccess,
                      let actual, CFEqual(actual, expectedData) else { throw Stop("keychain_acl_identity_mismatch") }
                checked += 1
            }
        }
        guard checked > 0 else { throw Stop("keychain_decrypt_acl_missing") }
    }
    func load() throws -> Data {
        try audit()
        var q = query
        q[kSecReturnData as String] = true
        var result: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { throw Stop("credential_unavailable_no_fallback") }
        return data
    }
}

func arm(_ s: Session, _ store: PrivateStore) throws {
    guard !s.locked else { throw Stop("arm_requires_unlocked_desktop") }
    var state = try store.read()
    guard state.host == s.host, state.uid == s.uid else { throw Stop("host_or_user_mismatch") }
    state.unlockedSession = s.id
    state.blocked = false
    try store.write(state)
}

func unlock(_ initial: Session, _ store: PrivateStore) throws -> [String: Any] {
    if !initial.locked { try arm(initial, store); return ["ok":true,"status":"already_unlocked","attempted":false] }
    var state = try store.read()
    try gate(initial, state)
    guard AXIsProcessTrusted() else { throw Stop("accessibility_permission_missing") }
    let wake = Process()
    wake.executableURL = URL(fileURLWithPath: "/usr/bin/caffeinate")
    wake.arguments = ["-u","-t","120"]
    try wake.run()
    defer { if wake.isRunning { wake.terminate() }; wake.waitUntilExit() }
    Thread.sleep(forTimeInterval: 0.4)
    let pid = try target()
    guard try field() == Field(count: 1, characters: 0, focused: true, abc: true) else { throw Stop("secure_field_not_empty_focused_abc") }
    guard CGEventSource.flagsState(.hidSystemState).intersection([.maskAlphaShift,.maskShift,.maskControl,.maskAlternate,.maskCommand]).isEmpty else { throw Stop("modifier_key_active") }
    var data = try Credential().load()
    defer { data.resetBytes(in: 0..<data.count) }
    let keys = try strokes(data)
    guard try session() == initial, try target() == pid else { throw Stop("session_changed") }
    // Persist intent before any credential-bearing event. An interrupted attempt stays consumed.
    state.blocked = true
    state.attempt = Attempt(epoch: initial.epoch!, phase: "reserved", at: ISO8601DateFormatter().string(from: Date()))
    try store.write(state)
    var typed = 0
    defer {
        if (try? session()) == initial, let f = try? field(), f.count == 1, f.focused, f.characters == typed, typed > 0, (try? target()) == pid {
            for _ in 0..<typed { try? post(Stroke(code: 51, shift: false), to: pid) }
        }
    }
    for stroke in keys {
        guard try session() == initial, try target() == pid,
              try field() == Field(count: 1, characters: typed, focused: true, abc: true),
              CGEventSource.flagsState(.hidSystemState).intersection([.maskAlphaShift,.maskShift,.maskControl,.maskAlternate,.maskCommand]).isEmpty else { throw Stop("input_guard_changed_no_retry") }
        try post(stroke, to: pid)
        typed += 1
        Thread.sleep(forTimeInterval: 0.06)
    }
    guard try session() == initial, try target() == pid,
          try field() == Field(count: 1, characters: typed, focused: true, abc: true),
          CGEventSource.flagsState(.hidSystemState).intersection([.maskAlphaShift,.maskShift,.maskControl,.maskAlternate,.maskCommand]).isEmpty else { throw Stop("pre_submit_guard_changed_no_retry") }
    state.attempt?.phase = "submit_intent"
    try store.write(state)
    try post(Stroke(code: 36, shift: false), to: pid)
    let started = Date()
    for _ in 0..<30 {
        Thread.sleep(forTimeInterval: 0.5)
        let now = try session()
        guard now.host == initial.host, now.uid == initial.uid, now.id == initial.id else { throw Stop("session_changed_after_submit_no_retry") }
        if !now.locked {
            state.blocked = false
            state.unlockedSession = now.id
            state.attempt?.phase = "unlocked_verified"
            try store.write(state)
            return ["ok":true,"status":"unlocked_verified","attempted":true,"seconds":Date().timeIntervalSince(started)]
        }
    }
    state.attempt?.phase = "unverified_no_retry"
    try store.write(state)
    throw Stop("unlock_not_verified_no_retry")
}

public func runArchiveMacUnlock(_ args: [String]) -> Int32 {
    func emit(_ value: [String: Any]) {
        if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), let s = String(data: data, encoding: .utf8) { print(s) }
    }
    var priorUI = DarwinBoolean(false)
    SecKeychainGetUserInteractionAllowed(&priorUI)
    SecKeychainSetUserInteractionAllowed(false)
    defer { SecKeychainSetUserInteractionAllowed(priorUI.boolValue) }
    do {
        guard args.count == 1, ["status","check","enroll","arm","unlock"].contains(args[0]) else { throw Stop("use_status_check_enroll_arm_or_unlock_no_password_arguments") }
        let s = try session()
        let store = try PrivateStore()
        switch args[0] {
        case "status":
            let state = try? store.read()
            let credential = try Credential()
            let present = try credential.present()
            if present { try credential.audit() }
            emit(["ok":true,"locked":s.locked,"accessibilityTrusted":AXIsProcessTrusted(),
                  "credentialPresent":present,"credentialACLVerified":present,"statePresent":state != nil,
                  "retryBlocked":state?.blocked ?? true,"sameSessionArmed":state?.unlockedSession == s.id])
        case "check":
            guard !s.locked else { throw Stop("check_requires_unlocked_desktop") }
            var bytes = try Credential().load()
            defer { bytes.resetBytes(in: 0..<bytes.count) }
            _ = try strokes(bytes)
            emit(["ok":true,"status":"credential_read_verified","accessibilityTrusted":AXIsProcessTrusted(),"attempted":false])
        case "enroll":
            guard !s.locked, isatty(STDIN_FILENO) == 1, !store.exists() else { throw Stop("enroll_requires_unlocked_tty_and_new_install") }
            let credential = try Credential()
            guard try !credential.present() else { throw Stop("credential_already_exists_no_overwrite") }
            guard let input = getpass("Mac login password (hidden; local Keychain only): ") else { throw Stop("credential_input_cancelled") }
            let length = strlen(input)
            defer { _ = memset_s(input, length, 0, length) }
            guard length < 128 else { throw Stop("credential_length_unsupported") }
            var bytes = Data(bytes: input, count: length)
            defer { bytes.resetBytes(in: 0..<bytes.count) }
            _ = try strokes(bytes)
            guard try session() == s else { throw Stop("session_changed") }
            try credential.save(bytes)
            try store.write(State(version: 1, host: s.host, uid: s.uid, unlockedSession: s.id, blocked: false, attempt: nil))
            emit(["ok":true,"status":"credential_enrolled_local_keychain","schedulerInstalled":false])
        case "arm":
            try arm(s, store)
            emit(["ok":true,"status":"unlocked_session_armed","attempted":false])
        default:
            emit(try unlock(s, store))
        }
        return 0
    } catch let stop as Stop { emit(["ok":false,"code":stop.code]); return 1 }
    catch { emit(["ok":false,"code":"stopped_without_retry"]); return 1 }
}
