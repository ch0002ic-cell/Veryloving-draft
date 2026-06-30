//
//  AuthToken.swift
//  Veryloving
//

import Foundation

/// Bearer token pair returned by the auth backend. Persisted in the Keychain.
struct AuthToken: Codable, Equatable {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date

    /// Refresh slightly early so requests don't race the expiry boundary.
    var isExpired: Bool {
        Date() >= expiresAt.addingTimeInterval(-60)
    }
}

/// Response envelope for login/register/refresh. Mirrors docs/BACKEND_API.md.
struct AuthResponse: Codable, Equatable {
    let user: User
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int           // seconds until access-token expiry

    var token: AuthToken {
        AuthToken(
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresAt: Date().addingTimeInterval(TimeInterval(expiresIn))
        )
    }
}
