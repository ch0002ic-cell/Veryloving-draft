//
//  KeychainStore.swift
//  Veryloving
//
//  Native Keychain wrapper (Security framework). Replaces the prototype's
//  hardcoded API key and UserDefaults-based settings for anything sensitive:
//  auth tokens, the Hume API key, and encryption material.
//
//  No third-party dependency (was specced as SwiftKeychainWrapper). Items are
//  stored with kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly so they survive
//  backgrounding/SOS but never sync off-device or leave it via iCloud backup.
//

import Foundation
import Security

protocol SecureStore {
    func setData(_ data: Data, for key: KeychainKey) throws
    func data(for key: KeychainKey) throws -> Data?
    func remove(_ key: KeychainKey) throws
}

extension SecureStore {
    /// Store any Codable value as JSON.
    func set<T: Encodable>(_ value: T, for key: KeychainKey) throws {
        try setData(try JSONEncoder().encode(value), for: key)
    }

    /// Retrieve a Codable value, or nil if absent.
    func get<T: Decodable>(_ type: T.Type, for key: KeychainKey) throws -> T? {
        guard let data = try data(for: key) else { return nil }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func setString(_ string: String, for key: KeychainKey) throws {
        try setData(Data(string.utf8), for: key)
    }

    func string(for key: KeychainKey) throws -> String? {
        guard let data = try data(for: key) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

/// Strongly-typed keychain account names so we never sprinkle string literals.
enum KeychainKey: String {
    case authToken
    case refreshToken
    case humeApiKey
    case humeConfigId
    case deviceEncryptionKey
}

enum KeychainError: LocalizedError {
    case unexpectedStatus(OSStatus)

    var errorDescription: String? {
        switch self {
        case .unexpectedStatus(let status):
            let message = SecCopyErrorMessageString(status, nil) as String? ?? "Unknown error"
            return "Keychain error (\(status)): \(message)"
        }
    }
}

final class KeychainStore: SecureStore {

    private let service: String

    init(service: String = Bundle.main.bundleIdentifier ?? "ai.veryloving.app") {
        self.service = service
    }

    private func baseQuery(for key: KeychainKey) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue
        ]
    }

    func setData(_ data: Data, for key: KeychainKey) throws {
        var query = baseQuery(for: key)
        // Upsert: delete any existing item first, then add. Simpler and race-free
        // enough for our single-writer access pattern.
        SecItemDelete(query as CFDictionary)

        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.unexpectedStatus(status) }
    }

    func data(for key: KeychainKey) throws -> Data? {
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        switch status {
        case errSecSuccess:
            return result as? Data
        case errSecItemNotFound:
            return nil
        default:
            throw KeychainError.unexpectedStatus(status)
        }
    }

    func remove(_ key: KeychainKey) throws {
        let status = SecItemDelete(baseQuery(for: key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unexpectedStatus(status)
        }
    }
}
