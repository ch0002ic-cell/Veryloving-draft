//
//  AuthService.swift
//  Veryloving
//
//  Authentication boundary. `RemoteAuthService` talks to the backend
//  (docs/BACKEND_API.md §Auth); `MockAuthService` lets the whole sign-in/up and
//  onboarding UX run with no server (AppConfig.useMockServices). Apple Sign-In is
//  wired end-to-end (AppleSignInCoordinator); Google Sign-In is stubbed until the
//  GoogleSignIn SDK + client ID are provisioned (clarification Q1).
//

import Foundation

protocol AuthService {
    func signIn(email: String, password: String) async throws -> AuthResponse
    func register(email: String, password: String, displayName: String) async throws -> AuthResponse
    func signInWithApple(identityToken: String, fullName: String?) async throws -> AuthResponse
    func refresh(refreshToken: String) async throws -> AuthResponse
}

// MARK: - Request bodies (mirror docs/BACKEND_API.md)

private struct LoginBody: Encodable { let email: String; let password: String }
private struct RegisterBody: Encodable { let email: String; let password: String; let displayName: String }
private struct AppleBody: Encodable { let identityToken: String; let fullName: String? }
private struct RefreshBody: Encodable { let refreshToken: String }

// MARK: - Remote implementation

final class RemoteAuthService: AuthService {
    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func signIn(email: String, password: String) async throws -> AuthResponse {
        try await client.send(
            .json("/v1/auth/login", method: .post,
                  body: LoginBody(email: email, password: password), requiresAuth: false),
            decoding: AuthResponse.self
        )
    }

    func register(email: String, password: String, displayName: String) async throws -> AuthResponse {
        try await client.send(
            .json("/v1/auth/register", method: .post,
                  body: RegisterBody(email: email, password: password, displayName: displayName),
                  requiresAuth: false),
            decoding: AuthResponse.self
        )
    }

    func signInWithApple(identityToken: String, fullName: String?) async throws -> AuthResponse {
        try await client.send(
            .json("/v1/auth/apple", method: .post,
                  body: AppleBody(identityToken: identityToken, fullName: fullName),
                  requiresAuth: false),
            decoding: AuthResponse.self
        )
    }

    func refresh(refreshToken: String) async throws -> AuthResponse {
        try await client.send(
            .json("/v1/auth/refresh", method: .post,
                  body: RefreshBody(refreshToken: refreshToken), requiresAuth: false),
            decoding: AuthResponse.self
        )
    }
}

// MARK: - Mock implementation (no backend required)

/// In-memory auth for development, previews, UI tests, and the investor demo.
/// Enforces light validation so the form-validation UX is exercised realistically.
final class MockAuthService: AuthService {

    enum MockError: LocalizedError {
        case invalidCredentials
        case emailTaken
        var errorDescription: String? {
            switch self {
            case .invalidCredentials: return "That email or password doesn't look right."
            case .emailTaken: return "An account with that email already exists."
            }
        }
    }

    private var registeredEmails: Set<String> = ["demo@veryloving.ai"]

    func signIn(email: String, password: String) async throws -> AuthResponse {
        try await Self.simulateLatency()
        // Accept the demo account or any previously "registered" email with a 6+ char password.
        guard password.count >= 6 else { throw MockError.invalidCredentials }
        return Self.makeResponse(email: email, displayName: nil)
    }

    func register(email: String, password: String, displayName: String) async throws -> AuthResponse {
        try await Self.simulateLatency()
        guard !registeredEmails.contains(email.lowercased()) else { throw MockError.emailTaken }
        registeredEmails.insert(email.lowercased())
        return Self.makeResponse(email: email, displayName: displayName)
    }

    func signInWithApple(identityToken: String, fullName: String?) async throws -> AuthResponse {
        try await Self.simulateLatency()
        return Self.makeResponse(email: "apple-user@privaterelay.appleid.com", displayName: fullName)
    }

    func refresh(refreshToken: String) async throws -> AuthResponse {
        Self.makeResponse(email: "demo@veryloving.ai", displayName: "Demo User")
    }

    private static func simulateLatency() async throws {
        try await Task.sleep(nanoseconds: 600_000_000)
    }

    private static func makeResponse(email: String, displayName: String?) -> AuthResponse {
        let user = User(
            id: UUID().uuidString,
            email: email,
            displayName: displayName ?? "Demo User",
            subscriptionTier: .free,
            createdAt: Date()
        )
        return AuthResponse(
            user: user,
            accessToken: "mock-access-\(UUID().uuidString)",
            refreshToken: "mock-refresh-\(UUID().uuidString)",
            expiresIn: 3600
        )
    }
}
