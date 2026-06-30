//
//  SecureStoreTests.swift
//  VerylovingTests
//
//  Tests the SecureStore Codable conveniences against the in-memory store, plus
//  a best-effort round trip against the real KeychainStore (skipped if the test
//  host lacks keychain entitlements on the simulator).
//

import XCTest
@testable import Veryloving

final class SecureStoreTests: XCTestCase {

    func testCodableRoundTripInMemory() throws {
        let store = InMemorySecureStore()
        let token = AuthToken(accessToken: "a", refreshToken: "r",
                              expiresAt: Date().addingTimeInterval(3600))

        try store.set(token, for: .authToken)
        let loaded = try store.get(AuthToken.self, for: .authToken)

        XCTAssertEqual(loaded, token)
    }

    func testStringConvenienceInMemory() throws {
        let store = InMemorySecureStore()
        try store.setString("hume-key-123", for: .humeApiKey)
        XCTAssertEqual(try store.string(for: .humeApiKey), "hume-key-123")
    }

    func testRemoveDeletesValue() throws {
        let store = InMemorySecureStore()
        try store.setString("x", for: .refreshToken)
        try store.remove(.refreshToken)
        XCTAssertNil(try store.data(for: .refreshToken))
    }

    func testRealKeychainRoundTrip() throws {
        let store = KeychainStore(service: "ai.veryloving.app.tests.\(UUID().uuidString)")
        do {
            try store.setString("secret", for: .authToken)
        } catch let KeychainError.unexpectedStatus(status) where status == errSecMissingEntitlement {
            throw XCTSkip("Keychain unavailable in this test host (missing entitlement).")
        }
        XCTAssertEqual(try store.string(for: .authToken), "secret")
        try store.remove(.authToken)
        XCTAssertNil(try store.data(for: .authToken))
    }
}
