//
//  AuthViewModel.swift
//  Veryloving
//
//  Drives the Sign In / Sign Up / Apple flows. Performs client-side validation,
//  calls the AuthService, and hands a successful AuthResponse to SessionStore.
//  Unit-tested against MockAuthService (see VerylovingTests/AuthViewModelTests).
//

import Foundation

@MainActor
final class AuthViewModel: ObservableObject {

    // Form state
    @Published var email = ""
    @Published var password = ""
    @Published var displayName = ""

    // UI state
    @Published private(set) var isLoading = false
    @Published var error: AppError?

    private let authService: AuthService
    private let session: SessionStore
    private let analytics: AnalyticsService
    private let appleCoordinator: AppleSignInCoordinator

    init(authService: AuthService,
         session: SessionStore,
         analytics: AnalyticsService = NoopAnalyticsService(),
         appleCoordinator: AppleSignInCoordinator = AppleSignInCoordinator()) {
        self.authService = authService
        self.session = session
        self.analytics = analytics
        self.appleCoordinator = appleCoordinator
    }

    // MARK: Validation

    var isEmailValid: Bool {
        let pattern = #"^[A-Z0-9a-z._%+-]+@[A-Z0-9a-z.-]+\.[A-Za-z]{2,}$"#
        return email.range(of: pattern, options: .regularExpression) != nil
    }

    var isPasswordValid: Bool { password.count >= 6 }

    var canSubmitSignIn: Bool { isEmailValid && isPasswordValid && !isLoading }
    var canSubmitSignUp: Bool {
        canSubmitSignIn && !displayName.trimmingCharacters(in: .whitespaces).isEmpty
    }

    // MARK: Actions

    func signIn() async {
        guard canSubmitSignIn else { return }
        await perform(success: .signedIn(method: "email")) {
            try await self.authService.signIn(email: self.email, password: self.password)
        }
    }

    func register() async {
        guard canSubmitSignUp else { return }
        await perform(success: .signedUp(method: "email")) {
            try await self.authService.register(
                email: self.email,
                password: self.password,
                displayName: self.displayName.trimmingCharacters(in: .whitespaces)
            )
        }
    }

    func signInWithApple() async {
        await perform(success: .signedIn(method: "apple")) {
            let credential = try await self.appleCoordinator.signIn()
            return try await self.authService.signInWithApple(
                identityToken: credential.identityToken,
                fullName: credential.fullName
            )
        }
    }

    func signInWithGoogle() {
        // TODO: integrate GoogleSignIn SDK once the OAuth client ID is provisioned
        // (clarification Q1). Until then surface a clear, honest message.
        error = AppError(
            title: "Coming soon",
            message: "Google Sign-In isn't available yet. Please use email or Apple."
        )
    }

    /// Shared runner: toggles loading, maps errors, and establishes the session.
    private func perform(success event: AnalyticsEvent,
                         _ operation: @escaping () async throws -> AuthResponse) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await operation()
            session.establish(response)
            analytics.log(event)
        } catch let appleError as AppleSignInCoordinator.AppleSignInError {
            if case .cancelled = appleError { return }   // silent on user cancel
            error = AppError(appleError)
        } catch {
            self.error = AppError(error)
        }
    }
}
