//
//  Mocks.swift
//  VerylovingTests
//

import Foundation
@testable import Veryloving

/// In-memory SecureStore so SessionStore/keychain-dependent code is testable
/// without touching the real keychain (which needs entitlements on the simulator).
final class InMemorySecureStore: SecureStore {
    private var storage: [KeychainKey: Data] = [:]

    func setData(_ data: Data, for key: KeychainKey) throws { storage[key] = data }
    func data(for key: KeychainKey) throws -> Data? { storage[key] }
    func remove(_ key: KeychainKey) throws { storage[key] = nil }
}
