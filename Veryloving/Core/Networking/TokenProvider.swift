//
//  TokenProvider.swift
//  Veryloving
//
//  Thread-safe holder for the current access token. The APIClient reads it from
//  arbitrary executors (URLSession callbacks), while SessionStore writes it from
//  the main actor — so access is guarded by a lock rather than actor isolation.
//

import Foundation

final class TokenProvider: AuthTokenProviding, @unchecked Sendable {
    private let lock = NSLock()
    private var accessToken: String?

    func currentAccessToken() -> String? {
        lock.lock(); defer { lock.unlock() }
        return accessToken
    }

    func update(_ token: String?) {
        lock.lock(); defer { lock.unlock() }
        accessToken = token
    }
}
