//
//  SessionStore.swift
//  Veryloving
//
//  Owns the authenticated session: the current user and the token pair. It is
//  the single source of truth the rest of the app observes (`phase`) and the
//  `AuthTokenProviding` the APIClient reads bearer tokens from.
//
//  Tokens live in the Keychain; the (non-secret) user profile lives in
//  UserDefaults for fast launch. Sign-out clears both.
//

import Foundation
import Combine

@MainActor
final class SessionStore: ObservableObject {

    enum Phase: Equatable {
        case initializing
        case unauthenticated
        case authenticated(User)
    }

    @Published private(set) var phase: Phase = .initializing

    private let secureStore: SecureStore
    private let authService: AuthService
    private let tokenProvider: TokenProvider
    private let analytics: AnalyticsService
    private let userDefaultsKey = "current_user"

    private var token: AuthToken?
    private var refreshTask: Task<Bool, Never>?

    init(secureStore: SecureStore,
         authService: AuthService,
         tokenProvider: TokenProvider,
         analytics: AnalyticsService = NoopAnalyticsService()) {
        self.secureStore = secureStore
        self.authService = authService
        self.tokenProvider = tokenProvider
        self.analytics = analytics
    }

    var currentUser: User? {
        if case .authenticated(let user) = phase { return user }
        return nil
    }

    /// Called once at launch to restore a persisted session.
    func bootstrap() {
        let storedToken = try? secureStore.get(AuthToken.self, for: .authToken)
        let storedUser = UserDefaults.standard.object(User.self, forKey: userDefaultsKey)

        if let storedToken, let storedUser, !storedToken.isExpired {
            self.token = storedToken
            tokenProvider.update(storedToken.accessToken)
            self.phase = .authenticated(storedUser)
            AppLogger.auth.info("Restored session for existing user.")
        } else {
            self.phase = .unauthenticated
        }
    }

    /// Persist a freshly-issued session and flip to authenticated.
    func establish(_ response: AuthResponse) {
        do {
            try secureStore.set(response.token, for: .authToken)
            try secureStore.setString(response.refreshToken, for: .refreshToken)
        } catch {
            AppLogger.auth.error("Failed to persist token: \(error.localizedDescription)")
        }
        UserDefaults.standard.save(response.user, forKey: userDefaultsKey)
        self.token = response.token
        tokenProvider.update(response.token.accessToken)
        self.phase = .authenticated(response.user)
        analytics.setUserId(response.user.id)
        AppLogger.auth.info("Session established.")
    }

    func updateUser(_ user: User) {
        UserDefaults.standard.save(user, forKey: userDefaultsKey)
        if case .authenticated = phase {
            phase = .authenticated(user)
        }
    }

    /// Apply the subscription tier resolved by StoreKit/RevenueCat. No-op until
    /// the session is authenticated (ignores the initial `.free` emission at launch).
    func updateSubscriptionTier(_ tier: SubscriptionTier) {
        guard case .authenticated(var user) = phase, user.subscriptionTier != tier else { return }
        user.subscriptionTier = tier
        updateUser(user)
    }

    func signOut() {
        try? secureStore.remove(.authToken)
        try? secureStore.remove(.refreshToken)
        UserDefaults.standard.removeObject(forKey: userDefaultsKey)
        token = nil
        tokenProvider.update(nil)
        refreshTask?.cancel()
        refreshTask = nil
        phase = .unauthenticated
        analytics.setUserId(nil)
        AppLogger.auth.info("Signed out.")
    }
}

// MARK: - SessionRefreshing

extension SessionStore: SessionRefreshing {
    /// Single-flight token refresh: concurrent 401s share one refresh call.
    /// On failure the session is signed out (the refresh token is dead).
    func refreshSession() async -> Bool {
        if let inFlight = refreshTask { return await inFlight.value }

        let task = Task { () -> Bool in
            guard let refreshToken = try? secureStore.string(for: .refreshToken),
                  !refreshToken.isEmpty else { return false }
            do {
                let response = try await authService.refresh(refreshToken: refreshToken)
                establish(response)
                return true
            } catch {
                AppLogger.auth.warning("Token refresh failed; signing out.")
                signOut()
                return false
            }
        }
        refreshTask = task
        let result = await task.value
        refreshTask = nil
        return result
    }
}
